; Crochets de l'installateur Windows (NSIS), appelés par celui de Tauri
; (`bundle.windows.nsis.installerHooks`, lot M2).
;
; Les notifications de Librix Mail portent l'identifiant de l'application
; (AppUserModelID `fr.librixmail.app`, identifiant de tauri.conf.json).
; Windows en tire le nom et l'icône affichés dans le centre de notifications
; par le raccourci du menu Démarrer. Un raccourci créé par une version
; précédente garde l'identifiant qu'il avait : une mise à jour ne change que
; sa cible, pas son identifiant. Les notifications y apparaissaient alors sous
; l'identifiant brut, sans nom ni icône.
;
; L'identifiant est donc aussi déclaré dans le registre de l'utilisateur, comme
; Microsoft le décrit pour les applications non empaquetées : nom et icône des
; notifications, quel que soit le raccourci. L'icône `notifications.png` est
; posée dans le dossier d'installation par `tauri.windows.conf.json`.

!define LIBRIX_AUMID_KEY "Software\Classes\AppUserModelId\fr.librixmail.app"

; Installation faite sous l'ancien nom de l'application (nom de produit
; précédent, donc autre dossier et autre entrée « Applications installées ») :
; son désinstalleur est lancé sans fenêtre avant la copie des fichiers, pour
; ne pas laisser deux applications côte à côte. Sans fenêtre, la case
; « Supprimer les données de l'application » reste décochée : comptes, cache
; et réglages restent en place, et l'application les reprend à son premier
; lancement (src-tauri/src/migrate.rs). `_?=` fait attendre la fin de la
; désinstallation ; le désinstalleur, qui ne peut alors pas s'effacer
; lui-même, est retiré ensuite avec son dossier s'il est vide.
!define LIBRIX_OLD_UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Vortex Mail"

!macro NSIS_HOOK_PREINSTALL
  Push $R8
  Push $R9
  ReadRegStr $R9 HKCU "${LIBRIX_OLD_UNINSTKEY}" "UninstallString"
  ReadRegStr $R8 HKCU "${LIBRIX_OLD_UNINSTKEY}" "InstallLocation"
  ; Valeurs écrites entre guillemets : retirés pour `_?=`.
  StrCpy $R8 $R8 -1 1
  ${If} $R9 != ""
  ${AndIf} $R8 != ""
  ${AndIf} ${FileExists} "$R8\uninstall.exe"
    ExecWait '"$R8\uninstall.exe" /S _?=$R8'
    Delete "$R8\uninstall.exe"
    RMDir "$R8"
  ${EndIf}
  Pop $R9
  Pop $R8
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegExpandStr HKCU "${LIBRIX_AUMID_KEY}" "DisplayName" "Librix Mail"
  WriteRegExpandStr HKCU "${LIBRIX_AUMID_KEY}" "IconUri" "$INSTDIR\notifications.png"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey HKCU "${LIBRIX_AUMID_KEY}"
!macroend
