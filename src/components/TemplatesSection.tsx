// Paramètres › Modèles (lot W3) : réponses toutes faites, communes ou propres à
// un compte, insérées par le bouton « Modèles » de la rédaction. Même
// disposition que les signatures : zone de saisie à gauche, liste à droite.
import { Button, Field, Input, Select } from "@fluentui/react-components";
import { Add20Regular, Delete20Regular, Edit20Regular } from "@fluentui/react-icons";
import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { setHtml } from "../safe-html";
import { MAX_TEMPLATES, loadSettings, newTemplate, saveTemplates, templateFilled, type MessageTemplate } from "../settings";
import type { Account } from "../types";
import { FormatToolbar } from "./FormatToolbar";

/** Modèles enregistrés, prêts à modifier ; ceux d'un compte retiré passent à « Tous les comptes ». */
function editableTemplates(accounts: Account[]): MessageTemplate[] {
  const known = new Set(accounts.map((a) => a.id));
  const list = loadSettings().templates.map((m) => (m.accountId && !known.has(m.accountId) ? { ...m, accountId: "" } : m));
  return list.length > 0 ? list : [newTemplate()];
}

export function TemplatesSection({ accounts }: { accounts: Account[] }) {
  const [list, setList] = useState<MessageTemplate[]>(() => editableTemplates(accounts));
  const [selectedId, setSelectedId] = useState(list[0].id);
  const [saved, setSaved] = useState(true);
  /** Éditeur du texte mis en forme : il gère son propre contenu. */
  const editor = useRef<HTMLDivElement>(null);
  const selected = list.find((m) => m.id === selectedId) ?? list[0];

  /** La liste avec le contenu de l'éditeur reporté dans le modèle sélectionné. */
  const withEditor = (): MessageTemplate[] =>
    list.map((m) => (m.id === selectedId ? { ...m, html: editor.current?.innerHTML ?? m.html } : m));

  const show = (next: MessageTemplate[], id: string) => {
    setList(next);
    setSelectedId(id);
    if (editor.current) setHtml(editor.current, next.find((m) => m.id === id)?.html ?? "");
  };

  // Premier affichage : le texte du modèle sélectionné dans l'éditeur.
  useEffect(() => {
    if (editor.current) setHtml(editor.current, selected.html);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const change = (patch: Partial<MessageTemplate>) => {
    setList((l) => l.map((m) => (m.id === selectedId ? { ...m, ...patch } : m)));
    setSaved(false);
  };

  const select = (id: string) => {
    if (id !== selectedId) show(withEditor(), id);
  };

  const addTemplate = () => {
    const current = withEditor();
    if (current.length >= MAX_TEMPLATES) return;
    const entry = newTemplate(t("Modèle {n}", { n: current.length + 1 }));
    show([...current, entry], entry.id);
    setSaved(false);
  };

  const removeTemplate = () => {
    const rest = withEditor().filter((m) => m.id !== selectedId);
    if (rest.length === 0) rest.push(newTemplate());
    show(rest, rest[0].id);
    setSaved(false);
  };

  /** Modèle dont le nom est en cours de modification, dans la liste. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const startRename = (id: string) => {
    select(id);
    setDraftName(list.find((m) => m.id === id)?.name ?? "");
    setRenaming(id);
  };

  const finishRename = (keep: boolean) => {
    const id = renaming;
    setRenaming(null);
    if (!keep || id === null) return;
    const name = draftName.trim();
    setList((l) => l.map((m) => (m.id === id ? { ...m, name } : m)));
    setSaved(false);
  };

  const save = () => {
    saveTemplates(withEditor());
    const stored = editableTemplates(accounts);
    show(stored, stored.some((m) => m.id === selectedId) ? selectedId : stored[0].id);
    setSaved(true);
  };

  const nameOf = (name: string) => name.trim() || t("Modèle");
  const hasTemplate = loadSettings().templates.some(templateFilled);

  return (
    <div className="settings-pane compact templates-pane">
      <h3 className="settings-pane-title section-title">{t("Modèles")}</h3>
      <div className="about-scroll">
        <fieldset className="account-fieldset template-fieldset">
          <legend>{t("Modèles de messages")}</legend>
          <div className="template-fields">
            <Field label={t("Proposé pour")} orientation="horizontal">
              <Select value={selected.accountId} onChange={(_, d) => change({ accountId: d.value })}>
                <option value="">{t("Tous les comptes")}</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {a.email}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("Objet")} orientation="horizontal">
              <Input
                value={selected.subject}
                placeholder={t("Facultatif : repris si le message n'a pas encore d'objet")}
                onChange={(_, d) => change({ subject: d.value })}
              />
            </Field>
          </div>
          <div className="signature-layout template-layout">
            <div className="signature-frame template-frame">
              <div className="signature-tools">
                <FormatToolbar editor={editor} disabled={false} plain={false} />
              </div>
              <div
                ref={editor}
                className="compose-editor signature-editor"
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-multiline="true"
                aria-label={t("Texte du modèle")}
                data-placeholder={t("Bonjour, merci pour votre message…")}
                onInput={() => setSaved(false)}
              />
            </div>
            <div className="signature-list template-list">
              <div role="listbox" aria-label={t("Modèles")} className="signature-names">
                {list.map((m) =>
                  m.id === renaming ? (
                    <Input
                      key={m.id}
                      size="small"
                      autoFocus
                      className="signature-rename"
                      aria-label={t("Nom du modèle")}
                      placeholder={t("Modèle")}
                      value={draftName}
                      onChange={(_, d) => setDraftName(d.value)}
                      onKeyDown={(k) => {
                        if (k.key === "Enter") finishRename(true);
                        else if (k.key === "Escape") {
                          k.stopPropagation();
                          finishRename(false);
                        }
                      }}
                      onBlur={() => finishRename(true)}
                    />
                  ) : (
                    <div
                      key={m.id}
                      role="option"
                      tabIndex={0}
                      aria-selected={m.id === selectedId}
                      className={m.id === selectedId ? "signature-name selected" : "signature-name"}
                      title={t("Double-cliquez pour renommer")}
                      onClick={() => select(m.id)}
                      onDoubleClick={() => startRename(m.id)}
                      onKeyDown={(k) => {
                        if (k.key === "F2") startRename(m.id);
                        else if (k.key === "Enter" || k.key === " ") {
                          k.preventDefault();
                          select(m.id);
                        }
                      }}
                    >
                      <span>{nameOf(m.name)}</span>
                    </div>
                  ),
                )}
              </div>
              <div className="signature-list-actions">
                <Button
                  size="small"
                  icon={<Add20Regular />}
                  disabled={list.length >= MAX_TEMPLATES}
                  title={t("Nouveau modèle ({n} au plus)", { n: MAX_TEMPLATES })}
                  aria-label={t("Nouveau modèle")}
                  onClick={addTemplate}
                />
                <Button
                  size="small"
                  icon={<Edit20Regular />}
                  title={t("Renommer ce modèle (F2 ou double-clic)")}
                  aria-label={t("Renommer ce modèle")}
                  onClick={() => startRename(selectedId)}
                />
                <Button
                  size="small"
                  icon={<Delete20Regular />}
                  title={t("Supprimer ce modèle")}
                  aria-label={t("Supprimer ce modèle")}
                  onClick={removeTemplate}
                />
              </div>
            </div>
          </div>
          <div className="mail-signature-actions">
            <Button appearance="primary" disabled={saved} onClick={save}>
              {t("Enregistrer les modèles")}
            </Button>
            {saved && hasTemplate && <span className="muted">{t("Enregistrés")}</span>}
            <span className="muted settings-hint push-right">
              {t("Insérez un modèle dans un message avec le bouton « Modèles » de la rédaction.")}
            </span>
          </div>
        </fieldset>
      </div>
    </div>
  );
}
