#!/usr/bin/env python3
"""
sirene.py — accéder proprement au répertoire Sirene.

Trois stratégies, selon le besoin (voir la Boîte à outils du site) :

  stock   analyses de masse, population complète. Le script interroge les
          MÉTADONNÉES data.gouv du jeu Sirene pour retrouver la ressource
          la plus récente (CSV zippé ou Parquet) : aucun lien mensuel n'est
          figé dans le code.
  api     requêtes ciblées (une unité, un critère). Nécessite une clé du
          portail api.insee.fr dans la variable d'environnement
          SIRENE_API_TOKEN (en-tête X-INSEE-Api-Key-Integration).
  geo     géolocalisation des établissements pour études territoriales.

Exemples :
    python scripts/toolbox/python/sirene.py stock --dry-run
    python scripts/toolbox/python/sirene.py stock --fichier StockUniteLegale --format parquet --dry-run
    python scripts/toolbox/python/sirene.py api --siren 552100554 --dry-run
    python scripts/toolbox/python/sirene.py geo --dry-run

Sans --dry-run, `stock` et `geo` téléchargent dans data/raw/ (ignoré par
git). `api` exécute la requête (quelques Ko).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import helpers  # noqa: E402

DATAGOUV_API = "https://www.data.gouv.fr/api/1/datasets"
DATASET_SIRENE = "base-sirene-des-entreprises-et-de-leurs-etablissements-siren-siret"
DATASET_GEO = ("geolocalisation-des-etablissements-du-repertoire-sirene-"
               "pour-les-etudes-statistiques")
SIRENE_API = "https://api.insee.fr/api-sirene/3.11"


def latest_resource(dataset: str, name_contains: str,
                    fmt: str | None = None) -> dict:
    """Retrouve la ressource la plus récente d'un jeu data.gouv.

    On lit les métadonnées du dataset plutôt que de figer une URL de
    fichier mensuel : le lien reste valable millésime après millésime.
    """
    meta = helpers.http_json(f"{DATAGOUV_API}/{dataset}/")
    candidates = [
        r for r in meta.get("resources", [])
        if name_contains.lower() in (r.get("title") or "").lower()
        and (fmt is None or (r.get("format") or "").lower() == fmt.lower())
    ]
    if not candidates:
        raise SystemExit(
            f"Aucune ressource « {name_contains} » (format={fmt}) dans le "
            f"jeu {dataset} : vérifier les métadonnées sur data.gouv.fr.")
    candidates.sort(key=lambda r: r.get("last_modified") or "", reverse=True)
    return candidates[0]


def cmd_stock(args) -> None:
    fmt = None if args.format == "auto" else args.format
    # « StockEtablissement - » et non « StockEtablissement » : le jeu contient
    # aussi StockEtablissementLiensSuccession et StockEtablissementHistorique,
    # qu'un simple test de sous-chaîne attraperait par erreur.
    resource = latest_resource(DATASET_SIRENE, f"{args.fichier} -", fmt)
    print(f"ressource la plus récente : {resource['title']}")
    print(f"  modifiée le : {(resource.get('last_modified') or '?')[:10]}")
    dest = helpers.RAW_DIR / Path(resource["url"]).name
    helpers.download(resource["url"], dest, dry_run=args.dry_run)
    if args.dry_run:
        print("\nEnsuite : lire en colonnes projetées avec DuckDB, jamais "
              "en chargement complet (voir la Boîte à outils, recette 03).")


def cmd_api(args) -> None:
    token = os.getenv("SIRENE_API_TOKEN")
    url = f"{SIRENE_API}/siret?q=siren:{args.siren}&nombre={args.nombre}"
    headers = {"X-INSEE-Api-Key-Integration": token or "(SIRENE_API_TOKEN)"}
    if args.dry_run:
        helpers.describe_request(
            f"établissements du SIREN {args.siren} via l'API Sirene 3.11",
            url, headers=headers)
        if not token:
            print("  note     : SIRENE_API_TOKEN absent de l'environnement "
                  "(clé du portail api.insee.fr)")
        return
    if not token:
        raise SystemExit("Définir SIRENE_API_TOKEN (clé du portail "
                         "api.insee.fr) — jamais de clé dans le code.")
    payload = helpers.http_json(url, headers=headers)
    for etab in payload.get("etablissements", []):
        adresse = etab.get("adresseEtablissement", {})
        print(etab.get("siret"),
              etab.get("uniteLegale", {}).get("denominationUniteLegale", ""),
              adresse.get("libelleCommuneEtablissement", ""))


def cmd_geo(args) -> None:
    resource = latest_resource(DATASET_GEO, "geolocalisation")
    print(f"ressource la plus récente : {resource['title']}")
    dest = helpers.RAW_DIR / Path(resource["url"]).name
    helpers.download(resource["url"], dest, dry_run=args.dry_run)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="commande", required=True)

    p_stock = sub.add_parser("stock", help="fichiers stock mensuels")
    p_stock.add_argument("--fichier", default="StockEtablissement",
                         choices=["StockEtablissement", "StockUniteLegale"])
    p_stock.add_argument("--format", default="auto",
                         choices=["auto", "parquet", "csv"],
                         help="parquet disponible depuis 2026 sur data.gouv")
    p_stock.add_argument("--dry-run", action="store_true")
    p_stock.set_defaults(func=cmd_stock)

    p_api = sub.add_parser("api", help="requête ciblée API Sirene 3.11")
    p_api.add_argument("--siren", required=True)
    p_api.add_argument("--nombre", type=int, default=20,
                       help="pagination : nombre de résultats par appel")
    p_api.add_argument("--dry-run", action="store_true")
    p_api.set_defaults(func=cmd_api)

    p_geo = sub.add_parser("geo", help="géolocalisation des établissements")
    p_geo.add_argument("--dry-run", action="store_true")
    p_geo.set_defaults(func=cmd_geo)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
