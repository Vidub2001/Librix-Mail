// Conversation dans le volet de lecture (lot U3) : ses messages du plus
// ancien au plus récent, en lignes compactes ; celui affiché en dessous est
// marqué, un clic sur un autre l'ouvre à sa place. Les messages envoyés
// (dossier « Éléments envoyés ») en font partie.
import { Avatar } from "@fluentui/react-components";
import { t } from "../i18n";
import { listDate } from "../format";
import type { MessageSummary } from "../types";

interface Props {
  messages: MessageSummary[];
  /** Message affiché dans le volet. */
  shownId: number | null;
  /** Identifiants des messages envoyés de la conversation. */
  sentIds: ReadonlySet<number>;
  onPick: (id: number) => void;
}

export function ConversationStrip({ messages, shownId, sentIds, onPick }: Props) {
  return (
    <nav className="conversation-strip" aria-label={t("Messages de la conversation")}>
      <div className="conversation-strip-title">{t("{n} messages dans la conversation", { n: messages.length })}</div>
      <ol>
        {messages.map((m) => {
          const shown = m.id === shownId;
          return (
            <li key={m.id}>
              <button
                type="button"
                className={["conversation-item", shown && "shown", !m.flags.seen && "unread"].filter(Boolean).join(" ")}
                aria-current={shown ? "true" : undefined}
                onClick={() => onPick(m.id)}
              >
                <Avatar name={m.fromName || m.fromEmail} size={24} color="colorful" />
                <span className="conversation-from">
                  {sentIds.has(m.id) ? t("Vous") : m.fromName || m.fromEmail}
                </span>
                <span className="conversation-preview">{m.preview}</span>
                <span className="conversation-date">{listDate(m.date)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
