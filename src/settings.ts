// Réglages de « Paramètres › Courrier », dans le cache chiffré (signatures :
// audit S8, voir `secure-store.ts`), pour la fenêtre principale. Depuis le lot 9c, chaque fenêtre a son stockage : une fenêtre
// de message ou de rédaction reçoit les réglages à son ouverture
// (`window_bootstrap`) et ne voit pas ceux changés ensuite.
import { useEffect, useState } from "react";
import { parseHtml } from "./safe-html";
import { secureStore } from "./secure-store";
import { randomId } from "./text";

/** Une signature d'un compte (lot T4) : ses deux formes, chacune pour les messages de son format. */
export interface SignatureEntry {
  id: string;
  /** Nom choisi pour la reconnaître (vide : « Signature »). */
  name: string;
  /** Forme mise en forme, pour les messages en HTML. */
  html: string;
  /** Forme en texte simple, pour les messages en texte brut. */
  text: string;
}

/** Signatures d'un compte (lot T4) et celle ajoutée d'office. */
export interface SignatureSet {
  list: SignatureEntry[];
  defaultId: string;
}

export interface MailSettings {
  /** Avant le lot T4 : signature en texte simple par compte, reprise comme sa première signature. */
  signatures: Record<string, string>;
  /** Avant le lot T4 : signature mise en forme par compte (lot T), reprise de même. */
  htmlSignatures: Record<string, string>;
  /** Signatures de chaque compte (lot T4). */
  signatureSets: Record<string, SignatureSet>;
  /** Signature ajoutée d'elle-même aux nouveaux messages (lot T3). */
  signatureOnNew: boolean;
  /** Signature ajoutée d'elle-même aux réponses. */
  signatureOnReplies: boolean;
  /** Signature ajoutée d'elle-même aux transferts (lot T3 : réglage séparé des réponses). */
  signatureOnForwards: boolean;
  /** Modèles de messages (lot W3), communs ou propres à un compte. */
  templates: MessageTemplate[];
  /** Délai pendant lequel un envoi peut être annulé, en secondes (lot W1 ; 0 : aucun). */
  undoSendSeconds: number;
  /** Fréquence de la synchronisation automatique, en minutes. */
  syncMinutes: number;
  /** Avertir à l'envoi quand le message parle d'une pièce jointe absente. */
  attachmentReminder: boolean;
  /** Mots qui annoncent une pièce jointe, séparés par des virgules. */
  attachmentWords: string;
}

const KEY = "librix.mail";
const CHANGED = "librix-settings";

export const SYNC_CHOICES = [1, 2, 5, 10, 15, 30];

/** Délais proposés pour annuler un envoi, en secondes (lot W1). */
export const UNDO_SEND_CHOICES = [0, 5, 10, 20, 30];

/** Mots par défaut (français, anglais, espagnol). */
export const DEFAULT_ATTACHMENT_WORDS =
  "pièce jointe, pièces jointes, PJ, P.J., ci-joint, ci-jointe, ci-joints, ci-jointes, joint, jointe, joints, jointes, " +
  "en annexe, attaché, attachée, attached, attachment, attachments, enclosed, adjunto, adjunta, adjuntos, archivo adjunto";

const DEFAULTS: MailSettings = {
  signatures: {},
  htmlSignatures: {},
  signatureSets: {},
  signatureOnNew: true,
  signatureOnReplies: true,
  signatureOnForwards: true,
  templates: [],
  undoSendSeconds: 10,
  syncMinutes: 2,
  attachmentReminder: true,
  attachmentWords: DEFAULT_ATTACHMENT_WORDS,
};

export function loadSettings(): MailSettings {
  try {
    const stored = JSON.parse(secureStore.getItem(KEY) ?? "{}") as Partial<MailSettings>;
    // Avant le lot T3, un seul réglage valait pour les réponses et les transferts.
    const forwards = stored.signatureOnForwards ?? stored.signatureOnReplies ?? DEFAULTS.signatureOnForwards;
    return { ...DEFAULTS, ...stored, signatureOnForwards: forwards };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: MailSettings) {
  try {
    secureStore.setItem(KEY, JSON.stringify(settings));
  } catch {
    // stockage indisponible : réglage valable jusqu'à la fermeture
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** Réglages à jour, y compris quand une autre fenêtre les modifie. */
export function useMailSettings(): MailSettings {
  const [settings, setSettings] = useState(loadSettings);
  useEffect(() => {
    const reload = () => setSettings(loadSettings());
    window.addEventListener(CHANGED, reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener(CHANGED, reload);
      window.removeEventListener("storage", reload);
    };
  }, []);
  return settings;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Texte simple → HTML, une ligne par ligne. */
const textToSignatureHtml = (text: string) => text.split("\n").map((l) => escapeHtml(l) || "<br>").join("<br>");

/** Éléments jamais gardés dans une signature mise en forme. */
const DROPPED = "script, style, iframe, frame, object, embed, link, meta, base, form, input, button, textarea, select";

/**
 * Signature mise en forme nettoyée avant d'être enregistrée (lot T) : ni
 * script, ni cadre, ni formulaire, ni attribut d'événement, ni adresse
 * `javascript:` ; images intégrées (`data:`) seulement, une image distante
 * signalerait au destinataire l'ouverture du message.
 */
export function cleanSignatureHtml(html: string): string {
  const box = document.createElement("div");
  box.append(parseHtml(html));
  box.querySelectorAll(DROPPED).forEach((n) => n.remove());
  box.querySelectorAll("*").forEach((el) => {
    for (const { name, value } of [...el.attributes]) {
      const lower = name.toLowerCase();
      const url = value.trim().toLowerCase();
      if (lower.startsWith("on") || ((lower === "href" || lower === "src") && url.startsWith("javascript:"))) el.removeAttribute(name);
    }
    if (el.tagName === "IMG" && !(el.getAttribute("src") ?? "").startsWith("data:")) el.remove();
  });
  const kept = Boolean(box.textContent?.trim()) || box.querySelector("img") !== null;
  return kept ? box.innerHTML.trim() : "";
}

/** Nouvelle signature, vide. */
export function newSignature(name = ""): SignatureEntry {
  return { id: randomId(6), name, html: "", text: "" };
}

/** Signatures d'un compte ; celle d'avant le lot T4, s'il en avait une, devient la première. */
export function accountSignatures(accountId: string, s: MailSettings = loadSettings()): SignatureSet {
  const set = s.signatureSets[accountId];
  if (set) return set;
  const html = (s.htmlSignatures[accountId] ?? "").trim();
  const text = (s.signatures[accountId] ?? "").trimEnd();
  if (!html && !text) return { list: [], defaultId: "" };
  return { list: [{ id: "s1", name: "", html, text }], defaultId: "s1" };
}

/** Enregistre les signatures d'un compte. */
export function saveAccountSignatures(accountId: string, set: SignatureSet) {
  const s = loadSettings();
  saveSettings({ ...s, signatureSets: { ...s.signatureSets, [accountId]: set } });
}

/** Signature d'un compte : celle demandée, sinon celle par défaut, sinon la première. */
function findSignature(accountId: string, signatureId?: string | null): SignatureEntry | undefined {
  const { list, defaultId } = accountSignatures(accountId);
  return (signatureId ? list.find((e) => e.id === signatureId) : undefined) ?? list.find((e) => e.id === defaultId) ?? list[0];
}

/** Une signature a-t-elle un contenu, dans l'une ou l'autre forme ? */
export const signatureFilled = (e: SignatureEntry) => e.html.trim() !== "" || e.text.trim() !== "";

/** Forme mise en forme d'une signature, pour un message en HTML : sinon sa forme en texte simple. */
export function signatureContent(accountId: string, signatureId?: string | null): string {
  const e = findSignature(accountId, signatureId);
  if (!e) return "";
  const html = e.html.trim();
  if (html) return html;
  const text = e.text.trimEnd();
  return text ? textToSignatureHtml(text) : "";
}

/** Texte d'une signature pour un message en texte brut : sa forme en texte simple, sinon le texte de la mise en forme. */
export function plainSignatureText(accountId: string, signatureId?: string | null): string {
  const e = findSignature(accountId, signatureId);
  if (!e) return "";
  const text = e.text.trimEnd();
  if (text) return text;
  const html = e.html.trim();
  if (!html) return "";
  const box = document.createElement("div");
  box.append(parseHtml(html));
  box.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  box.querySelectorAll("p, div, li, tr").forEach((b) => b.append("\n"));
  return (box.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Forme en texte simple d'une signature, en HTML (lignes séparées par des <br>). */
export function plainSignatureContent(accountId: string, signatureId?: string | null): string {
  const text = plainSignatureText(accountId, signatureId);
  return text ? textToSignatureHtml(text) : "";
}

/** Le HTML d'un nouveau message, avec la signature en texte simple à la place de la mise en forme. */
export function withPlainSignature(html: string, accountId: string): string {
  const box = document.createElement("div");
  box.append(parseHtml(html));
  const block = box.querySelector("[data-signature]");
  if (!block) return html;
  block.replaceChildren(parseHtml(plainSignatureContent(accountId, block.getAttribute("data-signature"))));
  return box.innerHTML;
}

/** Type de message rédigé, pour savoir s'il reçoit la signature d'office (lot T3). */
export type SignatureUse = "new" | "reply" | "forward";

/** Bloc de signature à placer dans un message (repérable pour changer de compte). */
export function signatureBlock(accountId: string, use: SignatureUse): string {
  const s = loadSettings();
  const wanted = { new: s.signatureOnNew, reply: s.signatureOnReplies, forward: s.signatureOnForwards }[use];
  if (!wanted) return "";
  const entry = findSignature(accountId);
  const content = entry ? signatureContent(accountId, entry.id) : "";
  return content ? `<p><br></p><div data-signature="${signatureMark(entry?.id)}">${content}</div>` : "";
}

/** Valeur de `data-signature` : la signature placée (lettres et chiffres seulement). */
export function signatureMark(signatureId: string | undefined): string {
  return (signatureId ?? "").replace(/[^A-Za-z0-9]/g, "") || "1";
}

// ------------------------------------------------------------------ modèles de messages (lot W3)

/** Un modèle de message : réponse toute faite, insérée par le bouton « Modèles » de la rédaction. */
export interface MessageTemplate {
  id: string;
  /** Nom affiché dans le menu de la rédaction (vide : « Modèle »). */
  name: string;
  /** Compte auquel il est proposé ; vide : tous les comptes. */
  accountId: string;
  /** Objet, placé dans le message seulement si son objet est vide. */
  subject: string;
  /** Texte mis en forme, nettoyé comme une signature (`cleanSignatureHtml`). */
  html: string;
}

/** Modèles au plus, pour que le menu de la rédaction reste lisible. */
export const MAX_TEMPLATES = 20;

/** Nouveau modèle, vide, pour tous les comptes. */
export function newTemplate(name = ""): MessageTemplate {
  return { id: randomId(6), name, accountId: "", subject: "", html: "" };
}

/** Un modèle a-t-il quelque chose à insérer ? */
export const templateFilled = (m: MessageTemplate) => m.html.trim() !== "" || m.subject.trim() !== "";

/** Modèles proposés à la rédaction pour un compte : les siens et les communs, dans l'ordre de la liste. */
export function templatesFor(accountId: string, s: MailSettings = loadSettings()): MessageTemplate[] {
  return s.templates.filter((m) => (m.accountId === "" || m.accountId === accountId) && templateFilled(m));
}

/** Enregistre les modèles (20 au plus) nettoyés comme les signatures ; un modèle vide et sans nom est oublié. */
export function saveTemplates(list: MessageTemplate[]) {
  const templates = list
    .filter((m) => templateFilled(m) || m.name.trim() !== "")
    .slice(0, MAX_TEMPLATES)
    .map((m) => ({ ...m, name: m.name.trim(), subject: m.subject.trim(), html: cleanSignatureHtml(m.html) }));
  saveSettings({ ...loadSettings(), templates });
}

// ------------------------------------------------------------------ pièce jointe oubliée

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Premier mot annonçant une pièce jointe dans le texte (sujet + corps sans la
 * citation ni la signature), ou null. Mots entiers, sans tenir compte de la casse.
 */
export function attachmentMention(text: string, words = loadSettings().attachmentWords): string | null {
  const list = words
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean)
    // Les expressions longues d'abord : « pièce jointe » avant « jointe ».
    .sort((a, b) => b.length - a.length);
  if (list.length === 0) return null;
  // Sans « lookbehind » (anciennes versions de WebKitGTK) : le caractère précédent est capturé à part.
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${list.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])`, "iu");
  return re.exec(text)?.[2] ?? null;
}

/** Texte écrit par l'utilisateur : sans le message cité (réponse, transfert) ni la signature. */
export function ownText(editor: HTMLElement, plain: boolean): string {
  if (plain) {
    const lines: string[] = [];
    for (const line of editor.innerText.split("\n")) {
      // Début de la citation : « De : … » (en-tête du message d'origine) ou ligne de séparation.
      if (/^\s*(De|From)\s*:/i.test(line) || /^\s*(-{3,}|_{5,})/.test(line)) break;
      // Ligne d'attribution d'une réponse : « Le …, X a écrit : » (et ses traductions).
      if (/(a écrit|wrote|escribió)\s*:\s*$/i.test(line)) break;
      if (/^\s*>/.test(line)) continue;
      lines.push(line);
    }
    return lines.join("\n");
  }
  const copy = editor.cloneNode(true) as HTMLElement;
  // Tout ce qui suit le séparateur placé avant l'en-tête cité.
  const header = copy.querySelector(".quote-header");
  if (header) {
    let node: ChildNode | null = header.previousSibling?.nodeName === "HR" ? header.previousSibling : header;
    while (node) {
      const next: ChildNode | null = node.nextSibling;
      node.remove();
      node = next;
    }
  }
  copy.querySelectorAll("blockquote, .quoted-body, .quote-attribution, [data-signature]").forEach((n) => n.remove());
  return copy.innerText || copy.textContent || "";
}
