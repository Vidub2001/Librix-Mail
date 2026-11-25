// Conversations dans la liste (lot U2) : `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { threadRows, withConversations } from "../../src/conversations.ts";

const msg = (id, date, seen = true) => ({ id, date, subject: `m${id}`, flags: { seen, flagged: false, answered: false } });
// Liste triée du plus récent au plus ancien : 5 et 2 dans une conversation, 4 seul, 3 et un envoyé (9).
const list = [msg(5, 50, false), msg(4, 40), msg(3, 30), msg(2, 20, false)];
const conv = {
  conversation: { 5: 0, 4: 1, 3: 2, 2: 0 },
  sent: [
    { conversation: 2, message: msg(9, 35) },
    { conversation: 7, message: msg(8, 10) },
  ],
};

test("U2 : une ligne par conversation, repliée", () => {
  const t = threadRows(list, conv, new Set());
  assert.deepEqual(t.rows.map((m) => m.id), [5, 4, 3]);
  assert.deepEqual(t.info.get(5), { conversation: 0, count: 2, unread: 2, expanded: false, head: true, sent: false });
  assert.equal(t.info.get(4), undefined, "message seul : ligne ordinaire");
  assert.equal(t.info.get(3).count, 2, "l'envoyé est compté");
  assert.deepEqual(t.members.get(0), [5, 2]);
});

test("U2 : dépliée, les autres messages et les envoyés suivent, du plus récent au plus ancien", () => {
  const t = threadRows(list, conv, new Set([0, 2]));
  assert.deepEqual(t.rows.map((m) => m.id), [5, 2, 4, 3, 9]);
  assert.equal(t.info.get(2).head, false);
  assert.equal(t.info.get(9).sent, true);
});

test("U2 : une conversation repliée agit en entier, jamais sur les envoyés", () => {
  const closed = threadRows(list, conv, new Set());
  assert.deepEqual(withConversations([5, 4], closed).sort(), [2, 4, 5]);
  assert.deepEqual(withConversations([3], closed), [3], "l'envoyé 9 n'est pas touché");
  const open = threadRows(list, conv, new Set([0]));
  assert.deepEqual(withConversations([5], open), [5], "dépliée : message par message");
  assert.deepEqual(withConversations([5], null), [5], "sans conversations");
});

test("U2 : boîte unifiée, conversations de chaque dossier sans mélange", async () => {
  const { mergeConversations } = await import("../../src/conversations.ts");
  const merged = mergeConversations([
    { conversation: { 1: 0 }, sent: [] },
    { conversation: { 2: 0 }, sent: [{ conversation: 0, message: msg(9, 1) }] },
  ]);
  assert.notEqual(merged.conversation[1], merged.conversation[2]);
  assert.equal(merged.sent[0].conversation, merged.conversation[2]);
});
