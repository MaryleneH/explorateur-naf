#!/usr/bin/env python3
"""
Étude 04 — Concentration des importations pour des familles de produits
associées à des chaînes de valeur potentiellement pertinentes pour la Défense.

Garde-fous méthodologiques (repris dans la page Comprendre) :
  - le commerce extérieur classe des PRODUITS (NC8/SH), pas des activités
    (NAF) : on ne fait jamais NAF → importations directement ;
  - la passerelle produits ↔ Défense est le fichier documenté
    data/etudes/mapping_produits_defense.csv (justification + confiance) ;
  - on ne produit PAS d'« indice de dépendance Défense » : on décrit la
    concentration des importations par famille de produits, rien de plus.

Données : statistiques mensuelles du commerce extérieur (DGDDI, open data).
Le format de diffusion évolue ; le script attend un CSV national détaillé
produit (NC8) × pays avec les colonnes à préciser en argument :
    --col-produit, --col-pays, --col-valeur, --col-mois, --col-flux
Le fichier est fourni via --input (téléchargé depuis douane.gouv.fr/opendata)
plutôt que par une URL codée en dur qui casserait au premier changement de
millésime : le script refuse d'inventer un emplacement.

Usage :
    python scripts/etudes/04_dependances_commerciales.py \
        --input data/cache/national_nc8_pays.csv \
        --col-produit NC8 --col-pays PAYS --col-valeur VALEUR \
        --col-mois MOIS --col-flux FLUX --valeur-import I

Sortie : data/etudes/dependances_commerciales.csv
Dépendances : duckdb.
"""

import argparse
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import common  # noqa: E402


def load_mapping() -> list[dict]:
    with (common.ETUDES_DIR / "mapping_produits_defense.csv").open(
            encoding="utf-8") as f:
        return list(csv.DictReader(f))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True,
                        help="CSV national détaillé NC8 × pays (douanes)")
    parser.add_argument("--col-produit", required=True)
    parser.add_argument("--col-pays", required=True)
    parser.add_argument("--col-valeur", required=True)
    parser.add_argument("--col-mois", required=True)
    parser.add_argument("--col-flux", required=True)
    parser.add_argument("--valeur-import", default="I",
                        help="valeur de la colonne flux désignant les imports")
    args = parser.parse_args()

    src = Path(args.input)
    if not src.exists():
        raise SystemExit(f"Fichier introuvable : {src}. Télécharger le "
                         "millésime le plus récent depuis "
                         "https://www.douane.gouv.fr/la-douane/opendata")

    mapping = load_mapping()
    con = common.duckdb_connect()

    # 13 derniers mois réellement présents dans le fichier : le script suit
    # le dernier millésime disponible au lieu de coder une date fixe.
    months = [m[0] for m in con.execute(f"""
        SELECT DISTINCT "{args.col_mois}" AS mois
        FROM read_csv('{src.as_posix()}', header=true, all_varchar=true,
                      sample_size=-1)
        ORDER BY 1 DESC LIMIT 13
    """).fetchall()]
    if not months:
        raise SystemExit("Aucun mois détecté : vérifier --col-mois.")
    months_sql = ",".join(f"'{m}'" for m in months)
    common.log.info("fenêtre observée : %s → %s", months[-1], months[0])

    out = []
    for entry in mapping:
        prefix = entry["code"]
        rows = con.execute(f"""
            SELECT "{args.col_pays}" AS pays,
                   SUM(TRY_CAST("{args.col_valeur}" AS DOUBLE)) AS valeur
            FROM read_csv('{src.as_posix()}', header=true, all_varchar=true,
                          sample_size=-1)
            WHERE "{args.col_flux}" = '{args.valeur_import}'
              AND "{args.col_mois}" IN ({months_sql})
              AND starts_with("{args.col_produit}", '{prefix}')
            GROUP BY 1 ORDER BY 2 DESC
        """).fetchall()
        total = sum(v or 0 for _, v in rows)
        if not total:
            common.log.warning("famille %s (%s) : aucun flux importé trouvé",
                               entry["famille"], prefix)
            continue
        parts = [(pays, (v or 0) / total) for pays, v in rows]
        out.append({
            "famille": entry["famille"],
            "code_produit": prefix,
            "libelle": entry["produit"],
            "niveau_confiance": entry["niveau_confiance"],
            "mois_debut": months[-1],
            "mois_fin": months[0],
            "valeur_importee": round(total),
            "premier_pays": parts[0][0],
            "part_premier_pays_pct": round(100 * parts[0][1], 1),
            "part_top3_pays_pct": round(100 * sum(p for _, p in parts[:3]), 1),
            "hhi_pays": round(sum(p * p for _, p in parts), 3),
            "nb_pays": len(parts),
        })

    if not out:
        raise SystemExit("Aucune famille agrégée : vérifier les colonnes "
                         "passées en argument (pas de sortie fictive).")
    common.write_output(
        "dependances_commerciales.csv",
        ["famille", "code_produit", "libelle", "niveau_confiance",
         "mois_debut", "mois_fin", "valeur_importee", "premier_pays",
         "part_premier_pays_pct", "part_top3_pays_pct", "hhi_pays",
         "nb_pays"], out)
    common.update_manifest("douanes", date_reference_max=months[0])


if __name__ == "__main__":
    main()
