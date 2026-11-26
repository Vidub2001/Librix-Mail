//! Nouveaux messages en temps réel : pour chaque compte, une connexion dédiée
//! reste en écoute IMAP IDLE (RFC 2177) sur la boîte de réception.
//!
//! À chaque changement signalé par le serveur, événement `mail-changed` vers
//! l'interface : elle resynchronise l'affichage, fait passer les règles, puis
//! annonce les nouveaux messages restés dans la boîte (lot B4 : plus de
//! notification ici, avant les règles, pour un message qu'elles suppriment).
//!
//! La connexion se rétablit seule après une coupure ou une mise en veille.
//! Un serveur sans IDLE garde la synchronisation périodique de l'interface.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::config::AccountConfig;
use crate::transport;

/// IDLE est renouvelé régulièrement : la RFC demande moins de 29 minutes, et
/// certains routeurs coupent plus tôt une connexion silencieuse.
const RENEW: Duration = Duration::from_mins(9);
/// Attente avant une nouvelle tentative de connexion.
const RETRY: Duration = Duration::from_secs(60);

pub(crate) const EVENT: &str = "mail-changed";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MailChanged {
    pub account_id: String,
    pub folder_id: String,
}

/// Fils d'écoute en cours, un par compte.
pub struct Watchers {
    app: AppHandle,
    running: HashMap<String, Arc<AtomicBool>>,
}

impl std::fmt::Debug for Watchers {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut accounts: Vec<&String> = self.running.keys().collect();
        accounts.sort();
        f.debug_struct("Watchers").field("accounts", &accounts).finish_non_exhaustive()
    }
}

impl Watchers {
    pub fn new(app: AppHandle) -> Self {
        Self { app, running: HashMap::new() }
    }

    /// Démarre (ou redémarre) l'écoute d'un compte.
    pub fn start(&mut self, config: AccountConfig) {
        self.stop(&config.id);
        let stop = Arc::new(AtomicBool::new(false));
        self.running.insert(config.id.clone(), Arc::clone(&stop));
        let app = self.app.clone();
        let spawned = thread::Builder::new().name(format!("idle-{}", config.id)).spawn(move || watch(&app, &config, &stop));
        if let Err(e) = spawned {
            crate::diag::report(&format_args!("écoute impossible à démarrer : {e}"));
        }
    }

    /// Arrête l'écoute d'un compte (effectif au plus tard à la fin du délai de lecture).
    pub fn stop(&mut self, account_id: &str) {
        if let Some(flag) = self.running.remove(account_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

fn stopped(stop: &AtomicBool) -> bool {
    stop.load(Ordering::Relaxed)
}

fn pause(stop: &AtomicBool, duration: Duration) {
    let tick = Duration::from_millis(500);
    let mut waited = Duration::ZERO;
    while waited < duration && !stopped(stop) {
        thread::sleep(tick);
        waited += tick;
    }
}

fn watch(app: &AppHandle, config: &AccountConfig, stop: &AtomicBool) {
    let folder_id = format!("{}:INBOX", config.id);
    while !stopped(stop) {
        let mut session = match transport::open_imap(&config.imap) {
            Ok((session, _)) => session,
            Err(e) => {
                crate::diag::report(&format_args!("écoute de « {} » impossible : {e}", config.name));
                pause(stop, RETRY);
                continue;
            }
        };
        if !session.has_capability("IDLE") {
            crate::diag::report(&format_args!("« {} » ne propose pas IMAP IDLE ; synchronisation périodique seulement", config.name));
            let _ = session.logout();
            return;
        }
        if let Err(e) = session.select("INBOX") {
            crate::diag::report(&format_args!("« {} » : {e}", config.name));
            pause(stop, RETRY);
            continue;
        }

        loop {
            if stopped(stop) {
                let _ = session.logout();
                return;
            }
            match session.idle(RENEW, || !stopped(stop)) {
                Ok(false) => {} // délai atteint : IDLE est simplement relancé
                Ok(true) => {
                    let event = MailChanged { account_id: config.id.clone(), folder_id: folder_id.clone() };
                    if let Err(e) = app.emit(EVENT, event) {
                        crate::diag::report(&e);
                    }
                }
                Err(e) => {
                    crate::diag::report(&format_args!("écoute de « {} » interrompue : {e}", config.name));
                    break; // reconnexion
                }
            }
        }
        pause(stop, Duration::from_secs(5));
    }
}

/// Texte d'une notification (relecture S5). Il vient d'un mail (objet,
/// nom du compte) et les serveurs de notification l'interprètent comme du
/// balisage : il est échappé (pas de lien `<a>` cliquable). Le titre est du
/// texte brut selon la norme : l'échapper afficherait `&amp;`.
pub(crate) fn notification_body(body: &str) -> String {
    body.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// Notification « nouveaux messages » encore affichée pour un compte (lots
/// M1 et P) : le nombre de messages qu'elle annonce, et sous Linux
/// l'identifiant que le serveur de notifications lui a donné.
#[cfg(any(target_os = "linux", windows))]
#[derive(Debug, Clone, Copy)]
struct Open {
    count: u32,
    #[cfg(target_os = "linux")]
    id: u32,
}

/// Notifications « nouveaux messages » affichées, par compte.
#[cfg(any(target_os = "linux", windows))]
static OPEN: std::sync::LazyLock<std::sync::Mutex<HashMap<String, Open>>> = std::sync::LazyLock::new(Default::default);

/// Icône et catégorie freedesktop des notifications « nouveaux messages ».
const MAIL_ICON: &str = "mail-unread";
const MAIL_CATEGORY: &str = "email.arrived";

/// Nouveaux messages d'un compte, à annoncer (lots M1 et P).
#[derive(Debug, Clone, Copy)]
pub(crate) struct Arrivals<'a> {
    /// Compte : une notification par compte.
    pub account: &'a str,
    /// Messages arrivés depuis l'annonce précédente.
    pub added: u32,
    /// Titre et texte pour un message seul : expéditeur ; objet et compte.
    pub summary: &'a str,
    pub body: &'a str,
    /// Nom du compte, texte de la notification de plusieurs messages.
    pub account_name: &'a str,
}

/// Titre et texte d'une notification qui annonce `total` messages : ceux du
/// message seul, ou leur nombre.
pub(crate) fn arrival_text(total: u32, a: &Arrivals<'_>) -> (String, String) {
    if total <= 1 {
        (a.summary.to_owned(), a.body.to_owned())
    } else {
        (tr!("{n} nouveaux messages", n = total), a.account_name.to_owned())
    }
}

/// Notifications du bureau sous Linux par D-Bus (`org.freedesktop.Notifications`,
/// lot PK1), en installation classique comme dans Flatpak et Snap, où
/// `notify-send` n'existe pas.
#[cfg(target_os = "linux")]
mod freedesktop {
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Mutex, PoisonError};
    use std::thread;

    use zbus::blocking::{Connection, Proxy};
    use zbus::zvariant::Value;

    use super::{notification_body, OPEN};

    const DESTINATION: &str = "org.freedesktop.Notifications";
    const PATH: &str = "/org/freedesktop/Notifications";
    const INTERFACE: &str = "org.freedesktop.Notifications";
    const APP_NAME: &str = "Librix Mail";
    /// Durée d'affichage : celle que choisit le serveur de notifications.
    const SERVER_TIMEOUT: i32 = -1;

    /// Proxy du serveur de notifications, sur une connexion au bus de
    /// session ouverte au premier usage et gardée. Oublié après un échec :
    /// la notification suivante rouvre la connexion (bus redémarré…).
    static PROXY: Mutex<Option<Proxy<'static>>> = Mutex::new(None);
    /// Fil d'écoute des fermetures en marche ; remis à `false` quand il
    /// s'arrête ou n'a pas pu démarrer, pour être relancé.
    static WATCHING: AtomicBool = AtomicBool::new(false);

    /// Une notification à montrer.
    #[derive(Debug, Clone, Copy)]
    pub(super) struct Note<'a> {
        pub summary: &'a str,
        pub body: &'a str,
        /// Nom d'icône freedesktop.
        pub icon: &'a str,
        /// Catégorie freedesktop (`email.arrived`…).
        pub category: &'a str,
    }

    fn new_proxy(connection: &Connection) -> zbus::Result<Proxy<'static>> {
        Proxy::new(connection, DESTINATION, PATH, INTERFACE)
    }

    /// Proxy gardé, ou nouveau sur une nouvelle connexion.
    fn proxy() -> zbus::Result<Proxy<'static>> {
        let mut slot = PROXY.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(proxy) = slot.as_ref() {
            return Ok(proxy.clone());
        }
        let proxy = new_proxy(&Connection::session()?)?;
        *slot = Some(proxy.clone());
        Ok(proxy)
    }

    /// Oublie le proxy gardé après une erreur du bus.
    fn drop_proxy() {
        *PROXY.lock().unwrap_or_else(PoisonError::into_inner) = None;
    }

    /// Montre la notification, ou remplace celle qui porte l'identifiant
    /// `replaces` (0 : nouvelle) ; rend l'identifiant donné par le serveur.
    /// Le lanceur du paquet (`desktop-entry`) fait rattacher la notification
    /// à l'application : GNOME les empile sous elle (lot M1).
    pub(super) fn show(note: Note<'_>, replaces: u32) -> zbus::Result<u32> {
        let proxy = proxy()?;
        watch_closed(&proxy);
        let entry = crate::packaging::Packaging::current().desktop_entry();
        let hints: HashMap<&str, Value<'_>> =
            HashMap::from([("desktop-entry", Value::from(entry.as_str())), ("category", Value::from(note.category))]);
        let actions: Vec<&str> = Vec::new();
        let body = notification_body(note.body);
        let shown = proxy.call("Notify", &(APP_NAME, replaces, note.icon, note.summary, body.as_str(), actions, hints, SERVER_TIMEOUT));
        if shown.is_err() {
            drop_proxy();
        }
        shown
    }

    /// Suit la fermeture des notifications (effacée, ou ouverte d'un clic)
    /// sur un fil à part : la notification fermée d'un compte est oubliée,
    /// la suivante repart de zéro. Un seul fil à la fois ; relancé à la
    /// notification suivante s'il s'arrête (connexion fermée) ou n'a pas pu
    /// s'abonner.
    fn watch_closed(proxy: &Proxy<'static>) {
        if WATCHING.swap(true, Ordering::AcqRel) {
            return;
        }
        let signals = match proxy.receive_signal("NotificationClosed") {
            Ok(signals) => signals,
            Err(e) => {
                WATCHING.store(false, Ordering::Release);
                crate::diag::report(&format_args!("fermeture des notifications non suivie : {e}"));
                return;
            }
        };
        thread::spawn(move || {
            for message in signals {
                if let Ok((id, _reason)) = message.body().deserialize::<(u32, u32)>() {
                    forget(id);
                }
            }
            // Connexion fermée : nouvelle connexion et nouvel abonnement à
            // la prochaine notification.
            drop_proxy();
            WATCHING.store(false, Ordering::Release);
        });
    }

    /// Oublie la notification `id`, quel que soit son compte.
    fn forget(id: u32) {
        if let Ok(mut open) = OPEN.lock() {
            open.retain(|_, o| o.id != id);
        }
    }
}

/// Notification du bureau : D-Bus sous Linux, module de notifications de
/// Tauri ailleurs (Windows, macOS). `icon` et `category` : noms freedesktop (Linux).
pub(crate) fn desktop_notify(app: &AppHandle, summary: &str, body: &str, icon: &str, category: &str) {
    #[cfg(target_os = "linux")]
    {
        let _ = app;
        let note = freedesktop::Note { summary, body, icon, category };
        if let Err(e) = freedesktop::show(note, 0) {
            crate::diag::report(&format_args!("notification impossible : {e}"));
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        use tauri_plugin_notification::NotificationExt;
        let _ = (icon, category);
        if let Err(e) = app.notification().builder().title(summary).body(body).show() {
            crate::diag::report(&format_args!("notification impossible : {e}"));
        }
    }
}

/// Annonce des nouveaux messages d'un compte : une seule notification par
/// compte, remplacée tant qu'elle reste affichée et qui additionne les
/// messages (« 3 nouveaux messages ») ; une fois fermée, la suivante repart
/// de zéro (lots M1 et P). Linux : identifiant du serveur de notifications,
/// oublié à la fermeture ; Windows : notification à étiquette, retrouvée
/// dans le centre de notifications ; ailleurs, une notification par annonce.
pub(crate) fn notify_arrivals(app: &AppHandle, a: &Arrivals<'_>) {
    #[cfg(target_os = "linux")]
    {
        let _ = app;
        let open = OPEN.lock().ok().and_then(|o| o.get(a.account).copied());
        let total = open.map_or(0, |o| o.count).saturating_add(a.added);
        let (summary, body) = arrival_text(total, a);
        let note = freedesktop::Note { summary: &summary, body: &body, icon: MAIL_ICON, category: MAIL_CATEGORY };
        match freedesktop::show(note, open.map_or(0, |o| o.id)) {
            Ok(id) => {
                if let Ok(mut map) = OPEN.lock() {
                    map.insert(a.account.to_owned(), Open { count: total, id });
                }
            }
            Err(e) => crate::diag::report(&format_args!("notification impossible : {e}")),
        }
    }
    #[cfg(windows)]
    {
        let aumid = app.config().identifier.clone();
        let tag = windows_toast::tag_of(a.account);
        // Notification effacée du centre : le compte repart de zéro.
        let shown = windows_toast::is_shown(&aumid, &tag);
        let before = if shown { OPEN.lock().ok().and_then(|o| o.get(a.account).map(|o| o.count)) } else { None };
        let total = before.unwrap_or(0).saturating_add(a.added);
        let (summary, body) = arrival_text(total, a);
        match windows_toast::show(&aumid, &tag, &summary, &body) {
            Ok(()) => {
                if let Ok(mut map) = OPEN.lock() {
                    map.insert(a.account.to_owned(), Open { count: total });
                }
            }
            Err(e) => {
                crate::diag::report(&format_args!("notification remplaçable impossible : {e}"));
                desktop_notify(app, &summary, &body, MAIL_ICON, MAIL_CATEGORY);
            }
        }
    }
    #[cfg(not(any(target_os = "linux", windows)))]
    {
        let (summary, body) = arrival_text(a.added, a);
        desktop_notify(app, &summary, &body, MAIL_ICON, MAIL_CATEGORY);
    }
}

/// Notifications Windows à étiquette (lot P) : une notification de même
/// étiquette et de même groupe remplace la précédente dans le centre de
/// notifications, au lieu de s'y ajouter.
#[cfg(windows)]
mod windows_toast {
    use std::fmt::Write as _;

    use windows::core::HSTRING;
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};

    /// Groupe des notifications « nouveaux messages ».
    const GROUP: &str = "nouveaux-messages";

    /// Étiquette d'un compte : courte (Windows en accepte 64 caractères au
    /// plus) et stable, tirée de son identifiant.
    pub(super) fn tag_of(account: &str) -> String {
        let hash = account.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |h, b| (h ^ u64::from(b)).wrapping_mul(0x100_0000_01b3));
        format!("compte-{hash:016x}")
    }

    fn escape(s: &str) -> String {
        s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
    }

    /// Fil sans environnement `WinRT` (tâche de fond) : préparé une fois.
    fn init_winrt() {
        // Déjà prêt, ou prêt dans un autre mode : l'appel suivant le dira.
        // SAFETY: RoInitialize prépare WinRT pour le fil courant, sans précondition ;
        // un fil déjà initialisé rend une erreur, ignorée.
        let _ = unsafe { windows::Win32::System::WinRT::RoInitialize(windows::Win32::System::WinRT::RO_INIT_MULTITHREADED) };
    }

    /// La notification de cette étiquette est-elle encore dans le centre de notifications ?
    pub(super) fn is_shown(aumid: &str, tag: &str) -> bool {
        init_winrt();
        let Ok(history) = ToastNotificationManager::History() else { return false };
        let Ok(list) = history.GetHistoryWithId(&HSTRING::from(aumid)) else { return false };
        list.into_iter().any(|t| t.Tag().is_ok_and(|x| x == tag) && t.Group().is_ok_and(|g| g == GROUP))
    }

    /// Montre (ou remplace) la notification de cette étiquette.
    pub(super) fn show(aumid: &str, tag: &str, title: &str, body: &str) -> windows::core::Result<()> {
        init_winrt();
        let mut xml = format!("<toast><visual><binding template=\"ToastGeneric\"><text>{}</text>", escape(title));
        for line in body.lines().take(2) {
            let _ = write!(xml, "<text>{}</text>", escape(line));
        }
        xml.push_str("</binding></visual></toast>");
        let doc = XmlDocument::new()?;
        doc.LoadXml(&HSTRING::from(xml))?;
        let toast = ToastNotification::CreateToastNotification(&doc)?;
        toast.SetTag(&HSTRING::from(tag))?;
        toast.SetGroup(&HSTRING::from(GROUP))?;
        ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(aumid))?.Show(&toast)
    }

    #[cfg(test)]
    mod tests {
        #[test]
        fn p_etiquette_courte_et_stable() {
            let tag = super::tag_of("compte-très-long-0123456789-0123456789-0123456789-0123456789");
            assert_eq!(tag, super::tag_of("compte-très-long-0123456789-0123456789-0123456789-0123456789"), "stable");
            assert!(tag.len() <= 64, "{tag}");
            assert_ne!(super::tag_of("a"), super::tag_of("b"));
            assert_eq!(super::escape("<a & \"b\">"), "&lt;a &amp; &quot;b&quot;&gt;");
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn p_texte_d_un_message_puis_du_nombre() {
        let a = super::Arrivals { account: "a", added: 1, summary: "Alice", body: "Réunion\nPerso", account_name: "Perso" };
        assert_eq!(super::arrival_text(1, &a), ("Alice".to_owned(), "Réunion\nPerso".to_owned()));
        let (summary, body) = super::arrival_text(3, &a);
        assert!(summary.starts_with('3'), "{summary}");
        assert_eq!(body, "Perso");
    }

    #[test]
    fn texte_de_notification_echappe() {
        let body = super::notification_body("<a href=\"https://x\">Vérifiez</a> & co");
        assert_eq!(body, "&lt;a href=\"https://x\"&gt;Vérifiez&lt;/a&gt; &amp; co");
    }
}
