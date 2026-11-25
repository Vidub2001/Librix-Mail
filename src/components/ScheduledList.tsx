import { Button } from "@fluentui/react-components";
import { Delete20Regular, Edit20Regular, Send20Regular, SendClock20Regular } from "@fluentui/react-icons";
import { longDate } from "../format";
import { t } from "../i18n";
import type { Account, ScheduledItem } from "../types";

interface Props {
  items: ScheduledItem[];
  accounts: Account[];
  onEdit: (item: ScheduledItem) => void;
  onSendNow: (item: ScheduledItem) => void;
  onDelete: (item: ScheduledItem) => void;
}

/**
 * « À envoyer » (lot W2) : messages programmés, du plus proche au plus
 * lointain, à la place de la liste des messages. Chacun se modifie (rouvert
 * dans la rédaction, retiré du programme), part tout de suite, ou se supprime.
 */
export function ScheduledList({ items, accounts, onEdit, onSendNow, onDelete }: Props) {
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  return (
    <section className="pane message-list scheduled-list" aria-label={t("À envoyer")}>
      <div className="list-header scheduled-header">
        <h2 className="list-title">
          <SendClock20Regular /> {t("À envoyer")}
        </h2>
        <p className="muted small">{t("Envoyés à l'heure choisie si Librix Mail est ouvert, sinon à son prochain démarrage.")}</p>
      </div>
      {items.length === 0 ? (
        <div className="list-empty">{t("Aucun message programmé.")}</div>
      ) : (
        <ul className="scheduled-items">
          {items.map((item) => {
            const account = accountById.get(item.accountId);
            return (
              <li key={item.id} className="scheduled-item">
                <div className="scheduled-when">
                  <span className="account-dot" style={{ background: account?.color }} title={account?.email} />
                  <strong>{longDate(item.sendAt)}</strong>
                </div>
                <div className="scheduled-subject">{item.subject || t("(sans objet)")}</div>
                <div className="muted small scheduled-to">{t("À : {to}", { to: item.to.join(", ") })}</div>
                <div className="scheduled-actions">
                  <Button size="small" icon={<Edit20Regular />} onClick={() => onEdit(item)}>
                    {t("Modifier")}
                  </Button>
                  <Button size="small" icon={<Send20Regular />} onClick={() => onSendNow(item)}>
                    {t("Envoyer maintenant")}
                  </Button>
                  <Button size="small" appearance="subtle" icon={<Delete20Regular />} onClick={() => onDelete(item)}>
                    {t("Supprimer")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
