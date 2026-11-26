// Complète package-lock.json (lot PK2) : npm y omet parfois `resolved` et
// `integrity` (paquets repris de node_modules), et la construction Flatpak,
// sans réseau, ne peut alors pas retrouver ces paquets.
//
//   node packaging/flatpak/npm-lock-complet.mjs           vérifie (échoue s'il en manque)
//   node packaging/flatpak/npm-lock-complet.mjs --ecrire  complète depuis registry.npmjs.org
//
// Les versions ne changent pas : seules l'adresse et l'empreinte de chaque
// paquet, lues dans le registre pour cette version exacte, sont ajoutées.
import { readFileSync, writeFileSync } from "node:fs";

const FICHIER = "package-lock.json";
const REGISTRE = "https://registry.npmjs.org";
const ecrire = process.argv.includes("--ecrire");

const lock = JSON.parse(readFileSync(FICHIER, "utf8"));
const incomplets = Object.entries(lock.packages ?? {}).filter(
  ([chemin, p]) => chemin !== "" && !p.link && !p.inBundle && !(p.resolved && p.integrity),
);

if (incomplets.length === 0) {
  console.log(`✔ ${FICHIER} : adresse et empreinte de chaque paquet présentes`);
  process.exit(0);
}
if (!ecrire) {
  console.error(`✘ ${FICHIER} : ${incomplets.length} paquets sans adresse ou empreinte (${incomplets[0][0]}…)`);
  console.error(`  Compléter : node packaging/flatpak/npm-lock-complet.mjs --ecrire`);
  process.exit(1);
}

for (const [chemin, paquet] of incomplets) {
  const nom = paquet.name ?? chemin.slice(chemin.lastIndexOf("node_modules/") + "node_modules/".length);
  const reponse = await fetch(`${REGISTRE}/${nom.replace("/", "%2f")}/${paquet.version}`);
  if (!reponse.ok) throw new Error(`${nom}@${paquet.version} : registre ${reponse.status}`);
  const { dist } = await reponse.json();
  if (!dist?.tarball || !dist?.integrity) throw new Error(`${nom}@${paquet.version} : réponse sans dist`);
  // Même ordre de clés que npm : version, resolved, integrity, puis le reste.
  const { version, resolved: _r, integrity: _i, ...reste } = paquet;
  lock.packages[chemin] = { version, resolved: dist.tarball, integrity: dist.integrity, ...reste };
}
writeFileSync(FICHIER, `${JSON.stringify(lock, null, 2)}\n`);
console.log(`✔ ${FICHIER} : ${incomplets.length} paquets complétés`);
