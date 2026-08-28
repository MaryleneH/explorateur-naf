#!/usr/bin/env python3
"""
Étude 05 — Signaux publics de fragilité ou de consolidation d'un périmètre
de fournisseurs.

Analyse strictement DESCRIPTIVE : on constitue un historique d'événements
juridiques publiés (BODACC) pour un périmètre de SIREN documenté, sans
construire de « score de risque ». La lecture d'un événement isolé n'a
aucune valeur prédictive.

Source : BODACC via l'API Opendatasoft de la DILA (open data), plusieurs
parutions par semaine. Aucune page HTML n'est scrapée : l'API structurée
existe (principe : API > téléchargement officiel > scraping).

Usage :
    python scripts/etudes/05_resilience_fournisseurs.py \
        --perimetre data/etudes/perimetre_siren.csv --depuis 2026-01-01

Le périmètre (colonne `siren`) est construit en amont, par exemple à partir
du REFD ; il n'est pas versionné s'il énumère des entreprises nommées.

Sorties :
    data/etudes/resilience_evenements.csv  (siren, date, type, source)
    data/etudes/resilience_resume.csv      (type d'événement × mois)
"""

import argparse
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import common  # noqa: E402

BODACC_BASE = "https://bodacc-datadila.opendatasoft.com"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--perimetre", required=True,
                        help="CSV avec colonne siren")
    parser.add_argument("--depuis", required=True,
                        help="date AAAA-MM-JJ de début d'observation")
    args = parser.parse_args()

    with open(args.perimetre, encoding="utf-8") as f:
        sirens = [row["siren"].strip() for row in csv.DictReader(f)
                  if row.get("siren", "").strip()]
    if not sirens:
        raise SystemExit("Périmètre vide : rien à observer.")
    common.log.info("périmètre : %d SIREN, observation depuis %s",
                    len(sirens), args.depuis)

    events: list[dict] = []
    for i in range(0, len(sirens), 40):
        chunk = ",".join(f"'{s}'" for s in sirens[i:i + 40])
        records = common.ods_records(
            BODACC_BASE, "annonces-commerciales",
            {"select": "registre,dateparution,familleavis_lib,typeavis_lib",
             "where": f"dateparution >= date'{args.depuis}' "
                      f"AND registre IN ({chunk})",
             "order_by": "dateparution"})
        for record in records:
            registre = record.get("registre")
            siren = (registre[0] if isinstance(registre, list) and registre
                     else str(registre or ""))[:9]
            events.append({
                "siren": siren,
                "date": record.get("dateparution", ""),
                "type_evenement": record.get("familleavis_lib")
                                   or record.get("typeavis_lib") or "(inconnu)",
                "source": "bodacc",
            })

    if not events:
        common.log.info("aucun événement publié sur la période pour ce "
                        "périmètre : sortie vide écrite (c'est un résultat).")
    common.write_output("resilience_evenements.csv",
                        ["siren", "date", "type_evenement", "source"], events)

    resume: dict[tuple, int] = {}
    for event in events:
        key = (event["date"][:7], event["type_evenement"])
        resume[key] = resume.get(key, 0) + 1
    common.write_output(
        "resilience_resume.csv",
        ["mois", "type_evenement", "evenements"],
        [{"mois": k[0], "type_evenement": k[1], "evenements": v}
         for k, v in sorted(resume.items())])
    common.update_manifest("bodacc")


if __name__ == "__main__":
    main()
