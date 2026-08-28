#!/usr/bin/env python3
"""
helpers.py — socle des scripts de la boîte à outils (Python).

Trois principes, repris de la page Comprendre :
  - dry-run d'abord : chaque script sait décrire ce qu'il ferait (URL,
    paramètres, destination) sans rien télécharger ;
  - les bruts vont dans data/raw/ (ignoré par git), jamais dans le dépôt ;
  - les clés d'API viennent de variables d'environnement, jamais du code.
"""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
RAW_DIR = ROOT / "data" / "raw"

USER_AGENT = ("explorateur-naf-toolbox/1.0 "
              "(+https://maryleneh.github.io/explorateur-naf/)")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def http_json(url: str, headers: dict | None = None, timeout: int = 60):
    """GET JSON avec User-Agent explicite."""
    request_headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if headers:
        request_headers.update(headers)
    req = urllib.request.Request(url, headers=request_headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def download(url: str, dest: Path, dry_run: bool = False) -> Path | None:
    """Télécharge vers data/raw/ — ou décrit l'opération en mode dry-run."""
    if dry_run:
        print("[dry-run] téléchargement qui serait effectué :")
        print(f"  URL         : {url}")
        print(f"  destination : {dest}")
        print("  opération   : GET complet, écriture sur disque")
        return None
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"[fetch] {url}")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=600) as resp, \
            dest.open("wb") as f:
        while chunk := resp.read(1 << 20):
            f.write(chunk)
    print(f"[écrit] {dest} ({dest.stat().st_size / 1e6:.1f} Mo)")
    return dest


def describe_request(title: str, url: str, params: dict | None = None,
                     headers: dict | None = None) -> None:
    """Affichage standard du mode dry-run pour une requête d'API."""
    print(f"[dry-run] {title}")
    print(f"  URL      : {url}")
    if params:
        for key, value in params.items():
            print(f"  param    : {key} = {value}")
    if headers:
        for key in headers:
            # Ne jamais afficher la valeur d'une clé d'API.
            print(f"  en-tête  : {key} = ***")
    print("  opération: GET (aucun téléchargement en dry-run)")
