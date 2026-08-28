#!/usr/bin/env python3
"""
Étude 03 — Concentrations territoriales des établissements par activité.

Pour chaque code d'activité suivi, mesure la concentration géographique des
établissements ACTIFS du répertoire Sirene : nombre d'établissements,
départements et régions couverts, part des trois premiers départements,
HHI territorial.

HHI (Herfindahl-Hirschman) : somme des carrés des parts départementales.
Il mesure UNIQUEMENT la concentration du NOMBRE d'établissements entre
départements (1 = tout dans un seul département). Il ne mesure ni capacité
de production, ni effectifs, ni chiffre d'affaires.

Limite écrite dans la page Comprendre : nombre d'établissements ≠ capacité.
Un site unique peut concentrer l'essentiel de la production.

Usage :
    python scripts/etudes/03_geographie_capacites.py            # codes Défense documentés
    python scripts/etudes/03_geographie_capacites.py --codes 26.51Y,30.32Y --version 2025

Sortie : data/etudes/geographie_capacites.csv
Dépendances : duckdb.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import common  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--codes", default=None,
                        help="codes à suivre (défaut : qualification Défense)")
    parser.add_argument("--version", choices=["2008", "2025"], default="2008",
                        help="2008 = APE officiel ; 2025 = futur code NAF25")
    parser.add_argument("--url-etab", default=None)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    if args.codes:
        codes = [c.strip() for c in args.codes.split(",") if c.strip()]
    else:
        version = "NAF rév.2" if args.version == "2008" else "NAF 2025"
        codes = common.load_defense_codes(version)
        common.log.info("périmètre : %d codes qualifiés %s (rappel : "
                        "non évalué ≠ non Défense)", len(codes), version)

    csv_path = common.sirene_stock_csv("etab", url=args.url_etab,
                                       force=args.force)
    columns = common.csv_columns(csv_path)
    col_etat = common.find_column(columns, "etatadministratif", "etablissement")
    col_commune = common.find_column(columns, "codecommune")
    if args.version == "2008":
        col_code = common.find_column(columns, "activiteprincipale",
                                      "etablissement")
        # Éviter de retomber sur la variable NAF25 qui contient aussi
        # "activiteprincipale...etablissement".
        if col_code and "naf25" in col_code.lower():
            col_code = next(c for c in columns
                            if "activiteprincipale" in c.lower()
                            and "etablissement" in c.lower()
                            and "naf25" not in c.lower())
    else:
        col_code = common.find_column(columns, "naf25", "etablissement")
        if not col_code:
            raise SystemExit("Pas de variable NAF25 dans ce millésime "
                             "(diffusée du 16/12/2025 à début janvier 2027).")

    con = common.duckdb_connect()
    codes_sql = ",".join(f"'{c}'" for c in codes)
    rows = con.execute(f"""
        SELECT "{col_code}" AS code, "{col_commune}" AS commune, COUNT(*) AS n
        FROM read_csv('{csv_path.as_posix()}', header=true,
                      all_varchar=true, sample_size=-1)
        WHERE "{col_etat}" = 'A' AND "{col_code}" IN ({codes_sql})
        GROUP BY 1, 2
    """).fetchall()

    # Agrégation département / région en Python (les volumes sont petits ici).
    by_code: dict[str, dict[str, int]] = {}
    for code, commune, count in rows:
        dept = common.dept_of_commune(commune or "")
        by_code.setdefault(code, {})
        by_code[code][dept] = by_code[code].get(dept, 0) + count

    out = []
    for code in sorted(by_code):
        depts = by_code[code]
        total = sum(depts.values())
        parts = sorted(depts.values(), reverse=True)
        top3 = round(100 * sum(parts[:3]) / total, 1) if total else 0.0
        hhi = round(sum((v / total) ** 2 for v in depts.values()), 3)
        regions = {common.DEPT_REGION.get(d, "(autre)") for d in depts if d}
        out.append({
            "code": code,
            "version": args.version,
            "etablissements_actifs": total,
            "departements": len([d for d in depts if d]),
            "regions": len(regions),
            "part_top3_departements_pct": top3,
            "hhi_departemental": hhi,
        })

    common.write_output(
        "geographie_capacites.csv",
        ["code", "version", "etablissements_actifs", "departements",
         "regions", "part_top3_departements_pct", "hhi_departemental"], out)
    common.update_manifest("sirene_stock")


if __name__ == "__main__":
    main()
