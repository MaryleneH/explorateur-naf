"""Tests du manifeste de sources (structure et contenu réel du dépôt)."""

import csv
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "quality"))

from check_sources import (  # noqa: E402
    CRITICITES, MODES, REQUIRED_FIELDS, valid_url, validate_manifest,
)

MANIFEST = ROOT / "data" / "etudes" / "sources.csv"


def load_manifest() -> list[dict]:
    with MANIFEST.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


class TestManifesteReel(unittest.TestCase):
    """Le manifeste versionné doit toujours être valide."""

    def test_manifeste_sans_erreur(self):
        errors = validate_manifest(load_manifest())
        self.assertEqual(errors, [], "\n".join(errors))

    def test_source_ids_uniques(self):
        ids = [r["source_id"] for r in load_manifest()]
        self.assertEqual(len(ids), len(set(ids)))

    def test_champs_obligatoires_presents(self):
        rows = load_manifest()
        self.assertTrue(rows, "manifeste vide")
        for field in REQUIRED_FIELDS:
            self.assertIn(field, rows[0].keys())

    def test_champs_enrichis_presents(self):
        rows = load_manifest()
        for field in ("mode_controle", "criticite", "auth_requise",
                      "url_documentation", "url_api", "url_download"):
            self.assertIn(field, rows[0].keys())

    def test_au_moins_une_source_critique(self):
        criticites = {(r.get("criticite") or "").strip()
                      for r in load_manifest()}
        self.assertIn("critical", criticites)


class TestValidationSynthetique(unittest.TestCase):
    """Cas d'erreur construits, indépendants du fichier réel."""

    def base_row(self, **overrides) -> dict:
        row = {"source_id": "test", "nom": "Test", "producteur": "X",
               "url": "https://example.org", "mode_controle": "public",
               "criticite": "standard", "auth_requise": "non",
               "categorie": "identifier", "controle": "http",
               "mot_attendu": "", "frequence": "mensuelle",
               "unite": "unité légale", "limitations": "exemple"}
        row.update(overrides)
        return row

    def test_ligne_valide(self):
        self.assertEqual(validate_manifest([self.base_row()]), [])

    def test_source_id_duplique(self):
        errors = validate_manifest([self.base_row(), self.base_row()])
        self.assertTrue(any("dupliqué" in e for e in errors))

    def test_url_manquante(self):
        errors = validate_manifest([self.base_row(url="")])
        self.assertTrue(any("url" in e for e in errors))

    def test_url_invalide(self):
        errors = validate_manifest([self.base_row(url="ftp://exemple")])
        self.assertTrue(any("URL invalide" in e for e in errors))

    def test_mode_controle_inconnu(self):
        errors = validate_manifest(
            [self.base_row(mode_controle="magique")])
        self.assertTrue(any("mode_controle" in e for e in errors))

    def test_criticite_invalide(self):
        errors = validate_manifest([self.base_row(criticite="vitale")])
        self.assertTrue(any("criticite" in e for e in errors))

    def test_valid_url(self):
        self.assertTrue(valid_url("https://example.org/page"))
        self.assertFalse(valid_url("pas une url"))
        self.assertFalse(valid_url("ftp://example.org"))

    def test_categorie_invalide(self):
        errors = validate_manifest([self.base_row(categorie="autre")])
        self.assertTrue(any("categorie" in e for e in errors))

    def test_controle_inconnu(self):
        errors = validate_manifest([self.base_row(controle="magique")])
        self.assertTrue(any("controle" in e for e in errors))

    def test_http_keyword_exige_un_mot(self):
        errors = validate_manifest(
            [self.base_row(controle="http_keyword", mot_attendu="")])
        self.assertTrue(any("mot_attendu" in e for e in errors))

    def test_champs_methodologiques_obligatoires(self):
        errors = validate_manifest([self.base_row(frequence="")])
        self.assertTrue(any("frequence" in e for e in errors))

    def test_referentiels_fermes(self):
        # Les jeux de valeurs autorisées restent explicites et fermés.
        self.assertEqual(
            MODES, {"public", "authentification", "anti_bot_possible", ""})
        self.assertEqual(
            CRITICITES, {"critical", "standard", "informative", ""})


if __name__ == "__main__":
    unittest.main()
