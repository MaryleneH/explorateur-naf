"""Tests de la logique du checker de liens — aucun accès réseau.

Les réponses HTTP sont simulées par des fetchers injectés dans probe(),
et classify() est testée comme une fonction pure.
"""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "quality"))

from check_sources import classify, probe, run_checks  # noqa: E402


def row(mode="public", criticite="standard"):
    return {"source_id": "test", "nom": "Test", "producteur": "X",
            "url": "https://example.org", "mode_controle": mode,
            "criticite": criticite, "auth_requise": "non"}


class TestClassify(unittest.TestCase):

    def test_200_ok(self):
        self.assertEqual(classify(row(), 200, "")[0], "OK")

    def test_404_fail(self):
        verdict, message = classify(row(), 404, "")
        self.assertEqual(verdict, "FAIL")
        self.assertIn("404", message)

    def test_410_fail(self):
        self.assertEqual(classify(row(), 410, "")[0], "FAIL")

    def test_404_source_informative_devient_warning(self):
        verdict, message = classify(row(criticite="informative"), 404, "")
        self.assertEqual(verdict, "WARNING")
        self.assertIn("informative", message)

    def test_403_source_authentification_est_ok(self):
        verdict, message = classify(row(mode="authentification"), 403, "")
        self.assertEqual(verdict, "OK")
        self.assertIn("authentification", message)

    def test_401_source_authentification_est_ok(self):
        self.assertEqual(
            classify(row(mode="authentification"), 401, "")[0], "OK")

    def test_403_anti_bot_est_warning(self):
        verdict, _ = classify(row(mode="anti_bot_possible"), 403, "")
        self.assertEqual(verdict, "WARNING")

    def test_403_source_publique_est_warning(self):
        self.assertEqual(classify(row(), 403, "")[0], "WARNING")

    def test_429_warning(self):
        self.assertEqual(classify(row(), 429, "")[0], "WARNING")

    def test_503_warning(self):
        self.assertEqual(classify(row(), 503, "")[0], "WARNING")

    def test_dns_inexistant_fail(self):
        verdict, _ = classify(row(), None,
                              "URLError: getaddrinfo failed")
        self.assertEqual(verdict, "FAIL")

    def test_timeout_warning(self):
        verdict, _ = classify(row(), None, "TimeoutError: timed out")
        self.assertEqual(verdict, "WARNING")


class TestProbe(unittest.TestCase):

    def test_head_200_suffit(self):
        calls = []

        def fetcher(url, method, timeout):
            calls.append(method)
            return 200, url

        status, final, error = probe("https://example.org", fetcher)
        self.assertEqual(status, 200)
        self.assertEqual(calls, ["HEAD"])

    def test_head_refuse_puis_get(self):
        # Serveur qui refuse HEAD (405) mais sert GET : le GET conclut.
        def fetcher(url, method, timeout):
            return (405, url) if method == "HEAD" else (200, url)

        status, _, _ = probe("https://example.org", fetcher)
        self.assertEqual(status, 200)

    def test_redirection_suivie(self):
        def fetcher(url, method, timeout):
            return 200, "https://example.org/nouvelle-page"

        status, final, _ = probe("https://example.org/ancienne", fetcher)
        self.assertEqual(status, 200)
        self.assertEqual(final, "https://example.org/nouvelle-page")

    def test_retry_sur_5xx(self):
        attempts = []

        def fetcher(url, method, timeout):
            attempts.append(method)
            return (503, url) if len(attempts) < 3 else (200, url)

        status, _, _ = probe("https://example.org", fetcher, retries=2)
        self.assertEqual(status, 200)
        self.assertGreater(len(attempts), 2)

    def test_erreur_reseau_remontee(self):
        def fetcher(url, method, timeout):
            raise TimeoutError("timed out")

        status, _, error = probe("https://example.org", fetcher, retries=1)
        self.assertIsNone(status)
        self.assertIn("TimeoutError", error)


class TestRunChecks(unittest.TestCase):

    def test_url_invalide_est_fail_sans_reseau(self):
        def fetcher(url, method, timeout):  # ne doit jamais être appelé
            raise AssertionError("appel réseau interdit pour une URL invalide")

        bad = row()
        bad["url"] = "pas-une-url"
        results = run_checks([bad], fetcher, timeout=1)
        self.assertEqual(results[0]["status"], "FAIL")

    def test_toutes_les_colonnes_url_sont_sondees(self):
        seen = []

        def fetcher(url, method, timeout):
            seen.append(url)
            return 200, url

        full = row()
        full["url_documentation"] = "https://example.org/doc"
        full["url_api"] = "https://example.org/api"
        results = run_checks([full], fetcher, timeout=1)
        self.assertEqual(len(results), 3)
        self.assertTrue(all(r["status"] == "OK" for r in results))


if __name__ == "__main__":
    unittest.main()
