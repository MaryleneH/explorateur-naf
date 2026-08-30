"""Tests du statut par source et du snapshot — aucun réseau.

Couvre l'agrégation AVAILABLE / WARNING / ACCESS_SPECIFIC / UNAVAILABLE /
MANUAL, la logique zéro-churn du snapshot, et la cohérence du snapshot
versionné avec le manifeste.
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "quality"))

import check_sources  # noqa: E402
from check_sources import (  # noqa: E402
    SOURCE_STATUSES, aggregate_source_status, build_snapshot,
    keyword_present, run_checks, write_snapshot,
)

SNAPSHOT = ROOT / "data" / "quality" / "source_status.json"
MANIFEST = ROOT / "data" / "etudes" / "sources.csv"


def row(**overrides):
    base = {"source_id": "test", "nom": "Test", "producteur": "X",
            "url": "https://example.org", "mode_controle": "public",
            "criticite": "standard", "auth_requise": "non",
            "categorie": "identifier", "controle": "http",
            "mot_attendu": ""}
    base.update(overrides)
    return base


def url_result(status, message="msg", champ="url"):
    return {"source_id": "test", "champ": champ, "status": status,
            "message": message, "http_status": 200, "response_time": 0.1}


class TestAggregation(unittest.TestCase):

    def test_tout_ok_est_available(self):
        status, _ = aggregate_source_status(row(), [url_result("OK")])
        self.assertEqual(status, "AVAILABLE")

    def test_fail_est_unavailable(self):
        status, message = aggregate_source_status(
            row(), [url_result("OK"), url_result("FAIL", "HTTP 404")])
        self.assertEqual(status, "UNAVAILABLE")
        self.assertIn("404", message)

    def test_warning_est_warning(self):
        status, _ = aggregate_source_status(
            row(), [url_result("WARNING")])
        self.assertEqual(status, "WARNING")

    def test_auth_prime_sur_warning(self):
        # INPI : anti-bot possible ET compte requis — l'accès sous
        # conditions est une caractéristique, pas une panne.
        status, message = aggregate_source_status(
            row(auth_requise="oui"), [url_result("WARNING", "HTTP 403")])
        self.assertEqual(status, "ACCESS_SPECIFIC")
        self.assertIn("403", message)

    def test_fail_prime_sur_auth(self):
        status, _ = aggregate_source_status(
            row(auth_requise="oui"), [url_result("FAIL", "HTTP 404")])
        self.assertEqual(status, "UNAVAILABLE")

    def test_manual_declare(self):
        status, _ = aggregate_source_status(row(controle="manual"), [])
        self.assertEqual(status, "MANUAL")


class TestKeyword(unittest.TestCase):

    def test_mot_present(self):
        ok, _ = keyword_present(
            row(mot_attendu="NAF"),
            lambda url, timeout: "<title>La NAF 2025</title>", 5)
        self.assertTrue(ok)

    def test_mot_absent_insensible_casse(self):
        ok, message = keyword_present(
            row(mot_attendu="Sirene"),
            lambda url, timeout: "<title>Autre chose</title>", 5)
        self.assertFalse(ok)
        self.assertIn("absent", message)

    def test_mot_absent_degrade_en_warning_dans_run_checks(self):
        def fetcher(url, method, timeout):
            return 200, url

        results = run_checks(
            [row(controle="http_keyword", mot_attendu="Sirene")],
            fetcher, timeout=1,
            body_fetcher=lambda url, timeout: "page inattendue")
        self.assertEqual(results[0]["status"], "WARNING")

    def test_source_manuelle_non_sondee(self):
        def fetcher(url, method, timeout):
            raise AssertionError("une source manuelle ne doit pas être sondée")

        results = run_checks([row(controle="manual")], fetcher, timeout=1)
        self.assertEqual(results, [])


class TestSnapshotZeroChurn(unittest.TestCase):

    def test_statuts_inchanges_ne_reecrivent_pas(self):
        rows = [row()]
        snapshot = build_snapshot(rows, [url_result("OK")])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "source_status.json"
            original = check_sources.SNAPSHOT_PATH
            check_sources.SNAPSHOT_PATH = path
            try:
                self.assertTrue(write_snapshot(snapshot))
                first = path.read_text(encoding="utf-8")
                # Deuxième passage : mêmes statuts, generated_at différent.
                snapshot2 = build_snapshot(rows, [url_result("OK")])
                self.assertFalse(write_snapshot(snapshot2))
                self.assertEqual(path.read_text(encoding="utf-8"), first)
                # Changement de statut : réécriture.
                snapshot3 = build_snapshot(rows, [url_result("FAIL")])
                self.assertTrue(write_snapshot(snapshot3))
            finally:
                check_sources.SNAPSHOT_PATH = original


class TestSnapshotVersionne(unittest.TestCase):
    """Le snapshot du dépôt doit rester cohérent avec le manifeste."""

    def setUp(self):
        self.snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
        import csv
        with MANIFEST.open(encoding="utf-8") as f:
            self.manifest_ids = {r["source_id"] for r in csv.DictReader(f)}

    def test_ids_du_snapshot_existent_dans_le_manifeste(self):
        ids = [s["source_id"] for s in self.snapshot["sources"]]
        self.assertEqual(len(ids), len(set(ids)), "doublon dans le snapshot")
        for sid in ids:
            self.assertIn(sid, self.manifest_ids)

    def test_aucune_source_du_manifeste_oubliee(self):
        ids = {s["source_id"] for s in self.snapshot["sources"]}
        self.assertEqual(ids, self.manifest_ids)

    def test_statuts_connus(self):
        for source in self.snapshot["sources"]:
            self.assertIn(source["status"], SOURCE_STATUSES)

    def test_date_iso_et_resume_coherent(self):
        import datetime as dt
        dt.datetime.strptime(self.snapshot["generated_at"],
                             "%Y-%m-%dT%H:%M:%SZ")
        summary = self.snapshot["summary"]
        self.assertEqual(summary["total"], len(self.snapshot["sources"]))
        recount = sum(summary[k] for k in SOURCE_STATUSES)
        self.assertEqual(recount, summary["total"])


if __name__ == "__main__":
    unittest.main()
