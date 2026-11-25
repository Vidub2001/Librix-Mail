import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from "@fluentui/react-components";
import { t } from "../i18n";
import { SHORTCUTS } from "../shortcuts";

/** Liste des raccourcis clavier (lot V), ouverte par « ? ». */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface className="small-dialog shortcuts-dialog">
        <DialogBody>
          <DialogTitle>{t("Raccourcis clavier")}</DialogTitle>
          <DialogContent>
            <table className="shortcuts-table">
              <tbody>
                {SHORTCUTS.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <kbd>{s.keys()}</kbd>
                    </td>
                    <td>{s.label()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">{t("Les lettres seules n'agissent pas pendant la saisie dans un champ.")}</p>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={onClose}>
              {t("Fermer")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
