#!/usr/bin/env python3
"""
Étude 01 — Ce que la NAF 2025 change pour mesurer l'industrie de Défense.

Fenêtre d'observation unique : depuis le 16 décembre 2025 et jusqu'à début
janvier 2027, les fichiers stock Sirene diffusent pour chaque unité active
À LA FOIS le code APE officiel (NAF rév.2) et le futur code NAF 2025
(variables activitePrincipaleNAF25UniteLegale / ...NAF25Etablissement).
Source : Insee, Sirene open data actualités (information/9019311).

Ce script mesure, pour des codes 2008 fortement recomposés, la répartition
réelle des unités vers leurs futurs codes 2025.

Usage :
    python scripts/etudes/01_transition_naf2025.py
    python scripts/etudes/01_transition_naf2025.py --codes 30.30Z,25.40Z
    python scripts/etudes/01_transition_naf2025.py --url-etab <zip>  # millésime précis

Sorties (agrégats, versionnables) :
    data/etudes/transition_naf2025_summary.csv   ape2008 × futur ape2025
    data/etudes/transition_naf2025_regions.csv   idem × région d'implantation

Dépendances : duckdb (pip install duckdb).
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import common  # noqa: E402

# Codes NAF rév.2 dont la recomposition 2025 est documentée dans la table
# officielle Insee (scissions civil/militaire notamment).
DEFAULT_CODES = ["30.30Z", "30.11Z", "30.40Z", "25.40Z", "33.15Z", "33.16Z"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--codes", default=",".join(DEFAULT_CODES),
                        help="codes APE 2008 à suivre, séparés par des virgules")
    parser.add_argument("--url-etab", default=None,
                        help="URL du stockEtablissement zip (défaut : data.gouv)")
    parser.add_argument("--force", action="store_true",
                        help="retélécharger même si le cache existe")
    args = parser.parse_args()
    codes = [c.strip() for c in args.codes.split(",") if c.strip()]

    csv_path = common.sirene_stock_csv("etab", url=args.url_etab,
                                       force=args.force)

    # Détection des colonnes : les noms varient selon les millésimes, et la
    # variable NAF25 disparaîtra des stocks début janvier 2027.
    columns = common.csv_columns(csv_path)
    col_ape = common.find_column(columns, "activiteprincipale", "etablissement")
    col_naf25 = common.find_column(columns, "naf25", "etablissement")
    col_etat = common.find_column(columns, "etatadministratif", "etablissement")
    col_commune = common.find_column(columns, "codecommune")
    if not col_naf25:
        raise SystemExit(
            "Ce millésime ne contient pas de variable NAF25 : soit il est "
            "antérieur au 16/12/2025, soit postérieur à la bascule de "
            "janvier 2027 (les variables de préfiguration sont retirées). "
            f"Colonnes disponibles : {columns[:12]}…")
    if not (col_ape and col_etat):
        raise SystemExit(f"Colonnes APE/état introuvables dans {columns[:12]}…")

    con = common.duckdb_connect()
    codes_sql = ",".join(f"'{c}'" for c in codes)
    common.log.info("agrégation DuckDB sur %s (colonnes projetées uniquement)",
                    csv_path.name)

    # Lecture projetée : seules quatre colonnes sont lues du fichier stock.
    base = f"""
        SELECT "{col_ape}"    AS ape2008,
               "{col_naf25}"  AS ape2025,
               "{col_commune}" AS commune
        FROM read_csv('{csv_path.as_posix()}', header=true,
                      all_varchar=true, sample_size=-1)
        WHERE "{col_etat}" = 'A' AND "{col_ape}" IN ({codes_sql})
    """

    summary = con.execute(f"""
        SELECT ape2008,
               COALESCE(NULLIF(ape2025, ''), '(non renseigné)') AS ape2025,
               COUNT(*) AS etablissements
        FROM ({base})
        GROUP BY 1, 2 ORDER BY 1, 3 DESC
    """).fetchall()

    per_dept = con.execute(f"""
        SELECT ape2008,
               COALESCE(NULLIF(ape2025, ''), '(non renseigné)') AS ape2025,
               commune, COUNT(*) AS etablissements
        FROM ({base})
        GROUP BY 1, 2, 3
    """).fetchall()

    # Totaux par code 2008 pour exprimer des parts réellement calculées.
    totals: dict[str, int] = {}
    for ape2008, _, count in summary:
        totals[ape2008] = totals.get(ape2008, 0) + count

    common.write_output(
        "transition_naf2025_summary.csv",
        ["ape2008", "futur_ape2025", "etablissements_actifs", "part_pct"],
        [{"ape2008": a, "futur_ape2025": b, "etablissements_actifs": n,
          "part_pct": round(100 * n / totals[a], 2)}
         for a, b, n in summary])

    regions: dict[tuple, int] = {}
    for ape2008, ape2025, commune, count in per_dept:
        region = common.DEPT_REGION.get(
            common.dept_of_commune(commune or ""), "(autre / non renseigné)")
        key = (ape2008, ape2025, region)
        regions[key] = regions.get(key, 0) + count
    common.write_output(
        "transition_naf2025_regions.csv",
        ["ape2008", "futur_ape2025", "region", "etablissements_actifs"],
        [{"ape2008": k[0], "futur_ape2025": k[1], "region": k[2],
          "etablissements_actifs": v}
         for k, v in sorted(regions.items())])

    common.update_manifest("sirene_stock")
    common.log.info("terminé : %d codes suivis, %d transitions distinctes",
                    len(codes), len(summary))


if __name__ == "__main__":
    main()
