// Réglages de « Paramètres › Courrier » : signatures et pièce jointe oubliée.
// Hors de Tauri, le stockage sûr passe par `localStorage` (setup.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.window ??= new EventTarget();
const { accountSignatures, attachmentMention, loadSettings, ownText, saveSettings, signatureBlock, signatureContent } = await import("../../src/settings.ts");

test("réglages par défaut, puis enregistrés et signalés aux autres vues", () => {
  localStorage.removeItem("librix.mail");
  assert.equal(loadSettings().signatureOnReplies, true);
  let changed = 0;
  window.addEventListener("librix-settings", () => (changed += 1));
  saveSettings({ ...loadSettings(), signatureOnReplies: false });
  assert.equal(loadSettings().signatureOnReplies, false);
  assert.equal(changed, 1, "les autres vues sont prévenues");
  localStorage.setItem("librix.mail", "{pas du json");
  assert.equal(loadSettings().signatureOnReplies, true, "réglages illisibles : valeurs par défaut");
});

test("signature échappée, lignes vides gardées, ajoutée d'office selon le type de message", () => {
  localStorage.removeItem("librix.mail");
  saveSettings({ ...loadSettings(), signatures: { perso: "Fabrice <F>\n\nLibrix & co\n\n" } });
  assert.equal(signatureContent("perso"), "Fabrice &lt;F&gt;<br><br><br>Librix &amp; co");
  assert.equal(signatureContent("pro"), "", "compte sans signature");
  assert.match(signatureBlock("perso", "new"), /^<p><br><\/p><div data-signature="s1">Fabrice/);
  assert.equal(signatureBlock("pro", "new"), "");
  assert.notEqual(signatureBlock("perso", "reply"), "", "réponses signées par défaut");
  assert.notEqual(signatureBlock("perso", "forward"), "", "transferts signés par défaut");
  // T3 : chaque type de message a son réglage.
  saveSettings({ ...loadSettings(), signatureOnReplies: false });
  assert.equal(signatureBlock("perso", "reply"), "");
  assert.notEqual(signatureBlock("perso", "forward"), "", "le transfert garde son réglage");
  saveSettings({ ...loadSettings(), signatureOnForwards: false, signatureOnNew: false });
  assert.equal(signatureBlock("perso", "forward"), "");
  assert.equal(signatureBlock("perso", "new"), "");
});

test("T3 : réglage d'avant (réponses et transferts ensemble) repris pour les transferts", () => {
  localStorage.setItem("librix.mail", JSON.stringify({ signatureOnReplies: false }));
  assert.equal(loadSettings().signatureOnForwards, false);
  assert.equal(loadSettings().signatureOnNew, true);
  localStorage.setItem("librix.mail", JSON.stringify({ signatureOnReplies: false, signatureOnForwards: true }));
  assert.equal(loadSettings().signatureOnForwards, true);
});

test("T4 : plusieurs signatures, celle par défaut ajoutée d'office, l'ancienne reprise comme première", () => {
  localStorage.setItem("librix.mail", JSON.stringify({ htmlSignatures: { perso: "<b>Ancienne</b>" } }));
  const old = accountSignatures("perso");
  assert.equal(old.list.length, 1);
  assert.equal(old.defaultId, old.list[0].id);
  assert.equal(signatureContent("perso"), "<b>Ancienne</b>");
  saveSettings({
    ...loadSettings(),
    signatureSets: {
      perso: {
        list: [
          { id: "a1", name: "Courte", html: "", text: "Fabrice" },
          { id: "b2", name: "Longue", html: "<b>Fabrice Joffre</b>", text: "" },
        ],
        defaultId: "b2",
      },
    },
  });
  assert.equal(signatureContent("perso"), "<b>Fabrice Joffre</b>", "celle par défaut");
  assert.equal(signatureContent("perso", "a1"), "Fabrice", "celle demandée, en texte simple faute de mise en forme");
  assert.equal(signatureContent("perso", "inconnue"), "<b>Fabrice Joffre</b>", "inconnue : celle par défaut");
  assert.match(signatureBlock("perso", "new"), /data-signature="b2">.*Fabrice Joffre/);
});

test("pièce jointe annoncée : mots entiers, expressions longues d'abord", () => {
  const words = "joint, pièce jointe, PJ";
  assert.equal(attachmentMention("Voici la pièce jointe demandée", words), "pièce jointe");
  assert.equal(attachmentMention("Ci-joint le devis", words), "joint");
  assert.equal(attachmentMention("Un pjotr, disjoint", words), null, "pas au milieu d'un mot");
  assert.equal(attachmentMention("voir pj", words), "pj", "sans tenir compte de la casse");
  assert.equal(attachmentMention("rien", " , "), null, "liste vide");
});

test("texte écrit en mode texte brut : sans la citation", () => {
  const editor = (innerText) => ({ innerText });
  assert.equal(ownText(editor("Bonjour\n> cité\nMerci\nLe 12/11, Alice a écrit :\nancien"), true), "Bonjour\nMerci");
  assert.equal(ownText(editor("Voici\n-----\nDe : Bob"), true), "Voici");
  assert.equal(ownText(editor("Hi\nFrom: Bob"), true), "Hi");
});

test("W3 : modèles proposés au compte d'envoi : les siens et les communs, sans les vides", async () => {
  const { newTemplate, templatesFor } = await import("../../src/settings.ts");
  localStorage.removeItem("librix.mail");
  assert.deepEqual(loadSettings().templates, [], "aucun modèle par défaut");
  const templates = [
    { ...newTemplate("Merci"), html: "<p>Merci !</p>" },
    { ...newTemplate("Devis"), accountId: "pro", subject: "Votre devis" },
    { ...newTemplate("Perso"), accountId: "perso", html: "<p>Bises</p>" },
    { ...newTemplate("À écrire"), html: "  " },
  ];
  saveSettings({ ...loadSettings(), templates });
  assert.deepEqual(templatesFor("pro").map((m) => m.name), ["Merci", "Devis"], "communs et ceux du compte, dans l'ordre ; un objet seul suffit");
  assert.deepEqual(templatesFor("perso").map((m) => m.name), ["Merci", "Perso"]);
  assert.deepEqual(templatesFor("autre").map((m) => m.name), ["Merci"], "« À écrire » n'a rien à insérer");
});
