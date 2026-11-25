// Envoyer plus tard (lot W2) : heures proposées dans la rédaction, calculées
// à partir de l'heure locale.
import { t } from "./i18n";

export interface SendLaterChoice {
  /** Libellé du menu (« Demain matin, 8 h »). */
  label: string;
  /** Heure d'envoi, en secondes Unix. */
  at: number;
}

const seconds = (d: Date) => Math.floor(d.getTime() / 1000);

/** Le même jour que `d`, à `hour` heures pile. */
function atHour(d: Date, hour: number, addDays = 0): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + addDays, hour, 0, 0, 0);
  return x;
}

/**
 * Choix rapides, du plus proche au plus lointain : dans une heure (arrondie
 * aux 5 minutes), ce soir à 18 h (avant 17 h seulement), demain à 8 h, et
 * lundi à 8 h (sauf le dimanche, où « demain » est déjà lundi).
 */
export function sendLaterChoices(now: Date): SendLaterChoice[] {
  const inAnHour = new Date(now.getTime() + 60 * 60 * 1000);
  inAnHour.setMinutes(Math.ceil(inAnHour.getMinutes() / 5) * 5, 0, 0);
  const choices: SendLaterChoice[] = [{ label: t("Dans une heure"), at: seconds(inAnHour) }];
  if (now.getHours() < 17) choices.push({ label: t("Ce soir, 18 h"), at: seconds(atHour(now, 18)) });
  choices.push({ label: t("Demain matin, 8 h"), at: seconds(atHour(now, 8, 1)) });
  const day = now.getDay(); // 0 : dimanche, 1 : lundi…
  if (day !== 0) {
    const untilMonday = ((8 - day) % 7) || 7;
    choices.push({ label: t("Lundi matin, 8 h"), at: seconds(atHour(now, 8, untilMonday)) });
  }
  return choices;
}

/** Heure d'envoi saisie (`datetime-local`), ou null si elle est vide, passée ou à plus d'un an. */
export function parseSendLater(value: string, now: Date): number | null {
  if (!value) return null;
  const d = new Date(value);
  const at = seconds(d);
  if (Number.isNaN(at)) return null;
  const nowSeconds = seconds(now);
  if (at <= nowSeconds || at > nowSeconds + 365 * 24 * 3600) return null;
  return at;
}

/** Valeur `datetime-local` d'une date : « 2026-11-25T08:00 », à l'heure locale. */
export function toLocalInput(d: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
}
