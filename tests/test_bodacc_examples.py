"""Tests des trois annonces BODACC d'exemple (data/exemples/bodacc/).

Garanties :
  - intégrité : trois fichiers JSON valides, ids présents et distincts,
    familles attendues, personnes morales uniquement ;
  - authenticité : chaque annonce de raw/ est identique, champ à champ, à
    l'enregistrement correspondant de la réponse API archivée dans
    reponses_api/ — rien n'a été fabriqué ni retouché à la main ;
  - pédagogie : les trois annonces ont réellement des structures
    différentes (ensembles de branches remplies distincts deux à deux) ;
  - traçabilité : provenance.csv documente chaque fichier (id, URL d'API,
    URL de l'annonce, date de collecte, producteur, licence).
"""

import csv
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "data" / "exemples" / "bodacc"

BRANCHES = ("listepersonnes", "listeetablissements", "jugement", "acte",
            "modificationsgenerales", "radiationaurcs", "depot")

RAW_ATTENDUS = {
    "01_creation.json": ("creation", "creations_limit3.json"),
    "02_procedure_collective.json": ("collective",
                                     "procedures_collectives_limit3.json"),
    "03_radiation.json": ("radiation", "radiations_limit3.json"),
}


def charger_raw():
    annonces = {}
    for nom in RAW_ATTENDUS:
        with (BASE / "raw" / nom).open(encoding="utf-8") as f:
            annonces[nom] = json.load(f)
    return annonces


class TestExemplesBodacc(unittest.TestCase):

    def test_trois_fichiers_json_valides(self):
        annonces = charger_raw()
        self.assertEqual(len(annonces), 3)
        for nom, annonce in annonces.items():
            self.assertIsInstance(annonce, dict, nom)

    def test_ids_presents_et_distincts(self):
        annonces = charger_raw()
        ids = [a["id"] for a in annonces.values()]
        self.assertTrue(all(ids))
        self.assertEqual(len(set(ids)), 3)

    def test_familles_attendues(self):
        annonces = charger_raw()
        for nom, (famille, _) in RAW_ATTENDUS.items():
            self.assertEqual(annonces[nom]["familleavis"], famille, nom)

    def test_personnes_morales_uniquement(self):
        for nom, annonce in charger_raw().items():
            personnes = json.loads(annonce["listepersonnes"])
            personne = personnes["personne"]
            if isinstance(personne, list):
                personne = personne[0]
            self.assertEqual(personne["typePersonne"], "pm", nom)

    def test_structures_reellement_differentes(self):
        signatures = {}
        for nom, annonce in charger_raw().items():
            signatures[nom] = frozenset(
                b for b in BRANCHES if annonce.get(b) is not None)
        self.assertEqual(len(set(signatures.values())), 3,
                         f"branches identiques : {signatures}")

    def test_annonces_identiques_aux_reponses_api(self):
        for nom, (_, reponse) in RAW_ATTENDUS.items():
            with (BASE / "raw" / nom).open(encoding="utf-8") as f:
                annonce = json.load(f)
            with (BASE / "reponses_api" / reponse).open(encoding="utf-8") as f:
                resultats = json.load(f)["results"]
            original = next(r for r in resultats if r["id"] == annonce["id"])
            self.assertEqual(annonce, original, nom)

    def test_provenance_complete(self):
        with (BASE / "provenance.csv").open(encoding="utf-8") as f:
            lignes = list(csv.DictReader(f))
        self.assertEqual({l["fichier"] for l in lignes},
                         {"raw/" + n for n in RAW_ATTENDUS})
        for ligne in lignes:
            for champ in ("id_annonce", "familleavis", "dateparution",
                          "url_api", "url_annonce", "date_collecte",
                          "producteur", "licence", "commentaire"):
                self.assertTrue(ligne[champ].strip(),
                                f"{ligne['fichier']} : {champ} vide")
            self.assertTrue(ligne["url_api"].startswith(
                "https://bodacc-datadila.opendatasoft.com/api/explore/v2.1"))
            self.assertIn("Licence Ouverte", ligne["licence"])

    def test_provenance_coherente_avec_les_fichiers(self):
        with (BASE / "provenance.csv").open(encoding="utf-8") as f:
            par_fichier = {l["fichier"]: l for l in csv.DictReader(f)}
        for nom, annonce in charger_raw().items():
            ligne = par_fichier["raw/" + nom]
            self.assertEqual(ligne["id_annonce"], annonce["id"])
            self.assertEqual(ligne["dateparution"], annonce["dateparution"])
            self.assertEqual(ligne["url_annonce"], annonce["url_complete"])


if __name__ == "__main__":
    unittest.main()
