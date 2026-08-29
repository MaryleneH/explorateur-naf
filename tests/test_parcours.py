"""Tests des parcours guidés (data/parcours.json) — aucun réseau.

Garantissent que chaque parcours reste cohérent avec le site : pages cibles
existantes, codes présents dans les référentiels, ancres réelles,
qualifications Défense conformes à data/defense_qualification.csv.
"""

import csv
import json
import re
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]

# Pages du site : URL cible -> source .qmd correspondante.
PAGE_SOURCES = {
    "explorer/index.html": "explorer/index.qmd",
    "explorer/visualisation.html": "explorer/visualisation.qmd",
    "comparer/index.html": "comparer/index.qmd",
    "comparer/flux.html": "comparer/flux.qmd",
    "defense/index.html": "defense/index.qmd",
    "comprendre/index.html": "comprendre/index.qmd",
    "comprendre/boite-outils.html": "comprendre/boite-outils.qmd",
    "bonus/parcours.html": "bonus/parcours.qmd",
}

TOKEN_RE = re.compile(r"\{\{(2025|2008):([0-9.]+[A-Z])\}\}")


def load_json():
    with (ROOT / "data" / "parcours.json").open(encoding="utf-8") as f:
        return json.load(f)


def subclasses(version):
    name = "naf2025.csv" if version == "2025" else "naf2008.csv"
    with (ROOT / "data" / name).open(encoding="utf-8") as f:
        return {row["subclass_code"] for row in csv.DictReader(f)}


def defense_rows():
    with (ROOT / "data" / "defense_qualification.csv").open(
            encoding="utf-8") as f:
        return list(csv.DictReader(f))


class TestStructure(unittest.TestCase):

    def setUp(self):
        self.data = load_json()

    def test_quatre_parcours(self):
        ids = [s["id"] for s in self.data["stories"]]
        self.assertEqual(len(ids), len(set(ids)))
        for wanted in ("aeronautique", "code-ne-suffit-pas", "dualite",
                       "du-code-a-letude"):
            self.assertIn(wanted, ids)

    def test_chaque_parcours_a_des_etapes_completes(self):
        for story in self.data["stories"]:
            self.assertGreaterEqual(len(story["steps"]), 2, story["id"])
            for key in ("id", "numero", "titre", "sous_titre", "question",
                        "duree", "theme", "intro"):
                self.assertTrue(story.get(key), f"{story['id']}: {key} vide")
            for i, step in enumerate(story["steps"]):
                self.assertTrue(step.get("titre"),
                                f"{story['id']} étape {i + 1} sans titre")
                self.assertTrue(step.get("texte"),
                                f"{story['id']} étape {i + 1} sans texte")
                if not step.get("conclusion"):
                    self.assertTrue(step.get("url"),
                                    f"{story['id']} étape {i + 1} sans url")

    def test_derniere_etape_est_conclusion(self):
        for story in self.data["stories"]:
            self.assertTrue(story["steps"][-1].get("conclusion"),
                            story["id"])
            for step in story["steps"][:-1]:
                self.assertFalse(step.get("conclusion"), story["id"])


class TestCibles(unittest.TestCase):

    def setUp(self):
        self.data = load_json()
        self.codes = {"2025": subclasses("2025"), "2008": subclasses("2008")}

    def iter_steps(self):
        for story in self.data["stories"]:
            for i, step in enumerate(story["steps"]):
                yield story, i + 1, step

    def test_pages_cibles_existent(self):
        for story, n, step in self.iter_steps():
            if not step.get("url"):
                continue
            path = urlparse(step["url"]).path
            self.assertIn(path, PAGE_SOURCES,
                          f"{story['id']} étape {n} : page inconnue {path}")
            self.assertTrue((ROOT / PAGE_SOURCES[path]).exists(),
                            f"source absente pour {path}")

    def test_codes_cibles_existent(self):
        for story, n, step in self.iter_steps():
            if not step.get("url"):
                continue
            query = parse_qs(urlparse(step["url"]).query)
            code = (query.get("code") or [None])[0]
            if not code:
                continue
            version = (query.get("v") or ["2025"])[0]
            self.assertIn(code, self.codes[version],
                          f"{story['id']} étape {n} : {code} absent de "
                          f"naf{version}")

    def test_jetons_de_libelle_existent(self):
        for story, n, step in self.iter_steps():
            for version, code in TOKEN_RE.findall(step["texte"]):
                self.assertIn(code, self.codes[version],
                              f"{story['id']} étape {n} : jeton {code} "
                              f"absent de naf{version}")

    def test_ancres_existent_dans_les_sources(self):
        for story, n, step in self.iter_steps():
            if not step.get("url") or "#" not in step["url"]:
                continue
            parsed = urlparse(step["url"])
            source = (ROOT / PAGE_SOURCES[parsed.path]).read_text(
                encoding="utf-8")
            self.assertIn(f'id="{parsed.fragment}"', source,
                          f"{story['id']} étape {n} : ancre "
                          f"#{parsed.fragment} absente de {parsed.path}")

    def test_vues_defense_valides(self):
        # naf-constellation.js n'accepte que view=duales|pourquoi.
        for story, n, step in self.iter_steps():
            if not step.get("url"):
                continue
            parsed = urlparse(step["url"])
            if parsed.path != "defense/index.html":
                continue
            view = (parse_qs(parsed.query).get("view") or [None])[0]
            if view is not None:
                self.assertIn(view, ("duales", "pourquoi"),
                              f"{story['id']} étape {n}")


class TestCoherenceDefense(unittest.TestCase):
    """Les affirmations des parcours suivent defense_qualification.csv :
    si la qualification change, ces tests cassent — c'est voulu."""

    def setUp(self):
        self.by_code = {r["code"]: r for r in defense_rows()
                        if r["naf_version"] == "NAF 2025"}

    def test_3032Y_explicite(self):
        self.assertEqual(self.by_code["30.32Y"]["niveau_defense"],
                         "explicite_industriel")

    def test_2651Y_dualite_demontree(self):
        row = self.by_code["26.51Y"]
        self.assertEqual(row["niveau_defense"], "dualite_demontree")
        self.assertTrue(row["usages_civils"])
        self.assertTrue(row["usages_defense"])

    def test_2611Y_relation_intermediaire(self):
        self.assertEqual(self.by_code["26.11Y"]["niveau_defense"],
                         "relation_intermediaire")


if __name__ == "__main__":
    unittest.main()
