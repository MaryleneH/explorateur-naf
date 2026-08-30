"""Tests de l'architecture de navigation (_quarto.yml + pages).

Garanties :
  - chaque entrée de la navbar pointe vers un fichier .qmd existant ;
  - la structure cible est en place (Explorer avec Parcours guidés,
    Comprendre avec l'Atelier, Boîte à outils avec ses quatre
    sous-entrées, « Méthode & provenance ») ;
  - « Bonus » a disparu de la navigation et des kickers visibles, mais
    les anciennes pages bonus/ existent toujours (deep links préservés) ;
  - aucun lien interne vers bonus/*.html ne pointe vers une page
    supprimée.
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
QUARTO = (ROOT / "_quarto.yml").read_text(encoding="utf-8")


def navbar_block():
    debut = QUARTO.index("navbar:")
    fin = QUARTO.index("page-footer:")
    return QUARTO[debut:fin]


class TestNavigation(unittest.TestCase):

    def test_toutes_les_entrees_navbar_existent(self):
        hrefs = re.findall(r"href:\s*(\S+\.qmd)", navbar_block())
        self.assertGreaterEqual(len(hrefs), 12)
        for href in hrefs:
            self.assertTrue((ROOT / href).exists(), href)

    def test_structure_cible(self):
        nav = navbar_block()
        # Les six rubriques principales, dans l'ordre.
        positions = [nav.index("text: " + t) for t in (
            "Explorer", "NAF 2008 ↔ 2025", "NAF & Défense", "Comprendre",
            "Boîte à outils", "Méthode & provenance")]
        self.assertEqual(positions, sorted(positions))
        # Les reclassements.
        for entree in ("Parcours guidés", "Atelier d'étude",
                       "Démarrage & recettes", "Programmes & cas pratiques",
                       "JSON BODACC · cas complet", "État des sources",
                       "Comprendre la NAF"):
            self.assertIn("text: " + entree, nav, entree)
        self.assertIn("- search", nav)

    def test_bonus_disparu_de_la_navigation(self):
        nav = navbar_block()
        self.assertNotIn("text: Bonus", nav)
        self.assertNotIn("Méthode & sources", nav)

    def test_pas_de_menu_a_trois_niveaux(self):
        # Un item de menu ne porte jamais son propre sous-menu.
        nav = navbar_block()
        self.assertNotRegex(nav, r"menu:\s*\n(\s+- [^\n]+\n)*\s+menu:")

    def test_anciennes_pages_bonus_conservees(self):
        for nom in ("index", "parcours", "atelier", "sources"):
            self.assertTrue((ROOT / "bonus" / f"{nom}.qmd").exists(), nom)

    def test_kickers_sans_bonus(self):
        for qmd in ROOT.rglob("*.qmd"):
            if "_site" in qmd.parts:
                continue
            texte = qmd.read_text(encoding="utf-8")
            for kicker in re.findall(
                    r'naf-comp-kicker">([^<]*)</p>', texte):
                self.assertNotRegex(kicker.strip(), r"^Bonus\s*·",
                                    f"{qmd} : {kicker}")

    def test_kickers_de_rattachement(self):
        attendus = {
            "bonus/atelier.qmd": "Comprendre · Atelier d'étude",
            "bonus/sources.qmd": "Boîte à outils · État des sources",
            "bonus/parcours.qmd": "Explorer · Parcours guidés",
            "comprendre/programmes/index.qmd":
                "Boîte à outils · Programmes &amp; cas pratiques",
            "comprendre/programmes/bodacc-json.qmd":
                "Boîte à outils · Programmes &amp; cas pratiques",
        }
        for chemin, kicker in attendus.items():
            texte = (ROOT / chemin).read_text(encoding="utf-8")
            self.assertIn(kicker, texte, chemin)

    def test_methode_et_provenance(self):
        texte = (ROOT / "methode" / "index.qmd").read_text(encoding="utf-8")
        self.assertIn('title: "Méthode & provenance"', texte)
        self.assertNotIn("Méthode & sources", texte)

    def test_liens_internes_vers_bonus_resolvent(self):
        for source in list(ROOT.rglob("*.qmd")) + list(
                (ROOT / "assets" / "js").glob("*.js")):
            if "_site" in source.parts:
                continue
            texte = source.read_text(encoding="utf-8")
            for lien in re.findall(r"bonus/(\w+)\.html", texte):
                self.assertTrue((ROOT / "bonus" / f"{lien}.qmd").exists(),
                                f"{source} → bonus/{lien}.html")


if __name__ == "__main__":
    unittest.main()
