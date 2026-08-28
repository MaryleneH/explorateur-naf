#!/usr/bin/env python3
"""
Étude 06 — Signaux d'innovation dans les technologies duales.

Deux volets, aux fraîcheurs très différentes (et c'est le point pédagogique) :

1. BREVETS (INPI) — signal RETARDÉ : un brevet est en général publié
   18 mois après le dépôt. L'activité brevets récente ne mesure donc pas
   l'innovation « temps réel » de 2026. L'API data.inpi.fr requiert un
   compte : le script attend un export JSON/CSV téléchargé par l'analyste
   (--brevets), il ne stocke aucun identifiant.

2. ANNONCES PUBLIQUES (AID) — signal FRAIS : appels à projets et actualités
   de l'Agence de l'innovation de défense. Aucune API n'étant identifiée,
   collecte HTML *respectueuse* : robots.txt vérifié avant tout accès,
   User-Agent explicite, une seule page, temporisation, cache. Le script
   n'enregistre que titre / date / lien, sans aucune interprétation : la
   qualification éditoriale reste humaine (pipeline collecte → contrôle →
   validation → publication).

Classification thématique : dictionnaire explicite de familles
technologiques appliqué aux titres/résumés normalisés. Pas d'embeddings ni
de modèle : à ce volume, un lexique documenté est plus contrôlable.

Usage :
    python scripts/etudes/06_innovation_duale.py --brevets export_inpi.csv \
        --col-titre titre --col-date date_publication
    python scripts/etudes/06_innovation_duale.py --veille-aid

Sorties :
    data/etudes/innovation_signaux.csv   (brevets classés par famille)
    data/etudes/veille_aid.csv           (titre, date, url, date_collecte)
"""

import argparse
import csv
import datetime as dt
import re
import sys
import unicodedata
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import common  # noqa: E402

AID_URL = "https://www.defense.gouv.fr/aid/actualites"

# Dictionnaire thématique : listes courtes, explicites, critiquables.
FAMILLES = {
    "drones_antidrone": ["drone", "uav", "uas", "antidrone", "anti-drone",
                         "essaim"],
    "ia": ["intelligence artificielle", "apprentissage automatique",
           "machine learning", "reseau de neurones"],
    "cyber": ["cyber", "cryptograph", "chiffrement", "intrusion"],
    "optronique_capteurs": ["optronique", "laser", "infrarouge", "capteur",
                            "imagerie", "lidar"],
    "spatial": ["satellite", "spatial", "orbite", "lanceur"],
    "communications": ["radio", "telecommunication", "antenne", "5g",
                       "liaison de donnees"],
}


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFD", text.lower())
    return "".join(c for c in text if unicodedata.category(c) != "Mn")


def classify(text: str) -> list[str]:
    norm = normalize(text)
    return [famille for famille, terms in FAMILLES.items()
            if any(term in norm for term in terms)]


def volet_brevets(path: str, col_titre: str, col_date: str) -> None:
    src = Path(path)
    if not src.exists():
        raise SystemExit(f"Export brevets introuvable : {src}")
    out = []
    with src.open(encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            titre = row.get(col_titre, "")
            if not titre:
                continue
            familles = classify(titre)
            out.append({
                "date_publication": row.get(col_date, ""),
                "titre": titre[:300],
                "familles": ";".join(familles) or "(hors dictionnaire)",
                "source": "inpi",
            })
    common.write_output("innovation_signaux.csv",
                        ["date_publication", "titre", "familles", "source"],
                        out)
    common.update_manifest("inpi_brevets")
    common.log.info("rappel : publication des brevets différée (~18 mois) — "
                    "signal retardé, pas une mesure temps réel.")


class TitleLinkParser(HTMLParser):
    """Extrait (titre, href) des liens d'articles d'une page d'actualités."""

    def __init__(self):
        super().__init__()
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            href = dict(attrs).get("href", "")
            if "/aid/" in href or "actualite" in href:
                self._href = href
                self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self._href is not None:
            text = re.sub(r"\s+", " ", "".join(self._text)).strip()
            if len(text) > 15:
                self.links.append((text, self._href))
            self._href = None


def volet_veille_aid() -> None:
    if not common.robots_allows(AID_URL):
        raise SystemExit(
            f"robots.txt n'autorise pas la collecte de {AID_URL} pour notre "
            "User-Agent : on s'abstient (aucun contournement).")
    html = common.http_get(AID_URL, timeout=30).decode("utf-8",
                                                       errors="replace")
    parser = TitleLinkParser()
    parser.feed(html)
    today = dt.date.today().isoformat()
    seen = set()
    rows = []
    for titre, href in parser.links:
        if href in seen:
            continue
        seen.add(href)
        url = href if href.startswith("http") else \
            "https://www.defense.gouv.fr" + href
        rows.append({"titre": titre, "url": url, "date_collecte": today,
                     "familles": ";".join(classify(titre)) or ""})
    if not rows:
        raise SystemExit("Aucun lien d'actualité reconnu : la structure de la "
                         "page a probablement changé — adapter le parseur, "
                         "ne rien publier en l'état.")
    common.write_output("veille_aid.csv",
                        ["titre", "url", "date_collecte", "familles"], rows)
    common.log.info("%d titres collectés — la sélection éditoriale reste à "
                    "faire à la main avant toute publication.", len(rows))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--brevets", default=None,
                        help="export CSV INPI (titres de brevets)")
    parser.add_argument("--col-titre", default="titre")
    parser.add_argument("--col-date", default="date_publication")
    parser.add_argument("--veille-aid", action="store_true",
                        help="collecter les titres d'actualités de l'AID")
    args = parser.parse_args()

    if not args.brevets and not args.veille_aid:
        raise SystemExit("Préciser --brevets et/ou --veille-aid.")
    if args.brevets:
        volet_brevets(args.brevets, args.col_titre, args.col_date)
    if args.veille_aid:
        volet_veille_aid()


if __name__ == "__main__":
    main()
