# Flatpak de Librix Mail (lot PK2)

Identifiant Flatpak : `fr.librixmail.Client` (l'identifiant Tauri reste `fr.librixmail.app`).
Socle GNOME 51 (WebKitGTK 4.1), construit depuis les sources sans réseau pendant la compilation.

| Fichier | Rôle |
|---|---|
| `fr.librixmail.Client.yml` | manifeste : socle, permissions, Rust 1.100, compilation |
| `fr.librixmail.Client.metainfo.xml` | fiche AppStream (FR, EN, ES), captures servies par librixmail.fr |
| `fr.librixmail.Client.desktop` | lanceur |
| `generated/` | sources cargo et npm (`make flatpak-sources`), non versionnées |

## Outils, une fois

```bash
sudo apt install flatpak flatpak-builder python3-aiohttp python3-tomlkit pipx
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user flathub org.gnome.Sdk//51 org.freedesktop.Sdk.Extension.node22//26.08 org.flatpak.Builder
git clone https://github.com/flatpak/flatpak-builder-tools ~/outils/flatpak-builder-tools
pipx install ~/outils/flatpak-builder-tools/node
```

Autre emplacement des outils : `make flatpak FLATPAK_TOOLS=/chemin/flatpak-builder-tools`.

## Construire et essayer

```bash
make flatpak          # sources, construction, installation, target/Librix.Mail_x86_64.flatpak
flatpak run fr.librixmail.Client
make flatpak-lint     # contrôles de Flathub (manifeste, fiche, lanceur)
```

`make flatpak-sources` est à refaire après chaque changement de `Cargo.lock` ou de `package-lock.json`
(`make flatpak` le fait).

## Permissions

| Permission | Pourquoi |
|---|---|
| `--share=network`, `--share=ipc` | serveurs de courrier, d'agenda et de contacts ; affichage X11 |
| `--socket=wayland`, `--socket=fallback-x11`, `--device=dri` | fenêtre et rendu de WebKitGTK |
| `--filesystem=xdg-download` | pièces jointes et sauvegardes enregistrées dans Téléchargements |
| `--talk-name=org.freedesktop.Notifications` | notifications des nouveaux messages et des rappels |
| `--talk-name=org.freedesktop.secrets` | mots de passe et jetons dans le trousseau |
| `--talk-name=org.kde.StatusNotifierWatcher` | icône de la zone de notification |
| `--own-name=org.kde.StatusNotifierItem-2-1` | nom que réserve tray-icon 0.25 ; à retirer quand il s'en passera |

Rien d'autre du dossier personnel : les fichiers ouverts passent par le portail OpenURI, et l'instance
unique réserve `fr.librixmail.Client.SingleInstance`, sous l'identifiant de l'application.

## Données

Dans le bac à sable, les données sont dans `~/.var/app/fr.librixmail.Client/data/fr.librixmail.app/`,
séparées de celles du `.deb` ou de l'AppImage. Pour passer de l'un à l'autre : sauvegarde depuis
l'ancienne installation, puis restauration dans le Flatpak (Paramètres › Sauvegarde).

## À chaque version

- ajouter la version et sa date dans `<releases>` de la fiche ;
- quand l'extension `org.freedesktop.Sdk.Extension.rust-stable` de Flathub atteint 1.100, remplacer
  le module `rust` du manifeste par cette extension.
