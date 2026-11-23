// Réglages de « Paramètres › Courrier », dans le cache chiffré (signatures :
// audit S8, voir `secure-store.ts`), pour la fenêtre principale. Depuis le lot 9c, chaque fenêtre a son stockage : une fenêtre
// de message ou de rédaction reçoit les réglages à son ouverture
// (`window_bootstrap`) et ne voit pas ceux changés ensuite.
import { useEffect, useState } from "react";
import { parseHtml } from "./safe-html";
import { secureStore } from "./secure-store";

export interface MailSettings {
  /** Signature en texte simple par compte (messages en texte brut). */
  signatures: Record<string, string>;
  /** Signature mise en forme (HTML) par compte, pour les messages en HTML (lot T). */
  htmlSignatures: Record<string, string>;
  /** Signature aussi dans les réponses et transferts. */
  signatureOnReplies: boolean;
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

/** Mots par défaut (français, anglais, espagnol). */
export const DEFAULT_ATTACHMENT_WORDS =
  "pièce jointe, pièces jointes, PJ, P.J., ci-joint, ci-jointe, ci-joints, ci-jointes, joint, jointe, joints, jointes, " +
  "en annexe, attaché, attachée, attached, attachment, attachments, enclosed, adjunto, adjunta, adjuntos, archivo adjunto";

const DEFAULTS: MailSettings = {
  signatures: {},
  htmlSignatures: {},
  signatureOnReplies: true,
  syncMinutes: 2,
  attachmentReminder: true,
  attachmentWords: DEFAULT_ATTACHMENT_WORDS,
};

export function loadSettings(): MailSettings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(secureStore.getItem(KEY) ?? "{}") as Partial<MailSettings>) };
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

/** Signature mise en forme d'un compte, pour un message en HTML : sinon sa signature en texte simple. */
export function signatureContent(accountId: string): string {
  const s = loadSettings();
  const html = (s.htmlSignatures[accountId] ?? "").trim();
  if (html) return html;
  const text = (s.signatures[accountId] ?? "").trimEnd();
  return text ? textToSignatureHtml(text) : "";
}

/** Signature en texte simple d'un compte, pour un message en texte brut : sinon le texte de sa signature mise en forme. */
export function plainSignatureContent(accountId: string): string {
  const s = loadSettings();
  const text = (s.signatures[accountId] ?? "").trimEnd();
  if (text) return textToSignatureHtml(text);
  const html = (s.htmlSignatures[accountId] ?? "").trim();
  if (!html) return "";
  const box = document.createElement("div");
  box.append(parseHtml(html));
  box.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  box.querySelectorAll("p, div, li, tr").forEach((b) => b.append("\n"));
  return textToSignatureHtml((box.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim());
}

/** Le HTML d'un nouveau message, avec la signature en texte simple à la place de la mise en forme. */
export function withPlainSignature(html: string, accountId: string): string {
  const box = document.createElement("div");
  box.append(parseHtml(html));
  const block = box.querySelector("[data-signature]");
  if (!block) return html;
  block.replaceChildren(parseHtml(plainSignatureContent(accountId)));
  return box.innerHTML;
}

/** Bloc de signature à placer dans un nouveau message (repérable pour changer de compte). */
export function signatureBlock(accountId: string, reply: boolean): string {
  const s = loadSettings();
  if (reply && !s.signatureOnReplies) return "";
  const content = signatureContent(accountId);
  return content ? `<p><br></p><div data-signature="1">${content}</div>` : "";
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
