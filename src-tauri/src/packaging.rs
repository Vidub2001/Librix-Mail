//! Paquet dans lequel tourne Librix Mail (lot PK1) : installation classique
//! (.deb, `AppImage`, installateur Windows, version portable), Flatpak ou Snap.
//!
//! Dans un bac à sable, le magasin de logiciels installe les mises à jour,
//! les fichiers s'ouvrent par le portail du bureau, et le Snap voit un dossier
//! personnel à lui : le dossier Téléchargements de l'utilisateur se lit dans
//! sa configuration réelle.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Lanceur installé par le `.deb` (`Librix Mail.desktop`, d'après `productName`).
#[cfg(target_os = "linux")]
const NATIVE_DESKTOP_ENTRY: &str = "Librix Mail";
/// Nom de l'application dans `snap/snapcraft.yaml` (`apps:`) : snapd nomme
/// le lanceur `<snap>_<application>.desktop`. À changer avec le manifeste.
#[cfg(target_os = "linux")]
const SNAP_APP: &str = "librixmail";

/// Paquet dans lequel tourne l'application.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Packaging {
    /// Installation sans bac à sable : mises à jour signalées par GitHub.
    Native,
    /// Flatpak (Flathub, ou fichier `.flatpak`).
    Flatpak,
    /// Snap (Snap Store).
    Snap,
}

impl Packaging {
    /// Paquet d'après l'environnement que posent Flatpak (`FLATPAK_ID`) et
    /// snapd (`SNAP_NAME`).
    fn detect(flatpak_id: Option<&str>, snap_name: Option<&str>) -> Self {
        if flatpak_id.is_some_and(|id| !id.is_empty()) {
            Self::Flatpak
        } else if snap_name.is_some_and(|name| !name.is_empty()) {
            Self::Snap
        } else {
            Self::Native
        }
    }

    /// Paquet de l'application en cours, lu une fois.
    pub(crate) fn current() -> Self {
        static CURRENT: OnceLock<Packaging> = OnceLock::new();
        *CURRENT.get_or_init(|| {
            let flatpak = std::env::var("FLATPAK_ID").ok();
            let snap = std::env::var("SNAP_NAME").ok();
            Self::detect(flatpak.as_deref(), snap.as_deref())
        })
    }

    /// Les mises à jour viennent-elles du magasin de logiciels (et non de GitHub) ?
    pub(crate) fn is_sandboxed(self) -> bool {
        self != Self::Native
    }

    /// Canal des mises à jour, transmis à l'interface : `github`, `flatpak` ou `snap`.
    pub(crate) fn update_channel(self) -> &'static str {
        match self {
            Self::Native => "github",
            Self::Flatpak => "flatpak",
            Self::Snap => "snap",
        }
    }

    /// Lanceur (`.desktop`, sans extension) auquel le bureau rattache les
    /// notifications : celui du paquet. Flatpak le nomme d'après
    /// l'identifiant, snapd d'après le snap et l'application
    /// (`BAMF_DESKTOP_FILE_HINT` donne son chemin).
    #[cfg(target_os = "linux")]
    pub(crate) fn desktop_entry(self) -> String {
        match self {
            Self::Native => NATIVE_DESKTOP_ENTRY.to_owned(),
            Self::Flatpak => std::env::var("FLATPAK_ID").unwrap_or_else(|_| NATIVE_DESKTOP_ENTRY.to_owned()),
            Self::Snap => std::env::var_os("BAMF_DESKTOP_FILE_HINT")
                .and_then(|hint| Path::new(&hint).file_stem().map(|s| s.to_string_lossy().into_owned()))
                .or_else(|| std::env::var("SNAP_INSTANCE_NAME").ok().map(|name| format!("{name}_{SNAP_APP}")))
                .unwrap_or_else(|| NATIVE_DESKTOP_ENTRY.to_owned()),
        }
    }

    /// Préfixe du nom D-Bus de l'instance unique (lot PK2). Dans le Flatpak,
    /// l'identifiant du paquet : le bac à sable laisse l'application réserver
    /// les noms qui commencent par lui (`fr.librixmail.Client.SingleInstance`),
    /// pas celui que Tauri tire de son identifiant (`fr.librixmail.app`).
    /// `None` : celui de Tauri.
    pub(crate) fn dbus_id(self) -> Option<String> {
        match self {
            Self::Flatpak => std::env::var("FLATPAK_ID").ok().filter(|id| !id.is_empty()),
            Self::Native | Self::Snap => None,
        }
    }

    /// Dossier Téléchargements de l'utilisateur, quand le paquet ne le voit
    /// pas à sa place habituelle : le Snap a son propre dossier personnel
    /// (`HOME`), le vrai étant `SNAP_REAL_HOME`. `None` : celui que donne Tauri.
    pub(crate) fn downloads_dir(self) -> Option<PathBuf> {
        if self != Self::Snap {
            return None;
        }
        let home = PathBuf::from(std::env::var_os("SNAP_REAL_HOME")?);
        let user_dirs = std::fs::read_to_string(home.join(".config/user-dirs.dirs")).ok();
        Some(downloads_in(&home, user_dirs.as_deref()))
    }
}

/// Dossier Téléchargements d'après `user-dirs.dirs` (`XDG_DOWNLOAD_DIR`) :
/// `$HOME` remplacé par le vrai dossier personnel, ou chemin absolu sous
/// lui ; sinon `~/Downloads`. Un chemin qui sortirait du dossier personnel
/// est refusé (le Snap n'y écrit pas).
fn downloads_in(home: &Path, user_dirs: Option<&str>) -> PathBuf {
    let configured = user_dirs.and_then(|text| {
        text.lines().find_map(|line| {
            let value = line.trim().strip_prefix("XDG_DOWNLOAD_DIR=")?.trim().trim_matches('"');
            // `$HOME/…` (forme écrite par xdg-user-dirs), ou chemin absolu sous le dossier personnel.
            let rest = match value.strip_prefix("$HOME") {
                Some(rest) => rest,
                None => Path::new(value).strip_prefix(home).ok()?.to_str()?,
            };
            let rest = rest.trim_start_matches('/');
            (!rest.is_empty() && !Path::new(rest).components().any(|c| matches!(c, std::path::Component::ParentDir)))
                .then(|| home.join(rest))
        })
    });
    configured.unwrap_or_else(|| home.join("Downloads"))
}

/// Ouvre un fichier avec l'application choisie par l'utilisateur, par le
/// portail du bureau (`org.freedesktop.portal.OpenURI.OpenFile`) : dans un
/// bac à sable, `xdg-open` ne sait pas toujours ouvrir un fichier (celui du
/// Snap ne prend que des adresses). Le portail reçoit le fichier lui-même,
/// pas son chemin, qui n'existe pas forcément hors du bac à sable.
///
/// # Errors
///
/// Fichier illisible, bus de session ou portail indisponible.
#[cfg(target_os = "linux")]
pub(crate) fn open_file_with_portal(path: &Path) -> Result<(), String> {
    use std::collections::HashMap;
    use std::os::fd::AsFd;

    use zbus::zvariant::{Fd, OwnedObjectPath, Value};

    let file = std::fs::File::open(path).map_err(|e| tr!("impossible d'ouvrir le fichier : {e}", e = e))?;
    let portal = |e: zbus::Error| tr!("impossible d'ouvrir le fichier : {e}", e = e);
    let connection = zbus::blocking::Connection::session().map_err(portal)?;
    let proxy = zbus::blocking::Proxy::new(
        &connection,
        "org.freedesktop.portal.Desktop",
        "/org/freedesktop/portal/desktop",
        "org.freedesktop.portal.OpenURI",
    )
    .map_err(portal)?;
    let options: HashMap<&str, Value<'_>> = HashMap::new();
    let _request: OwnedObjectPath = proxy.call("OpenFile", &("", Fd::from(file.as_fd()), options)).map_err(portal)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{downloads_in, Packaging};

    #[test]
    fn pk1_paquet_detecte() {
        assert_eq!(Packaging::detect(None, None), Packaging::Native);
        assert_eq!(Packaging::detect(Some(""), Some("")), Packaging::Native, "variables vides");
        assert_eq!(Packaging::detect(Some("fr.librixmail.Client"), None), Packaging::Flatpak);
        assert_eq!(Packaging::detect(None, Some("librixmail")), Packaging::Snap);
        assert!(!Packaging::Native.is_sandboxed());
        assert!(Packaging::Flatpak.is_sandboxed() && Packaging::Snap.is_sandboxed());
        assert_eq!(Packaging::Snap.update_channel(), "snap");
    }

    #[test]
    fn pk1_telechargements_du_snap() {
        let home = Path::new("/home/fabrice");
        let fr = "# commentaire\nXDG_DESKTOP_DIR=\"$HOME/Bureau\"\nXDG_DOWNLOAD_DIR=\"$HOME/Téléchargements\"\n";
        assert_eq!(downloads_in(home, Some(fr)), home.join("Téléchargements"));
        assert_eq!(downloads_in(home, None), home.join("Downloads"), "sans configuration");
        // Hors du dossier personnel, ou remontant au-dessus : dossier par défaut.
        assert_eq!(downloads_in(home, Some("XDG_DOWNLOAD_DIR=\"/tmp\"\n")), home.join("Downloads"));
        // Chemin absolu sous le dossier personnel : gardé.
        assert_eq!(downloads_in(home, Some("XDG_DOWNLOAD_DIR=\"/home/fabrice/Téléchargements\"\n")), home.join("Téléchargements"));
        assert_eq!(downloads_in(home, Some("XDG_DOWNLOAD_DIR=\"/home/fabrice2/x\"\n")), home.join("Downloads"), "autre dossier personnel");
        assert_eq!(downloads_in(home, Some("XDG_DOWNLOAD_DIR=\"$HOME/../autre\"\n")), home.join("Downloads"));
        assert_eq!(downloads_in(home, Some("XDG_DOWNLOAD_DIR=\"$HOME\"\n")), home.join("Downloads"), "dossier personnel lui-même");
    }
}
