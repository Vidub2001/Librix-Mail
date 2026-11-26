"""Retire de node-sources.json les navigateurs de Playwright (lot PK2).

flatpak-node-generator ajoute les navigateurs que @playwright/test téléchargerait
(Chromium, Firefox, WebKit : plusieurs centaines de Mo). Ils ne servent qu'aux
tests de l'interface, jamais à la construction de l'application.
"""

import json
import sys

chemin = sys.argv[1]
with open(chemin, encoding="utf-8") as f:
    sources = json.load(f)
gardees = [s for s in sources if "ms-playwright" not in json.dumps(s)]
with open(chemin, "w", encoding="utf-8") as f:
    json.dump(gardees, f, indent=4)
    f.write("\n")
print(f"✔ {chemin} : {len(sources) - len(gardees)} sources de Playwright retirées, {len(gardees)} gardées")
