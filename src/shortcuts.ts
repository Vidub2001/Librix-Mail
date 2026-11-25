// Raccourcis clavier de la fenêtre principale (lot V) : une seule liste, pour
// les touches reconnues, les infobulles et la fenêtre d'aide (« ? »).
import { t } from "./i18n";

export type ShortcutId =
  | "reply"
  | "replyAll"
  | "forward"
  | "compose"
  | "send"
  | "seen"
  | "flag"
  | "archive"
  | "delete"
  | "next"
  | "previous"
  | "search"
  | "help";

interface Shortcut {
  id: ShortcutId;
  /** Touches telles qu'affichées (« Maj+R », « Ctrl+N »). */
  keys: () => string;
  /** Mêmes touches pour `aria-keyshortcuts` (« Shift+R », « Control+N »). */
  aria: string;
  label: () => string;
}

/** Dans l'ordre de la fenêtre d'aide. */
export const SHORTCUTS: Shortcut[] = [
  { id: "compose", keys: () => t("Ctrl+N"), aria: "Control+N", label: () => t("Nouveau message") },
  { id: "reply", keys: () => "R", aria: "R", label: () => t("Répondre") },
  { id: "replyAll", keys: () => t("Maj+R"), aria: "Shift+R", label: () => t("Répondre à tous") },
  { id: "forward", keys: () => "F", aria: "F", label: () => t("Transférer") },
  { id: "send", keys: () => t("Ctrl+Entrée"), aria: "Control+Enter", label: () => t("Envoyer (fenêtre de rédaction)") },
  { id: "seen", keys: () => "M", aria: "M", label: () => t("Marquer comme lu ou non lu") },
  { id: "flag", keys: () => "S", aria: "S", label: () => t("Ajouter ou retirer l'indicateur de suivi") },
  { id: "archive", keys: () => "A", aria: "A", label: () => t("Archiver") },
  { id: "delete", keys: () => t("Suppr"), aria: "Delete", label: () => t("Supprimer") },
  { id: "next", keys: () => t("J ou ↓"), aria: "J", label: () => t("Message suivant") },
  { id: "previous", keys: () => t("K ou ↑"), aria: "K", label: () => t("Message précédent") },
  { id: "search", keys: () => "/", aria: "/", label: () => t("Rechercher") },
  { id: "help", keys: () => "?", aria: "?", label: () => t("Afficher cette aide") },
];

/** Raccourci d'une action, s'il y en a un. */
export function shortcut(id: string): Shortcut | undefined {
  return SHORTCUTS.find((x) => x.id === id);
}

/** Touches d'un raccourci, pour une infobulle : « Répondre (R) ». */
export function withKeys(label: string, id: ShortcutId): string {
  const s = SHORTCUTS.find((x) => x.id === id);
  return s ? `${label} (${s.keys()})` : label;
}

/**
 * Raccourci d'une touche pressée hors d'un champ de saisie, ou null. Les
 * lettres seules ne valent que sans Ctrl, Alt ni Cmd : Ctrl+A reste « tout
 * sélectionner » dans la liste, Ctrl+R n'est pas « Répondre ».
 */
export function shortcutFor(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey">): ShortcutId | null {
  const command = e.ctrlKey || e.metaKey;
  if (e.altKey) return null;
  if (command) return !e.shiftKey && e.key.toLowerCase() === "n" ? "compose" : null;
  switch (e.key) {
    case "?":
      return "help";
    case "/":
      return "search";
    case "Delete":
      return "delete";
  }
  // Majuscule : seul « Maj+R » a un sens ; une lettre en verrouillage des majuscules compte comme sans Maj.
  const key = e.key.length === 1 ? e.key.toLowerCase() : "";
  if (e.shiftKey) return key === "r" ? "replyAll" : null;
  const plain: Record<string, ShortcutId> = {
    r: "reply",
    f: "forward",
    m: "seen",
    s: "flag",
    a: "archive",
    j: "next",
    k: "previous",
  };
  return plain[key] ?? null;
}
