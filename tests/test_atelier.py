"""Tests de l'Atelier d'étude (data/atelier_scenarios.json) — aucun réseau.

Deux familles de garanties :
  - intégrité : toutes les références (sources, grains, limitations,
    fraîcheurs, ancres de la Boîte à outils) résolvent ;
  - méthodologie : les règles clés du site sont encodées et ne peuvent pas
    régresser silencieusement (la NAF n'est pas le point de départ
    universel, les Douanes portent les dépendances, le REFD n'est pas la
    BITD, les brevets sont un signal retardé…).
"""

import csv
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

TOOLBOX_ANCHORS = {"fiche-sirene", "fiche-sirus", "fiche-side",
                   "fiche-boamp", "fiche-decp", "fiche-bodacc",
                   "fiche-douanes", "fiche-inpi", "fiche-refd", "fiche-naf"}


def load_rules():
    with (ROOT / "data" / "atelier_scenarios.json").open(
            encoding="utf-8") as f:
        return json.load(f)


def manifest_ids():
    with (ROOT / "data" / "etudes" / "sources.csv").open(
            encoding="utf-8") as f:
        return {r["source_id"] for r in csv.DictReader(f)}


def scenario(rules, sid):
    return next(s for s in rules["scenarios"] if s["id"] == sid)


class TestIntegrite(unittest.TestCase):

    def setUp(self):
        self.rules = load_rules()
        self.sources = manifest_ids()

    def test_sept_scenarios(self):
        ids = [s["id"] for s in self.rules["scenarios"]]
        self.assertEqual(len(ids), len(set(ids)))
        for wanted in ("implantations", "fournisseurs_defense",
                       "marches_publics", "dependances", "resilience",
                       "innovation", "transition_naf"):
            self.assertIn(wanted, ids)

    def test_sources_referencees_existent(self):
        for s in self.rules["scenarios"]:
            for entry in s["sources"]:
                self.assertIn(entry["id"], self.sources,
                              f"{s['id']}: source inconnue {entry['id']}")
                if entry.get("alternative_id"):
                    self.assertIn(entry["alternative_id"], self.sources)

    def test_grains_referencies_existent(self):
        for s in self.rules["scenarios"]:
            for g in s["grains"]:
                self.assertIn(g["id"], self.rules["grains"],
                              f"{s['id']}: grain inconnu {g['id']}")

    def test_limitations_resolvent(self):
        for s in self.rules["scenarios"]:
            self.assertTrue(s["limites"],
                            f"{s['id']}: aucune limite — interdit")
            for lid in s["limites"]:
                self.assertIn(lid, self.rules["limitations"],
                              f"{s['id']}: limitation inconnue {lid}")

    def test_fraicheurs_et_perimetres_resolvent(self):
        for s in self.rules["scenarios"]:
            for f in s["fraicheurs"]:
                self.assertIn(f["id"], self.rules["fraicheurs"])
            for p in s["perimetres"]:
                self.assertIn(p["id"], self.rules["perimetre_labels"],
                              f"{s['id']}: périmètre sans libellé {p['id']}")

    def test_chaque_scenario_a_un_choix_recommande(self):
        for s in self.rules["scenarios"]:
            for champ in ("grains", "perimetres", "fraicheurs"):
                niveaux = [x["niveau"] for x in s[champ]]
                self.assertIn("recommande", niveaux,
                              f"{s['id']}: aucun {champ} recommandé")
            roles = [x["role"] for x in s["sources"]]
            self.assertIn("recommandee", roles)

    def test_alertes_referencent_des_choix_reels(self):
        for s in self.rules["scenarios"]:
            for a in s.get("alertes", []):
                if "si_grain" in a:
                    self.assertIn(a["si_grain"],
                                  [g["id"] for g in s["grains"]])
                if "si_perimetre" in a:
                    self.assertIn(a["si_perimetre"],
                                  [p["id"] for p in s["perimetres"]])
                if "si_sources_sans" in a:
                    self.assertIn(a["si_sources_sans"],
                                  [x["id"] for x in s["sources"]])

    def test_ancres_boite_a_outils(self):
        source = (ROOT / "comprendre" / "boite-outils.qmd").read_text(
            encoding="utf-8")
        for anchor in TOOLBOX_ANCHORS:
            self.assertIn(f'id="{anchor}"', source)


class TestMethodologie(unittest.TestCase):

    def setUp(self):
        self.rules = load_rules()

    def test_dependances_partent_des_douanes_pas_de_sirene(self):
        s = scenario(self.rules, "dependances")
        recommandees = [x["id"] for x in s["sources"]
                        if x["role"] == "recommandee"]
        self.assertIn("douanes", recommandees)
        self.assertNotIn("sirene_stock", recommandees,
                         "Sirene ne doit pas être recommandée pour les "
                         "dépendances commerciales")
        grains = [g["id"] for g in s["grains"]]
        self.assertEqual(grains, ["produit_pays"])
        self.assertTrue(any(a.get("si_sources_sans") == "douanes"
                            for a in s["alertes"]))

    def test_implantations_unite_legale_declenche_avertissement(self):
        s = scenario(self.rules, "implantations")
        ul = next(g for g in s["grains"] if g["id"] == "unite_legale")
        self.assertEqual(ul["niveau"], "prudence")
        self.assertIn("juridique", ul["avertissement"])
        self.assertTrue(any(a.get("si_grain") == "unite_legale"
                            for a in s["alertes"]))
        etab = next(g for g in s["grains"] if g["id"] == "etablissement")
        self.assertEqual(etab["niveau"], "recommande")

    def test_fournisseurs_defense_refd_edis_et_limite(self):
        s = scenario(self.rules, "fournisseurs_defense")
        recommandees = [x["id"] for x in s["sources"]
                        if x["role"] == "recommandee"]
        self.assertIn("refd", recommandees)
        self.assertIn("edis", recommandees)
        self.assertIn("refd_non_exhaustif", s["limites"])
        texte = self.rules["limitations"]["refd_non_exhaustif"]
        self.assertIn("exhaustif", texte)
        self.assertIn("BITD", texte)
        naf = next(p for p in s["perimetres"] if p["id"] == "naf")
        self.assertEqual(naf["niveau"], "prudence")

    def test_marches_decp_boamp_avant_sirene(self):
        s = scenario(self.rules, "marches_publics")
        recommandees = [x["id"] for x in s["sources"]
                        if x["role"] == "recommandee"]
        self.assertIn("decp", recommandees)
        self.assertIn("boamp", recommandees)
        sirene = next(x for x in s["sources"] if x["id"] == "sirene_stock")
        self.assertNotEqual(sirene["role"], "recommandee",
                            "Sirene est un enrichissement, pas le point "
                            "d'entrée des marchés")
        grains = {g["id"]: g["niveau"] for g in s["grains"]}
        self.assertEqual(grains["marche"], "recommande")

    def test_innovation_inclut_le_delai_des_brevets(self):
        s = scenario(self.rules, "innovation")
        self.assertIn("brevet_delai", s["limites"])
        self.assertIn("18 mois", self.rules["limitations"]["brevet_delai"])

    def test_la_naf_nest_jamais_le_seul_perimetre_recommande_partout(self):
        # Au moins quatre scénarios sur sept doivent recommander un
        # périmètre autre que la NAF : l'atelier ne doit pas laisser croire
        # qu'une étude commence nécessairement par la nomenclature.
        autres = 0
        for s in self.rules["scenarios"]:
            reco = [p["id"] for p in s["perimetres"]
                    if p["niveau"] == "recommande"]
            if reco and "naf" not in reco:
                autres += 1
        self.assertGreaterEqual(autres, 4)

    def test_resilience_sans_score_de_risque(self):
        s = scenario(self.rules, "resilience")
        notes = " ".join((i.get("note") or "") for i in s["indicateurs"])
        self.assertIn("score de risque", notes)
        self.assertIn("evenements_publies", s["limites"])


if __name__ == "__main__":
    unittest.main()
