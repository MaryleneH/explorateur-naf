#!/usr/bin/env python3
"""
check_sources.py — contrôle du manifeste de sources et de ses liens.

Lit data/etudes/sources.csv, valide sa structure, puis vérifie que chaque
point d'entrée déclaré (url, url_documentation, url_api, url_download)
répond. Le contrôle est LÉGER : HEAD d'abord, puis GET partiel si HEAD n'est
pas concluant. Aucune donnée n'est téléchargée.

Statuts :
  OK       le point d'entrée répond (y compris 401/403 sur une source
           déclarée `authentification` : le point d'entrée existe).
  WARNING  indisponibilité vraisemblablement temporaire : 429, 5xx après
           retries, timeout, protection anti-bot sur une source déclarée
           `anti_bot_possible` — ou lien mort d'une source `informative`.
  FAIL     lien réellement cassé : 404/410, DNS inexistant, URL invalide.

Code de sortie : 1 si le manifeste est invalide ou si au moins un FAIL
subsiste (les sources `informative` ne produisent jamais de FAIL).

Usage :
    python scripts/quality/check_sources.py
    python scripts/quality/check_sources.py --manifest chemin.csv --timeout 20

Sorties (non versionnées) :
    artifacts/source-link-report.csv
    artifacts/source-link-report.md
    $GITHUB_STEP_SUMMARY si défini (résumé GitHub Actions).
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = ROOT / "data" / "etudes" / "sources.csv"
ARTIFACTS = ROOT / "artifacts"

USER_AGENT = ("explorateur-naf-checker/1.0 "
              "(+https://maryleneh.github.io/explorateur-naf/ ; "
              "controle de disponibilite des sources)")

REQUIRED_FIELDS = ["source_id", "nom", "producteur", "url"]
URL_FIELDS = ["url", "url_documentation", "url_api", "url_download"]
MODES = {"public", "authentification", "anti_bot_possible", ""}
CRITICITES = {"critical", "standard", "informative", ""}
AUTH = {"oui", "non", ""}

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


# ---------------------------------------------------------------------------
# Validation du manifeste (logique pure, testée unitairement)
# ---------------------------------------------------------------------------

def validate_manifest(rows: list[dict]) -> list[str]:
    """Retourne la liste des erreurs de structure du manifeste."""
    errors: list[str] = []
    seen: set[str] = set()
    for i, row in enumerate(rows, start=2):  # ligne 1 = en-tête
        sid = (row.get("source_id") or "").strip()
        for field in REQUIRED_FIELDS:
            if not (row.get(field) or "").strip():
                errors.append(f"ligne {i} : champ obligatoire vide « {field} »")
        if sid:
            if sid in seen:
                errors.append(f"ligne {i} : source_id dupliqué « {sid} »")
            seen.add(sid)
        if (row.get("mode_controle") or "").strip() not in MODES:
            errors.append(f"ligne {i} ({sid}) : mode_controle inconnu "
                          f"« {row.get('mode_controle')} »")
        if (row.get("criticite") or "").strip() not in CRITICITES:
            errors.append(f"ligne {i} ({sid}) : criticite invalide "
                          f"« {row.get('criticite')} »")
        if (row.get("auth_requise") or "").strip() not in AUTH:
            errors.append(f"ligne {i} ({sid}) : auth_requise invalide "
                          f"« {row.get('auth_requise')} »")
        for field in URL_FIELDS:
            value = (row.get(field) or "").strip()
            if value and not valid_url(value):
                errors.append(f"ligne {i} ({sid}) : URL invalide dans "
                              f"{field} : {value}")
    return errors


def valid_url(url: str) -> bool:
    parts = urlparse(url)
    return parts.scheme in ("http", "https") and bool(parts.netloc)


# ---------------------------------------------------------------------------
# Contrôle HTTP léger
# ---------------------------------------------------------------------------

def default_fetcher(url: str, method: str, timeout: int) -> tuple[int, str]:
    """Retourne (code HTTP, URL finale après redirections).

    HEAD, ou GET partiel (Range) qui ferme la connexion sans lire le corps :
    on vérifie l'existence du point d'entrée, on ne télécharge rien.
    """
    headers = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    if method == "GET":
        headers["Range"] = "bytes=0-2047"
    req = urllib.request.Request(url, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.geturl()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.geturl() or url


def probe(url: str, fetcher, timeout: int = 20,
          retries: int = 2) -> tuple[int | None, str, str]:
    """Sonde une URL : HEAD puis GET léger, avec retries sur 429/5xx/réseau.

    Retourne (code HTTP ou None, url finale, message d'erreur éventuel).
    """
    last_error = ""
    for attempt in range(retries + 1):
        status = None
        final = url
        # HEAD d'abord ; certains serveurs publics le refusent (405, 403,
        # 501) ou y répondent 5xx alors que GET fonctionne : un HEAD non
        # 2xx/3xx/404 n'est pas concluant, on tranche par un GET partiel.
        for method in ("HEAD", "GET"):
            try:
                status, final = fetcher(url, method, timeout)
                last_error = ""
            except Exception as exc:  # DNS, timeout, TLS…
                last_error = f"{type(exc).__name__}: {exc}"
                status = None
                continue
            if status is not None and not (status in (403, 405, 501)
                                           or status >= 500):
                break
        if status is not None and status not in (429,) and not (
                status >= 500):
            return status, final, last_error
        if attempt < retries:
            time.sleep(2 * (attempt + 1))
    return status, final, last_error


def classify(row: dict, status: int | None, error: str) -> tuple[str, str]:
    """Classe un résultat de sonde en (statut, message).

    Applique les règles : 2xx OK ; 404/410 FAIL ; 401/403 selon le
    mode_controle déclaré ; 429/5xx/réseau WARNING ; les sources
    `informative` ne produisent jamais de FAIL.
    """
    mode = (row.get("mode_controle") or "public").strip() or "public"
    criticite = (row.get("criticite") or "standard").strip() or "standard"

    if status is None:
        dns_like = ("getaddrinfo" in error or "Name or service" in error
                    or "nodename" in error or "11001" in error)
        if dns_like:
            verdict = ("FAIL", f"hôte introuvable ({error})")
        else:
            verdict = ("WARNING", f"réseau indisponible ({error})")
    elif 200 <= status < 300:
        verdict = ("OK", f"HTTP {status}")
    elif status in (404, 410):
        verdict = ("FAIL", f"HTTP {status} : cible supprimée ou déplacée")
    elif status in (401, 403):
        if mode == "authentification":
            verdict = ("OK", f"HTTP {status} : point d'entrée existant, "
                             "authentification requise (attendu)")
        elif mode == "anti_bot_possible":
            verdict = ("WARNING", f"HTTP {status} : protection anti-bot "
                                  "probable, à vérifier manuellement")
        else:
            verdict = ("WARNING", f"HTTP {status} inattendu sur une source "
                                  "publique")
    elif status == 429:
        verdict = ("WARNING", "HTTP 429 : limitation de débit, réessayer")
    elif status >= 500:
        verdict = ("WARNING", f"HTTP {status} après retries : panne "
                              "probablement temporaire")
    else:
        verdict = ("WARNING", f"HTTP {status} : comportement inattendu")

    if verdict[0] == "FAIL" and criticite == "informative":
        verdict = ("WARNING", verdict[1] + " (source informative : "
                   "n'échoue pas le contrôle)")
    return verdict


# ---------------------------------------------------------------------------
# Exécution et rapports
# ---------------------------------------------------------------------------

def run_checks(rows: list[dict], fetcher, timeout: int) -> list[dict]:
    results = []
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for row in rows:
        for field in URL_FIELDS:
            url = (row.get(field) or "").strip()
            if not url:
                continue
            if not valid_url(url):
                status_http, final, error = None, url, "URL invalide"
                verdict, message = "FAIL", "URL syntaxiquement invalide"
                elapsed = 0.0
            else:
                start = time.monotonic()
                status_http, final, error = probe(url, fetcher, timeout)
                elapsed = round(time.monotonic() - start, 2)
                verdict, message = classify(row, status_http, error)
            results.append({
                "source_id": row["source_id"],
                "champ": field,
                "url": url,
                "status": verdict,
                "http_status": status_http if status_http is not None else "",
                "final_url": final,
                "response_time": elapsed,
                "criticite": (row.get("criticite") or "standard").strip()
                             or "standard",
                "checked_at": now,
                "message": message,
            })
            icon = {"OK": "✓", "WARNING": "⚠", "FAIL": "✕"}[verdict]
            print(f"  {icon} [{verdict:7}] {row['source_id']:<20} {field:<18}"
                  f" {message}")
    return results


def write_reports(results: list[dict], errors: list[str]) -> None:
    ARTIFACTS.mkdir(exist_ok=True)
    fields = ["source_id", "champ", "url", "status", "http_status",
              "final_url", "response_time", "criticite", "checked_at",
              "message"]
    with (ARTIFACTS / "source-link-report.csv").open(
            "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(results)

    ok = sum(1 for r in results if r["status"] == "OK")
    warn = [r for r in results if r["status"] == "WARNING"]
    fail = [r for r in results if r["status"] == "FAIL"]

    lines = ["# Contrôle des sources", "",
             f"Sources contrôlées : {len(results)} liens", "",
             f"- ✓ {ok} disponibles",
             f"- ⚠ {len(warn)} avertissements",
             f"- ✕ {len(fail)} liens cassés", ""]
    if errors:
        lines += ["## Erreurs du manifeste", ""]
        lines += [f"- {e}" for e in errors] + [""]
    if fail or warn:
        lines += ["## Anomalies", "",
                  "| Source | Champ | Statut | HTTP | Message |",
                  "|---|---|---|---|---|"]
        for r in fail + warn:
            lines.append(f"| {r['source_id']} | {r['champ']} | {r['status']}"
                         f" | {r['http_status']} | {r['message']} |")
        lines.append("")
    report_md = "\n".join(lines)
    (ARTIFACTS / "source-link-report.md").write_text(report_md,
                                                    encoding="utf-8")

    summary_path = os.getenv("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as f:
            f.write(report_md + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", default=str(DEFAULT_MANIFEST))
    parser.add_argument("--timeout", type=int, default=20)
    args = parser.parse_args()

    with open(args.manifest, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    print(f"Manifeste : {args.manifest} ({len(rows)} sources)")
    errors = validate_manifest(rows)
    for error in errors:
        print(f"  ✕ [MANIFESTE] {error}")

    results = run_checks(rows, default_fetcher, args.timeout)
    write_reports(results, errors)

    fails = [r for r in results if r["status"] == "FAIL"]
    print(f"\n{len(results)} liens : "
          f"{sum(1 for r in results if r['status'] == 'OK')} OK, "
          f"{sum(1 for r in results if r['status'] == 'WARNING')} WARNING, "
          f"{len(fails)} FAIL")
    if errors or fails:
        critical_fails = [r for r in fails if r["criticite"] == "critical"]
        if critical_fails:
            print("Liens cassés sur des sources CRITIQUES :",
                  ", ".join(r["source_id"] for r in critical_fails))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
