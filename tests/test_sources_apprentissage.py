"""Tests de la rubrique « Comprendre les sources » (comprendre/sources/).

Garanties structurelles (pas de tests sur des phrases exactes) :
  - la navigation locale (naf-src-hub.js) et les pages .qmd décrivent le
    même ensemble de sources, dans les deux sens ;
  - la navbar « Comprendre » contient la rubrique ;
  - chaque page de source possède les quatre niveaux, le bloc grain, la
    fiche mémo, les sources officielles, au moins trois exercices, les
    deux angles (entreprises / Défense), un lien vers l'État des sources
    et le kicker de rattachement ;
  - tous les identifiants de sources référencés ([data-src-doc],
    [data-src-portal], ancres #source-…) existent dans le manifeste
    data/etudes/sources.csv — aucune URL officielle dupliquée ;
  - tous les liens internes relatifs pointent vers des pages existantes.
"""

import csv
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "comprendre" / "sources"
HUB_JS = ROOT / "assets" / "js" / "naf-src-hub.js"

PAGES = ["sirene", "sirus", "side", "boamp", "decp", "bodacc", "rne",
         "douanes", "inpi-brevets", "refd", "edis"]

# Pages centrées sur l'économie de la Défense : l'angle « économie des
# entreprises » n'y est pas exigé (la page explique son objet propre).
PAGES_DEFENSE = {"refd", "edis"}

NIVEAUX = ["src-decouvrir", "src-prendre", "src-exploiter",
           "src-approfondir"]


def manifest_ids():
    with (ROOT / "data" / "etudes" / "sources.csv").open(
            encoding="utf-8") as f:
        return {r["source_id"] for r in csv.DictReader(f)}


def page_text(slug):
    return (SRC / f"{slug}.qmd").read_text(encoding="utf-8")


class TestRubriqueSources(unittest.TestCase):

    def test_pages_existent(self):
        self.assertTrue((SRC / "index.qmd").exists())
        for slug in PAGES:
            self.assertTrue((SRC / f"{slug}.qmd").exists(), slug)

    def test_nav_locale_coherente(self):
        js = HUB_JS.read_text(encoding="utf-8")
        slugs_js = set(re.findall(r'slug:\s*"([a-z0-9-]+)"', js))
        self.assertEqual(slugs_js, set(PAGES),
                         "naf-src-hub.js et les pages .qmd divergent")

    def test_navbar_comprendre(self):
        quarto = (ROOT / "_quarto.yml").read_text(encoding="utf-8")
        self.assertIn("comprendre/sources/index.qmd", quarto)
        self.assertIn("text: Comprendre les sources", quarto)

    def test_data_current_correspond_au_fichier(self):
        for slug in PAGES:
            self.assertIn(f'data-current="{slug}"', page_text(slug), slug)

    def test_quatre_niveaux_par_page(self):
        for slug in PAGES:
            texte = page_text(slug)
            for niveau in NIVEAUX:
                self.assertIn(f'id="{niveau}"', texte,
                              f"{slug} : niveau {niveau} absent")

    def test_blocs_structurants(self):
        for slug in PAGES:
            texte = page_text(slug)
            self.assertIn("naf-src-grain", texte, f"{slug} : bloc grain")
            self.assertIn("naf-src-memo", texte, f"{slug} : mémo")
            self.assertIn("naf-src-refs", texte, f"{slug} : sources officielles")
            self.assertIn("naf-src-avant", texte, f"{slug} : avant/après")
            self.assertIn("Comprendre · Comprendre les sources", texte,
                          f"{slug} : kicker de rattachement")
            self.assertIn("bonus/sources.html#source-", texte,
                          f"{slug} : lien État des sources")

    def test_au_moins_trois_exercices(self):
        for slug in PAGES:
            n = page_text(slug).count('class="naf-src-exo"')
            self.assertGreaterEqual(n, 3, f"{slug} : {n} exercice(s)")

    def test_angles_entreprises_et_defense(self):
        for slug in PAGES:
            texte = page_text(slug)
            self.assertIn("Défense", texte, slug)
            if slug not in PAGES_DEFENSE:
                self.assertIn("Économie des entreprises", texte, slug)

    def test_ids_manifeste_valides(self):
        ids = manifest_ids()
        motifs = (r'data-src-doc="([a-z0-9_]+)"',
                  r'data-src-portal="([a-z0-9_]+)"',
                  r'bonus/sources\.html#source-([a-z0-9_]+)')
        for qmd in list(SRC.glob("*.qmd")) + [HUB_JS]:
            texte = qmd.read_text(encoding="utf-8")
            for motif in motifs:
                for sid in re.findall(motif, texte):
                    self.assertIn(sid, ids, f"{qmd.name} : {sid}")

    def test_liens_internes_resolvent(self):
        # Tout href relatif en .html doit correspondre à un .qmd du dépôt.
        for qmd in SRC.glob("*.qmd"):
            texte = qmd.read_text(encoding="utf-8")
            for href in re.findall(r'href="([^"#]+\.html)', texte):
                if href.startswith("http"):
                    continue
                cible = (SRC / href).resolve().with_suffix(".qmd")
                self.assertTrue(cible.exists(), f"{qmd.name} → {href}")

    def test_reseau_pedagogique_bodacc(self):
        # La page BODACC relie le cas pratique complet et la recette.
        texte = page_text("bodacc")
        self.assertIn("../programmes/bodacc-json.html", texte)
        self.assertIn("../boite-outils.html#bodacc", texte)

    def test_pas_de_score_numerique(self):
        # Difficulté : catégories textuelles, jamais « x/10 » ni étoiles.
        for slug in PAGES:
            texte = page_text(slug)
            self.assertNotRegex(texte, r"\d\s*/\s*10")
            self.assertNotIn("★", texte)

    def test_landing_complete(self):
        texte = (SRC / "index.qmd").read_text(encoding="utf-8")
        for slug in PAGES:
            self.assertIn(f'href="{slug}.html"', texte, slug)
        for attendu in ("SIREN", "SIRET", "nomenclature", "01 · Découvrir",
                        "04 · Approfondir", "repères de\n      navigation"):
            self.assertIn(attendu, texte, attendu)


if __name__ == "__main__":
    unittest.main()
