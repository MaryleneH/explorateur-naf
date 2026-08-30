#!/usr/bin/env python3
"""
opendatasoft.py — client générique pour BOAMP, BODACC et DECP.

Les trois sources sont diffusées sur des portails Opendatasoft, avec la
même API Explore v2.1 : un seul client suffit. Raccourcis intégrés :

  boamp   → boamp-datadila.opendatasoft.com, dataset boamp
  bodacc  → bodacc-datadila.opendatasoft.com, dataset annonces-commerciales
  decp    → data.economie.gouv.fr, dataset decp-v3-marches-valides

Exemples :
    python scripts/toolbox/python/opendatasoft.py boamp \
        --where "dateparution >= date'2026-08-01' AND search('défense')" \
        --select "idweb,objet,dateparution" --limit 5 --dry-run

    python scripts/toolbox/python/opendatasoft.py bodacc \
        --where "registre IN ('552100554')" --limit 5

    python scripts/toolbox/python/opendatasoft.py decp \
        --select "acheteur_nom,titulaire_id_1,montant" --limit 5

La pagination de l'API s'arrête à 10 000 lignes : au-delà, resserrer le
filtre where= (par date, par SIREN…) plutôt que d'aspirer le dataset.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).parent))
import helpers  # noqa: E402

PORTAILS = {
    "boamp": ("https://boamp-datadila.opendatasoft.com", "boamp"),
    "bodacc": ("https://bodacc-datadila.opendatasoft.com",
               "annonces-commerciales"),
    "decp": ("https://data.economie.gouv.fr", "decp-v3-marches-valides"),
}


def records_url(base: str, dataset: str, params: dict) -> str:
    return (f"{base}/api/explore/v2.1/catalog/datasets/{dataset}/records?"
            + urlencode({k: v for k, v in params.items() if v}))


def fetch_records(base: str, dataset: str, where: str | None,
                  select: str | None, limit: int) -> list[dict]:
    """Récupère jusqu'à `limit` enregistrements, page par page."""
    out: list[dict] = []
    page = min(limit, 100)
    offset = 0
    while len(out) < limit:
        url = records_url(base, dataset, {
            "where": where, "select": select,
            "limit": min(page, limit - len(out)), "offset": offset})
        payload = helpers.http_json(url)
        results = payload.get("results", [])
        out.extend(results)
        offset += page
        if len(results) < page or offset >= 9900:
            break
        time.sleep(0.3)  # temporisation : ne pas marteler le portail
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("portail", choices=sorted(PORTAILS),
                        help="raccourci de portail/dataset")
    parser.add_argument("--where", default=None,
                        help="clause ODSQL, ex: search('défense')")
    parser.add_argument("--select", default=None,
                        help="colonnes à projeter, séparées par des virgules")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    base, dataset = PORTAILS[args.portail]
    url = records_url(base, dataset, {
        "where": args.where, "select": args.select, "limit": args.limit})

    if args.dry_run:
        helpers.describe_request(
            f"interrogation {args.portail} ({dataset})", url,
            params={"where": args.where or "(aucun filtre)",
                    "select": args.select or "(toutes les colonnes)",
                    "limit": args.limit})
        return

    rows = fetch_records(base, dataset, args.where, args.select, args.limit)
    print(f"{len(rows)} enregistrement(s)")
    for row in rows:
        print("  " + " | ".join(f"{k}={v}" for k, v in list(row.items())[:6]))


if __name__ == "__main__":
    main()
