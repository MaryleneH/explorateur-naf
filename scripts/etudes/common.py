#!/usr/bin/env python3
"""
common.py — socle partagé des scripts d'études.

Principes appliqués partout :
  - API > téléchargement officiel > scraping (le scraping est un dernier recours) ;
  - gros fichiers lus en colonnes projetées via DuckDB, jamais chargés
    entièrement en mémoire ;
  - tout téléchargement passe par un cache local (data/cache/, ignoré par git) ;
  - chaque exécution inscrit sa date de collecte dans le manifeste de
    provenance data/etudes/sources.csv ;
  - aucune sortie fictive : un script qui ne peut pas collecter s'arrête
    proprement et l'explique.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import logging
import sys
import time
import zipfile
from pathlib import Path
from urllib import error, parse, request, robotparser

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
ETUDES_DIR = DATA_DIR / "etudes"
CACHE_DIR = DATA_DIR / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

USER_AGENT = (
    "explorateur-naf-etudes/1.0 "
    "(+https://maryleneh.github.io/explorateur-naf/ ; usage statistique)"
)

# La console Windows est en cp1252 par défaut.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("etudes")


# ---------------------------------------------------------------------------
# HTTP : timeout, retries, cache
# ---------------------------------------------------------------------------

def http_get(url: str, timeout: int = 60, retries: int = 3,
             backoff: float = 2.0) -> bytes:
    """GET avec User-Agent explicite, timeout et retries exponentiels."""
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            req = request.Request(url, headers={"User-Agent": USER_AGENT})
            with request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except (error.URLError, error.HTTPError, TimeoutError) as exc:
            last_error = exc
            wait = backoff ** attempt
            log.warning("échec %s (%s), nouvel essai dans %.0fs", url, exc, wait)
            time.sleep(wait)
    raise RuntimeError(f"Téléchargement impossible après {retries} essais : "
                       f"{url} ({last_error})")


def download(url: str, cache_name: str, force: bool = False) -> Path:
    """Télécharge dans data/cache/ avec réutilisation du cache."""
    dest = CACHE_DIR / cache_name
    if dest.exists() and not force:
        log.info("[cache] %s (%.1f Mo)", cache_name,
                 dest.stat().st_size / 1e6)
        return dest
    log.info("[fetch] %s", url)
    data = http_get(url, timeout=600)
    dest.write_bytes(data)
    log.info("[écrit] %s (%.1f Mo)", cache_name, len(data) / 1e6)
    return dest


def unzip_single(zip_path: Path, member_suffix: str = ".csv") -> Path:
    """Extrait du zip le premier membre correspondant, avec cache."""
    with zipfile.ZipFile(zip_path) as zf:
        members = [m for m in zf.namelist() if m.endswith(member_suffix)]
        if not members:
            raise RuntimeError(f"Aucun {member_suffix} dans {zip_path.name}")
        member = members[0]
        dest = CACHE_DIR / member
        if not dest.exists():
            log.info("[unzip] %s → %s", zip_path.name, member)
            zf.extract(member, CACHE_DIR)
    return dest


# ---------------------------------------------------------------------------
# Scraping : uniquement en dernier recours, et respectueux
# ---------------------------------------------------------------------------

def robots_allows(url: str) -> bool:
    """Vérifie robots.txt avant tout accès non-API à une page HTML."""
    parts = parse.urlparse(url)
    robots_url = f"{parts.scheme}://{parts.netloc}/robots.txt"
    parser = robotparser.RobotFileParser()
    try:
        parser.parse(http_get(robots_url, timeout=15).decode(
            "utf-8", errors="replace").splitlines())
    except Exception:
        # robots.txt inaccessible : prudence, on s'abstient.
        return False
    return parser.can_fetch(USER_AGENT, url)


# ---------------------------------------------------------------------------
# API Opendatasoft (BODACC et BOAMP sont diffusés par la DILA sur ce socle)
# ---------------------------------------------------------------------------

def ods_records(base: str, dataset: str, params: dict,
                limit: int = 100) -> list[dict]:
    """Interroge l'API Explore v2.1 d'un portail Opendatasoft, page par page.

    `params` accepte notamment where=, select=, order_by=. La pagination
    s'arrête à 10 000 lignes (limite de l'API) : au-delà, resserrer le filtre.
    """
    import json

    out: list[dict] = []
    offset = 0
    while True:
        query = dict(params)
        query.update({"limit": limit, "offset": offset})
        url = (f"{base}/api/explore/v2.1/catalog/datasets/{dataset}/records?"
               + parse.urlencode(query))
        payload = json.loads(http_get(url, timeout=60))
        results = payload.get("results", [])
        out.extend(results)
        offset += limit
        if len(results) < limit or offset >= 9900:
            if offset >= 9900 and payload.get("total_count", 0) > len(out):
                log.warning("pagination arrêtée à %d lignes (limite API) ; "
                            "resserrer le filtre where=", len(out))
            break
        time.sleep(0.3)  # temporisation : ne pas marteler le portail
    return out


# ---------------------------------------------------------------------------
# DuckDB : lecture projetée des gros fichiers
# ---------------------------------------------------------------------------

def duckdb_connect():
    try:
        import duckdb
    except ImportError:
        raise SystemExit(
            "DuckDB est requis pour lire les gros fichiers sans les charger "
            "en mémoire : pip install duckdb")
    return duckdb.connect()


def csv_columns(path: Path) -> list[str]:
    """Lit uniquement la ligne d'en-tête d'un CSV (fichier potentiellement énorme)."""
    with path.open(encoding="utf-8", errors="replace") as f:
        return next(csv.reader(f))


def find_column(columns: list[str], *fragments: str) -> str | None:
    """Retrouve une colonne par fragments insensibles à la casse.

    Les noms exacts varient selon les millésimes (ex. la variable du futur
    code NAF 2025 est activitePrincipaleNAF25UniteLegale dans les stocks
    diffusés depuis le 16/12/2025) : on détecte plutôt que de supposer.
    """
    for col in columns:
        low = col.lower()
        if all(fragment.lower() in low for fragment in fragments):
            return col
    return None


# ---------------------------------------------------------------------------
# Fichiers stock Sirene
# ---------------------------------------------------------------------------

# URL historiques stables ; l'alimentation data.gouv est assurée directement
# par l'Insee depuis fin mai 2026. En cas de changement, passer --url.
SIRENE_STOCK_UL = "https://files.data.gouv.fr/insee-sirene/StockUniteLegale_utf8.zip"
SIRENE_STOCK_ETAB = "https://files.data.gouv.fr/insee-sirene/StockEtablissement_utf8.zip"


def sirene_stock_csv(kind: str, url: str | None = None,
                     force: bool = False) -> Path:
    """Télécharge et décompresse un fichier stock Sirene ('ul' ou 'etab')."""
    if kind == "ul":
        src = url or SIRENE_STOCK_UL
    elif kind == "etab":
        src = url or SIRENE_STOCK_ETAB
    else:
        raise ValueError(kind)
    zip_path = download(src, Path(parse.urlparse(src).path).name, force=force)
    return unzip_single(zip_path)


# ---------------------------------------------------------------------------
# Département → région (découpage en vigueur depuis 2016)
# ---------------------------------------------------------------------------

DEPT_REGION = {
    **dict.fromkeys(["01", "03", "07", "15", "26", "38", "42", "43", "63",
                     "69", "73", "74"], "Auvergne-Rhône-Alpes"),
    **dict.fromkeys(["21", "25", "39", "58", "70", "71", "89", "90"],
                    "Bourgogne-Franche-Comté"),
    **dict.fromkeys(["22", "29", "35", "56"], "Bretagne"),
    **dict.fromkeys(["18", "28", "36", "37", "41", "45"],
                    "Centre-Val de Loire"),
    **dict.fromkeys(["2A", "2B"], "Corse"),
    **dict.fromkeys(["08", "10", "51", "52", "54", "55", "57", "67", "68",
                     "88"], "Grand Est"),
    **dict.fromkeys(["02", "59", "60", "62", "80"], "Hauts-de-France"),
    **dict.fromkeys(["75", "77", "78", "91", "92", "93", "94", "95"],
                    "Île-de-France"),
    **dict.fromkeys(["14", "27", "50", "61", "76"], "Normandie"),
    **dict.fromkeys(["16", "17", "19", "23", "24", "33", "40", "47", "64",
                     "79", "86", "87"], "Nouvelle-Aquitaine"),
    **dict.fromkeys(["09", "11", "12", "30", "31", "32", "34", "46", "48",
                     "65", "66", "81", "82"], "Occitanie"),
    **dict.fromkeys(["44", "49", "53", "72", "85"], "Pays de la Loire"),
    **dict.fromkeys(["04", "05", "06", "13", "83", "84"],
                    "Provence-Alpes-Côte d'Azur"),
    **dict.fromkeys(["971"], "Guadeloupe"),
    **dict.fromkeys(["972"], "Martinique"),
    **dict.fromkeys(["973"], "Guyane"),
    **dict.fromkeys(["974"], "La Réunion"),
    **dict.fromkeys(["976"], "Mayotte"),
}


def dept_of_commune(code_commune: str) -> str:
    """Code département depuis un code commune Insee (gère 2A/2B et DOM)."""
    if not code_commune:
        return ""
    if code_commune[:2] in ("2A", "2B"):
        return code_commune[:2]
    if code_commune.startswith("97"):
        return code_commune[:3]
    return code_commune[:2]


# ---------------------------------------------------------------------------
# Manifeste de provenance
# ---------------------------------------------------------------------------

def update_manifest(source_id: str, date_reference_max: str | None = None):
    """Inscrit la date de collecte du jour (et la date de référence si connue)
    dans data/etudes/sources.csv. Distinction essentielle : la date de
    collecte est celle du téléchargement, la date de référence est celle que
    décrivent les données."""
    manifest = ETUDES_DIR / "sources.csv"
    with manifest.open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames
        rows = list(reader)
    touched = False
    for row in rows:
        if row["source_id"] == source_id:
            row["date_collecte"] = dt.date.today().isoformat()
            if date_reference_max:
                row["date_reference_max"] = date_reference_max
            touched = True
    if not touched:
        log.warning("source_id inconnu du manifeste : %s", source_id)
        return
    with manifest.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    log.info("[manifeste] %s : date_collecte mise à jour", source_id)


def write_output(name: str, fieldnames: list[str], rows: list[dict]):
    """Écrit une sortie agrégée dans data/etudes/ (petits CSV uniquement)."""
    dest = ETUDES_DIR / name
    with dest.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    log.info("[sortie] %s (%d lignes)", dest.relative_to(ROOT), len(rows))


def load_defense_codes(version: str) -> list[str]:
    """Codes qualifiés dans data/defense_qualification.csv pour une version
    ('NAF 2025' ou 'NAF rév.2'). Rappel : l'absence d'un code signifie
    non évalué, pas non-Défense."""
    codes = []
    with (DATA_DIR / "defense_qualification.csv").open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["naf_version"] == version:
                codes.append(row["code"])
    return sorted(set(codes))
