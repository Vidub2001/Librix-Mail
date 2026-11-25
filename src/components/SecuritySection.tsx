import { Select } from "@fluentui/react-components";
import { useState } from "react";
import { t } from "../i18n";
import type { Account } from "../types";
import { PortablePassword } from "./BackupSection";
import { CorrespondentsSection } from "./CorrespondentsSection";
import { SmimeSection } from "./SmimeSection";

/**
 * Rubrique « Sécurité » des paramètres (lot T5) : certificat S/MIME de chaque
 * compte, certificats des correspondants et, en mode portable, mot de passe maître.
 */
export function SecuritySection({ accounts }: { accounts: Account[] }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0];

  return (
    <div className="settings-pane">
      <h3 className="settings-pane-title section-title">{t("Sécurité")}</h3>
      <div className="about-scroll">
        <fieldset className="account-fieldset">
          <legend>{t("Signature S/MIME de vos messages")}</legend>
          {account ? (
            <>
              <Select aria-label={t("Compte")} className="signature-account" value={account.id} onChange={(_, d) => setAccountId(d.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {a.email}
                  </option>
                ))}
              </Select>
              {/* Clé : l'état du formulaire repart de zéro à chaque compte. */}
              <SmimeSection key={account.id} accountId={account.id} email={account.email} />
            </>
          ) : (
            <p className="muted">{t("Ajoutez d'abord un compte.")}</p>
          )}
        </fieldset>

        <fieldset className="account-fieldset">
          <legend>{t("Certificats des correspondants (S/MIME)")}</legend>
          <CorrespondentsSection />
        </fieldset>

        <PortablePassword />
      </div>
    </div>
  );
}
