// Conversations dans la liste (lot U2) : une ligne par conversation, son
// message le plus haut dans l'ordre de la liste ; dépliée, les autres
// messages du dossier et les messages envoyés suivent. Décisions de Fabrice
// du 24 novembre 2026 : une conversation repliée agit en entier (supprimer,
// déplacer, marquer lu), les envoyés sont comptés et montrés dépliés, le
// regroupement suit tous les tris.
import type { FolderConversations, MessageSummary } from "./types";

/** Place d'un message dans les conversations de la liste. */
export interface ThreadInfo {
  conversation: number;
  /** Première ligne de la conversation (repliée ou non). */
  head: boolean;
  /** Messages de la conversation : ceux du dossier dans la liste, et les envoyés. */
  count: number;
  /** Non lus parmi ceux du dossier. */
  unread: number;
  expanded: boolean;
  /** Message envoyé, montré dans la conversation dépliée. */
  sent: boolean;
}

export interface ThreadRows {
  /** Lignes à afficher, dans l'ordre. */
  rows: MessageSummary[];
  /** Pour chaque ligne d'une conversation de plus d'un message. */
  info: Map<number, ThreadInfo>;
  /** Messages du dossier de chaque conversation, dans l'ordre de la liste. */
  members: Map<number, number[]>;
}

/** Lignes de la liste regroupées en conversations ; `list` est déjà filtrée et triée. */
export function threadRows(list: MessageSummary[], conv: FolderConversations, expanded: ReadonlySet<number>): ThreadRows {
  const numberOf = (m: MessageSummary): number | undefined => conv.conversation[String(m.id)];
  const members = new Map<number, number[]>();
  const unread = new Map<number, number>();
  for (const m of list) {
    const n = numberOf(m);
    if (n === undefined) continue;
    members.set(n, [...(members.get(n) ?? []), m.id]);
    if (!m.flags.seen) unread.set(n, (unread.get(n) ?? 0) + 1);
  }
  const sent = new Map<number, MessageSummary[]>();
  for (const s of conv.sent) {
    if (members.has(s.conversation)) sent.set(s.conversation, [...(sent.get(s.conversation) ?? []), s.message]);
  }
  const byId = new Map(list.map((m) => [m.id, m]));
  const rows: MessageSummary[] = [];
  const info = new Map<number, ThreadInfo>();
  const done = new Set<number>();
  for (const m of list) {
    const n = numberOf(m);
    const own = n === undefined ? [] : (members.get(n) ?? []);
    const others = n === undefined ? [] : (sent.get(n) ?? []);
    if (n === undefined || own.length + others.length < 2) {
      rows.push(m);
      continue;
    }
    if (done.has(n)) continue;
    done.add(n);
    const open = expanded.has(n);
    const base = { conversation: n, count: own.length + others.length, unread: unread.get(n) ?? 0, expanded: open };
    rows.push(m);
    info.set(m.id, { ...base, head: true, sent: false });
    if (!open) continue;
    // Dépliée : les autres messages du dossier et les envoyés, du plus récent au plus ancien.
    const rest = [...own.filter((id) => id !== m.id).map((id) => byId.get(id)!), ...others].sort((a, b) => b.date - a.date);
    for (const r of rest) {
      const isSent = others.includes(r);
      rows.push(r);
      info.set(r.id, { ...base, head: false, sent: isSent });
    }
  }
  return { rows, info, members };
}

/**
 * Messages sur lesquels agir : une conversation repliée l'est en entier (ses
 * messages du dossier, jamais les envoyés), une conversation dépliée message
 * par message.
 */
export function withConversations(ids: number[], threads: ThreadRows | null): number[] {
  if (!threads) return ids;
  const out = new Set<number>();
  for (const id of ids) {
    const t = threads.info.get(id);
    if (t?.head && !t.expanded) for (const m of threads.members.get(t.conversation) ?? []) out.add(m);
    else out.add(id);
  }
  return [...out];
}

/**
 * Conversations de plusieurs dossiers (boîte de réception unifiée) : les
 * numéros de chacun décalés pour ne pas se mêler. Une conversation qui
 * s'étend sur deux comptes reste deux conversations.
 */
export function mergeConversations(all: FolderConversations[]): FolderConversations {
  const conversation: Record<string, number> = {};
  const sent: FolderConversations["sent"] = [];
  all.forEach((c, i) => {
    const offset = i * 1_000_000;
    for (const [id, n] of Object.entries(c.conversation)) conversation[id] = n + offset;
    for (const s of c.sent) sent.push({ conversation: s.conversation + offset, message: s.message });
  });
  return { conversation, sent };
}
