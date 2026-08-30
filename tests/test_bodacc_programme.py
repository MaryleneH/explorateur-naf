"""Tests du programme scripts/programmes/python/bodacc_json.py.

Garanties :
  - la chaîne complète tourne sur les trois annonces réelles et produit
    les trois CSV attendus ;
  - le GRAIN est respecté : autant de lignes annonces que de fichiers
    sources, une seule ligne par id (aucune duplication par aplatissement) ;
  - le SIREN reste une chaîne de 9 chiffres (jamais un entier) ;
  - les dates sont valides, la famille d'avis est connue ;
  - une branche absente ou une famille inconnue ne fait jamais planter le
    programme : l'annonce est conservée et l'anomalie consignée.
"""

import csv
import datetime
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "exemples" / "bodacc" / "raw"

spec = importlib.util.spec_from_file_location(
    "bodacc_json",
    ROOT / "scripts" / "programmes" / "python" / "bodacc_json.py")
bodacc = importlib.util.module_from_spec(spec)
sys.modules["bodacc_json"] = bodacc
spec.loader.exec_module(bodacc)


def lire_csv(path):
    with path.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


class TestProgrammeBodacc(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.out = Path(cls.tmp.name)
        cls.code_retour = bodacc.main(
            ["--raw-dir", str(RAW), "--out-dir", str(cls.out)])
        cls.annonces = lire_csv(cls.out / "bodacc_annonces.csv")
        cls.evenements = lire_csv(cls.out / "bodacc_evenements.csv")
        cls.controles = lire_csv(cls.out / "bodacc_controles.csv")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_execution_reussie(self):
        self.assertEqual(self.code_retour, 0)

    def test_trois_sorties_produites(self):
        for nom in ("bodacc_annonces.csv", "bodacc_evenements.csv",
                    "bodacc_controles.csv"):
            self.assertTrue((self.out / nom).exists(), nom)

    def test_grain_annonces(self):
        nb_sources = len(list(RAW.glob("*.json")))
        self.assertEqual(len(self.annonces), nb_sources)
        ids = [a["id_annonce"] for a in self.annonces]
        self.assertEqual(len(set(ids)), len(ids))

    def test_evenements_relies_aux_annonces(self):
        ids_annonces = {a["id_annonce"] for a in self.annonces}
        self.assertTrue(self.evenements)
        for e in self.evenements:
            self.assertIn(e["id_annonce"], ids_annonces)
            self.assertTrue(e["type_evenement"])

    def test_siren_chaine_de_9_chiffres(self):
        for a in self.annonces:
            if a["siren"]:
                self.assertRegex(a["siren"], r"^\d{9}$")

    def test_dates_valides(self):
        for a in self.annonces:
            datetime.date.fromisoformat(a["date_parution"])
        for e in self.evenements:
            if e["date_evenement"]:
                datetime.date.fromisoformat(e["date_evenement"])

    def test_familles_renseignees(self):
        for a in self.annonces:
            self.assertTrue(a["famille_avis"].strip())

    def test_controles_tous_verts(self):
        statuts = {c["controle"]: c["statut"] for c in self.controles}
        self.assertNotIn("ATTENTION", statuts.values())
        self.assertEqual(statuts["id_annonce_unique"], "OK")

    def test_branche_absente_ne_plante_pas(self):
        # Annonce minimale : famille connue mais branche attendue absente.
        warnings = []
        annonce = {"id": "TEST1", "familleavis": "radiation",
                   "dateparution": "2026-01-01"}
        evenement = bodacc.extraire_evenement(annonce, warnings)
        self.assertEqual(evenement["type_evenement"], "radiation")
        self.assertEqual(evenement["date_evenement"], "2026-01-01")
        self.assertTrue(any("radiationaurcs" in w for w in warnings))

    def test_famille_inconnue_signalee_sans_plantage(self):
        warnings = []
        evenement = bodacc.extraire_evenement(
            {"id": "TEST2", "familleavis": "avis_martien"}, warnings)
        self.assertEqual(evenement["type_evenement"], "avis_martien")
        self.assertTrue(any("inconnue" in w for w in warnings))

    def test_normalisation_siren(self):
        self.assertEqual(bodacc.normaliser_siren("879 178 804"), "879178804")
        self.assertEqual(bodacc.normaliser_siren("053 800 257"), "053800257")
        self.assertIsNone(bodacc.normaliser_siren("12345"))
        self.assertIsNone(bodacc.normaliser_siren(None))


if __name__ == "__main__":
    unittest.main()
