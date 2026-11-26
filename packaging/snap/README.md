# Snap de Librix Mail (lot PK3)

Nom du snap et de l'application : `librixmail`, confinement strict, socle `core26` (Ubuntu 26.04) avec
l'extension `gnome` (WebKitGTK 4.1 fourni par le snap `gnome-core26`). Le manifeste est
`snap/snapcraft.yaml`, à l'endroit où snapcraft le cherche.

## Outils, une fois

```bash
sudo snap install snapcraft --classic
sudo snap install lxd        # déjà fait sur fab-workstation
sudo lxd init --auto         # si LXD n'a jamais été initialisé
```

snapcraft construit dans un conteneur LXD : le groupe `lxd` doit être actif dans la session
(`newgrp lxd` sinon).

## Construire et essayer

```bash
make snap                                       # target/librixmail_<version>_amd64.snap
sudo snap install --dangerous target/librixmail_*_amd64.snap
sudo snap connect librixmail:password-manager-service
snap run librixmail
```

Seul le contenu **commité** est construit (le dépôt git sert de source, pour ne pas copier
`target/` ni `node_modules/`) : commiter, même sur une branche, avant `make snap`.

Ne pas lancer le snap depuis le shell ouvert par `newgrp lxd` : avec le groupe `lxd`, le portail du
bureau refuse l'application (choix de fichier, ouverture des pièces jointes). Le lancer depuis le menu
ou un terminal normal.

`--dangerous` : snap local, non signé par le Snap Store. Le trousseau n'est pas connecté d'office ;
sans lui, l'application l'indique avec la commande ci-dessus.

## Permissions (plugs)

| Plug | Pourquoi |
|---|---|
| `network`, `network-bind` | serveurs ; retour de la connexion OAuth sur un port local |
| `network-status` | état du réseau (portail NetworkMonitor), sans quoi l'interface se croit hors ligne |
| `home` | pièces jointes et sauvegardes dans Téléchargements |
| `password-manager-service` | trousseau (à connecter, demande de connexion automatique au forum snapcraft) |
| `gsettings` | réglages GTK |
| `unity7` | icône de la zone de notification |
| `single-instance` (dbus) | instance unique, nom `fr.librixmail.app.SingleInstance` |
| extension `gnome` | `desktop`, `desktop-legacy`, `wayland`, `x11`, `opengl` : fenêtre, notifications, portails |

## Données

Le snap a son propre dossier personnel : les données sont dans
`~/snap/librixmail/current/.local/share/fr.librixmail.app/`, séparées de celles du `.deb`. Pour passer
de l'un à l'autre : sauvegarde depuis l'ancienne installation, puis restauration dans le snap.

## Publication

À chaque étiquette `v*`, le job `snap` de `release.yml` construit le snap et l'envoie au canal `edge`
du Snap Store, si le secret `SNAPCRAFT_STORE_CREDENTIALS` existe. Le créer une fois (identifiants
limités à ce snap et au canal edge) :

```bash
snapcraft export-login --snaps=librixmail --channels=edge \
  --acls package_access,package_push,package_update,package_release - | gh secret set SNAPCRAFT_STORE_CREDENTIALS
```

Passage en `stable`, à la main après essai de la révision `edge` :

```bash
snapcraft status librixmail
snapcraft release librixmail <révision> stable
```

Connexions automatiques (trousseau, instance unique) : demandées sur le forum snapcraft, catégorie
« store-requests ». En attendant, `snap connect` à la main (voir plus haut).
