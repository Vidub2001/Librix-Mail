//! Messages programmés (lot W2) : envoyés à l'heure choisie par un fil de fond.
//!
//! La rédaction programme un message (`schedule_send`) ; il attend dans le
//! cache chiffré (`scheduled_sends`). Ce fil regarde toutes les
//! [`TICK`] secondes ceux dont l'heure est passée, les retire du cache et les
//! envoie comme un envoi ordinaire (`commands::deliver`) : même compte rendu,
//! même message rouvert en cas d'échec. Librix Mail fermé, rien ne part ; au
//! démarrage suivant, les messages en retard partent au premier passage.

use std::sync::{Condvar, Mutex, PoisonError};
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::cache::Cache;
use crate::router::lock_cache;
use crate::AppState;

/// Intervalle entre deux passages : un message part au plus tard 20 s après
/// son heure, Librix Mail ouvert.
const TICK: Duration = Duration::from_secs(20);

/// Heure d'envoi la plus lointaine acceptée : un an.
pub(crate) const MAX_AHEAD: i64 = 366 * 24 * 3600;

/// Tolérance pour une heure à peine passée (choix fait juste avant minuit,
/// horloge un peu en avance) : le message part au prochain passage.
pub(crate) const GRACE: i64 = 5 * 60;

/// Réveil anticipé du fil (« Envoyer maintenant »), sans attendre le passage suivant.
static WAKE: (Mutex<bool>, Condvar) = (Mutex::new(false), Condvar::new());

/// Heure actuelle, en secondes Unix.
pub(crate) fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| i64::try_from(d.as_secs()).unwrap_or(i64::MAX))
}

/// Lance le fil des messages programmés (une fois, au démarrage).
pub(crate) fn start(app: AppHandle) {
    std::thread::spawn(move || loop {
        send_due(&app);
        let (lock, wake) = &WAKE;
        let woken = lock.lock().unwrap_or_else(PoisonError::into_inner);
        let (mut woken, _) = wake.wait_timeout_while(woken, TICK, |w| !*w).unwrap_or_else(PoisonError::into_inner);
        *woken = false;
    });
}

/// Fait passer le fil tout de suite.
pub(crate) fn wake() {
    let (lock, wake) = &WAKE;
    *lock.lock().unwrap_or_else(PoisonError::into_inner) = true;
    wake.notify_one();
}

/// Message programmé retiré du cache, prêt à partir.
#[derive(Debug)]
enum Due {
    /// À envoyer.
    Ready(Box<crate::windows::Returned>),
    /// Illisible (seulement après un changement de format) : signalé, pas envoyé.
    Unreadable(String),
}

/// Retire du cache le prochain message dont l'heure est passée à `now`, le
/// plus en retard d'abord ; `None` s'il n'y en a plus. Retiré avant l'envoi :
/// jamais envoyé deux fois, même si le fil s'arrête au milieu (le message
/// part, ou revient à la rédaction). Un seul à la fois : ceux qui attendent
/// encore restent au cache si Librix Mail se ferme entre deux envois.
fn take_next(cache: &Mutex<Cache>, now: i64) -> Option<Due> {
    let mut c = lock_cache(cache);
    let report = |e: &String| crate::diag::report(e);
    loop {
        let id = *c.scheduled_due(now).inspect_err(report).ok()?.first()?;
        // Pris entre-temps (« Modifier » dans la fenêtre principale) : au suivant.
        let Some(row) = c.scheduled_take(id).inspect_err(report).ok()? else { continue };
        return Some(match serde_json::from_str::<crate::windows::Returned>(&row.data) {
            Ok(message) => Due::Ready(Box::new(message)),
            Err(e) => Due::Unreadable(format!("message programmé illisible, non envoyé : {e}")),
        });
    }
}

/// Envoie, un par un, les messages dont l'heure est passée.
fn send_due(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else { return };
    let now = now();
    while let Some(due) = take_next(&state.cache, now) {
        crate::windows::scheduled_changed(app, None);
        match due {
            // Une panique pendant l'envoi rend déjà le message à la rédaction
            // (garde de `deliver`) ; elle est arrêtée ici pour que ce fil, seul à
            // envoyer les messages programmés, continue pour les suivants.
            Due::Ready(message) => {
                let sent = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    crate::commands::deliver(app, &state.router, &state.cache, *message);
                }));
                if sent.is_err() {
                    crate::diag::report("envoi d'un message programmé interrompu par une erreur interne");
                }
            }
            Due::Unreadable(error) => crate::diag::report(&error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message(subject: &str) -> String {
        let draft = mail_core::Draft { subject: subject.into(), to: vec!["a@example.fr".into()], ..Default::default() };
        let message = crate::windows::Returned {
            account_id: "a1".into(),
            draft,
            attachments: Vec::new(),
            answered_id: None,
            draft_id: None,
            window: String::new(),
        };
        serde_json::to_string(&message).expect("message sérialisé")
    }

    fn subject(due: Option<Due>) -> String {
        match due {
            Some(Due::Ready(m)) => m.draft.subject,
            other => panic!("message prêt attendu, reçu {other:?}"),
        }
    }

    #[test]
    fn w2_le_plus_en_retard_d_abord_un_seul_a_la_fois() {
        let cache = Mutex::new(Cache::in_memory().expect("cache"));
        {
            let mut c = lock_cache(&cache);
            c.scheduled_put("a1", 200, &message("deuxième")).expect("programmé");
            c.scheduled_put("a1", 100, &message("premier")).expect("programmé");
            c.scheduled_put("a1", 900, &message("plus tard")).expect("programmé");
        }
        assert_eq!(subject(take_next(&cache, 500)), "premier");
        // Un seul retiré : les autres attendent encore dans le cache.
        assert_eq!(lock_cache(&cache).scheduled_all().expect("liste").len(), 2);
        assert_eq!(subject(take_next(&cache, 500)), "deuxième");
        assert!(take_next(&cache, 500).is_none(), "« plus tard » n'est pas encore dû");
        assert_eq!(subject(take_next(&cache, 900)), "plus tard");
        assert!(take_next(&cache, 10_000).is_none(), "plus rien");
    }

    #[test]
    fn w2_message_illisible_retire_et_signale() {
        let cache = Mutex::new(Cache::in_memory().expect("cache"));
        lock_cache(&cache).scheduled_put("a1", 100, "{pas du json").expect("programmé");
        assert!(matches!(take_next(&cache, 500), Some(Due::Unreadable(e)) if e.contains("illisible")));
        assert!(lock_cache(&cache).scheduled_all().expect("liste").is_empty(), "retiré : ne bloque pas les suivants");
    }
}
