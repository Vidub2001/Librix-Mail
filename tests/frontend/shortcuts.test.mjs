// Raccourcis clavier de la fenêtre principale (lot V).
import { test } from "node:test";
import assert from "node:assert/strict";

const { shortcutFor, withKeys } = await import("../../src/shortcuts.ts");

const key = (k, mods = {}) => ({ key: k, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...mods });

test("V : lettres seules, Maj+R, Ctrl+N, touches spéciales", () => {
  assert.equal(shortcutFor(key("r")), "reply");
  assert.equal(shortcutFor(key("R", { shiftKey: true })), "replyAll");
  assert.equal(shortcutFor(key("R")), "reply", "verrouillage des majuscules : comme sans Maj");
  assert.equal(shortcutFor(key("f")), "forward");
  assert.equal(shortcutFor(key("m")), "seen");
  assert.equal(shortcutFor(key("s")), "flag");
  assert.equal(shortcutFor(key("a")), "archive");
  assert.equal(shortcutFor(key("j")), "next");
  assert.equal(shortcutFor(key("k")), "previous");
  assert.equal(shortcutFor(key("/")), "search");
  assert.equal(shortcutFor(key("?", { shiftKey: true })), "help");
  assert.equal(shortcutFor(key("Delete")), "delete");
  assert.equal(shortcutFor(key("n", { ctrlKey: true })), "compose");
  assert.equal(shortcutFor(key("N", { metaKey: true })), "compose");
});

test("V : rien avec Ctrl, Alt ou Cmd, ni pour les autres touches", () => {
  assert.equal(shortcutFor(key("a", { ctrlKey: true })), null, "Ctrl+A reste « tout sélectionner »");
  assert.equal(shortcutFor(key("r", { ctrlKey: true })), null);
  assert.equal(shortcutFor(key("r", { altKey: true })), null);
  assert.equal(shortcutFor(key("F", { shiftKey: true })), null);
  assert.equal(shortcutFor(key("x")), null);
  assert.equal(shortcutFor(key("Enter")), null);
  assert.equal(shortcutFor(key("ArrowDown")), null);
});

test("V : infobulle avec les touches", () => {
  assert.equal(withKeys("Répondre", "reply"), "Répondre (R)");
});
