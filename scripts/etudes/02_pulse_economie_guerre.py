#!/usr/bin/env python3
"""
Étude 02 — Observatoire de la montée en cadence (signaux publics mensuels).

On ne mesure PAS la capacité militaire réelle : on assemble des signaux
observables dans les données ouvertes, pour un périmètre documenté :
  - annonces BOAMP mentionnant des acheteurs / objets Défense ;
  - annonces BODACC (immatriculations, procédures) des unités du périmètre ;
  - marchés DECP dont un titulaire appartient au périmètre.

Rappel écrit dans la page Comprendre et à répéter dans toute restitution :
un marché sensible ou classifié peut être absent des données ouvertes.
Absence dans BOAMP/DECP ≠ absence de commande Défense.

Périmètre :
  - par défaut, néant côté SIREN : fournir --perimetre data/etudes/perimetre_siren.csv
    (colonne `siren`), construit par exemple à partir du REFD ;
  - les indicateurs BOAMP par mots-clés fonctionnent sans périmètre SIREN.

Usage :
    python scripts/etudes/02_pulse_economie_guerre.py --mois 2026-07
    python scripts/etudes/02_pulse_economie_guerre.py --mois 2026-07 \
        --perimetre data/etudes/perimetre_siren.csv

Sortie : data/etudes/pulse_mensuel.csv (mois, indicateur, valeur, source).
"""

import argparse
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import common  # noqa: E402

BOAMP_BASE = "https://boamp-datadila.opendatasoft.com"
BODACC_BASE = "https://bodacc-datadila.opendatasoft.com"

# Descripteurs BOAMP retenus : lexique de la commande publique de Défense.
# Liste courte et explicite plutôt qu'un filtre opaque.
BOAMP_TERMS = ["défense", "armement", "militaire", "armées"]


def read_perimetre(path: str | None) -> list[str]:
    if not path:
        return []
    with open(path, encoding="utf-8") as f:
        return [row["siren"].strip() for row in csv.DictReader(f)
                if row.get("siren", "").strip()]


def month_bounds(month: str) -> tuple[str, str]:
    year, mm = (int(x) for x in month.split("-"))
    nxt = f"{year + 1}-01-01" if mm == 12 else f"{year}-{mm + 1:02d}-01"
    return f"{year}-{mm:02d}-01", nxt


def indicateur_boamp(month: str) -> list[dict]:
    """Annonces BOAMP du mois contenant les termes Défense (objet/acheteur)."""
    start, end = month_bounds(month)
    rows = []
    for term in BOAMP_TERMS:
        where = (f"dateparution >= date'{start}' AND dateparution < date'{end}'"
                 f" AND search('{term}')")
        try:
            records = common.ods_records(BOAMP_BASE, "boamp",
                                         {"select": "idweb", "where": where})
        except RuntimeError as exc:
            common.log.warning("BOAMP indisponible (%s)", exc)
            return []
        rows.append({"mois": month,
                     "indicateur": f"annonces_boamp_terme_{term}",
                     "valeur": len(records), "source": "boamp"})
    common.update_manifest("boamp")
    return rows


def indicateur_bodacc(month: str, sirens: list[str]) -> list[dict]:
    """Annonces BODACC du mois pour les SIREN du périmètre, par famille."""
    if not sirens:
        common.log.info("pas de périmètre SIREN : indicateurs BODACC ignorés")
        return []
    start, end = month_bounds(month)
    counts: dict[str, int] = {}
    # L'API limite la longueur des clauses where : on interroge par paquets.
    for i in range(0, len(sirens), 40):
        chunk = ",".join(f"'{s}'" for s in sirens[i:i + 40])
        where = (f"dateparution >= date'{start}' AND dateparution < date'{end}'"
                 f" AND registre IN ({chunk})")
        try:
            records = common.ods_records(
                BODACC_BASE, "annonces-commerciales",
                {"select": "familleavis_lib", "where": where})
        except RuntimeError as exc:
            common.log.warning("BODACC indisponible (%s)", exc)
            return []
        for record in records:
            famille = record.get("familleavis_lib") or "(sans famille)"
            counts[famille] = counts.get(famille, 0) + 1
    common.update_manifest("bodacc")
    return [{"mois": month, "indicateur": f"annonces_bodacc_{famille}",
             "valeur": count, "source": "bodacc"}
            for famille, count in sorted(counts.items())]


def indicateur_decp(month: str, sirens: list[str]) -> list[dict]:
    """Marchés DECP notifiés dans le mois dont un titulaire est au périmètre.

    Schéma vérifié sur data.economie.gouv.fr (dataset
    decp-v3-marches-valides) : les titulaires sont éclatés en
    titulaire_id_1/_2/_3 (SIRET). Le schéma ayant déjà changé par le passé,
    l'échec est traité en avertissement, jamais en valeur inventée.
    """
    if not sirens:
        return []
    start, end = month_bounds(month)
    siren_set = set(sirens)
    try:
        records = common.ods_records(
            "https://data.economie.gouv.fr", "decp-v3-marches-valides",
            {"select": "titulaire_id_1,titulaire_id_2,titulaire_id_3,"
                       "datenotification",
             "where": f"datenotification >= date'{start}' "
                      f"AND datenotification < date'{end}'"})
    except RuntimeError as exc:
        common.log.warning("DECP indisponible ou schéma modifié (%s) : "
                           "indicateur ignoré", exc)
        return []
    hits = sum(1 for record in records
               if any(str(record.get(f"titulaire_id_{i}") or "")[:9]
                      in siren_set for i in (1, 2, 3)))
    common.update_manifest("decp")
    return [{"mois": month, "indicateur": "marches_decp_perimetre",
             "valeur": hits, "source": "decp"}]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mois", required=True, help="mois AAAA-MM à observer")
    parser.add_argument("--perimetre", default=None,
                        help="CSV avec colonne siren (périmètre fournisseurs)")
    args = parser.parse_args()

    sirens = read_perimetre(args.perimetre)
    rows = (indicateur_boamp(args.mois)
            + indicateur_bodacc(args.mois, sirens)
            + indicateur_decp(args.mois, sirens))
    if not rows:
        raise SystemExit("Aucun indicateur collecté : rien n'est écrit "
                         "(pas de sortie fictive).")

    # Append : la série se construit mois après mois, sans doublon.
    dest = common.ETUDES_DIR / "pulse_mensuel.csv"
    existing: list[dict] = []
    if dest.exists():
        with dest.open(encoding="utf-8") as f:
            existing = [r for r in csv.DictReader(f)
                        if r["mois"] != args.mois]
    common.write_output("pulse_mensuel.csv",
                        ["mois", "indicateur", "valeur", "source"],
                        existing + rows)


if __name__ == "__main__":
    main()
