// Envoyer plus tard (lot W2) : heures proposées et heure saisie.
import { test } from "node:test";
import assert from "node:assert/strict";

const { parseSendLater, sendLaterChoices, toLocalInput } = await import("../../src/schedule.ts");

const at = (s) => new Date(s * 1000);

test("W2 : choix rapides un mardi à 10 h 07", () => {
  const now = new Date(2026, 10, 24, 10, 7); // mardi 24 novembre 2026
  const choices = sendLaterChoices(now);
  assert.equal(choices.length, 4);
  assert.equal(toLocalInput(at(choices[0].at)), "2026-11-24T11:10", "dans une heure, arrondi aux 5 minutes");
  assert.equal(toLocalInput(at(choices[1].at)), "2026-11-24T18:00", "ce soir");
  assert.equal(toLocalInput(at(choices[2].at)), "2026-11-25T08:00", "demain matin");
  assert.equal(toLocalInput(at(choices[3].at)), "2026-11-30T08:00", "lundi suivant");
});

test("W2 : pas de « ce soir » après 17 h, pas de « lundi » le dimanche", () => {
  const evening = sendLaterChoices(new Date(2026, 10, 24, 17, 30));
  assert.ok(!evening.some((c) => toLocalInput(at(c.at)).endsWith("T18:00")), "plus de ce soir");
  const sunday = sendLaterChoices(new Date(2026, 10, 29, 9, 0)); // dimanche
  assert.equal(sunday.length, 3, "demain est déjà lundi");
  assert.equal(toLocalInput(at(sunday[2].at)), "2026-11-30T08:00");
  const monday = sendLaterChoices(new Date(2026, 10, 30, 9, 0));
  assert.equal(toLocalInput(at(monday[3].at)), "2026-12-07T08:00", "le lundi : lundi de la semaine suivante");
});

test("W2 : heure saisie à venir, dans l'année", () => {
  const now = new Date(2026, 10, 24, 10, 0);
  assert.equal(toLocalInput(at(parseSendLater("2026-11-25T08:30", now))), "2026-11-25T08:30");
  assert.equal(parseSendLater("", now), null, "vide");
  assert.equal(parseSendLater("2026-11-24T09:00", now), null, "passée");
  assert.equal(parseSendLater("2028-01-01T08:00", now), null, "à plus d'un an");
  assert.equal(parseSendLater("n'importe quoi", now), null, "illisible");
});
