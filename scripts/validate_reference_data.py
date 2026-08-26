#!/usr/bin/env python3
"""
validate_reference_data.py
Contrôle qualité des données de référence NAF.

Compte attendu :
  NAF 2025 : 22 sections / 87 divisions / 287 groupes / 651 classes / 747 sous-classes
  NAF 2008 : 21 sections / 88 divisions / 272 groupes / 615 classes / 732 sous-classes

Quitte avec le code 1 si un contrôle obligatoire échoue.
"""

import csv
import sys
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"

EXPECTED = {
    "NAF 2025": {
        "file": DATA_DIR / "naf2025.csv",
        "sections": 22,
        "divisions": 87,
        "groups": 287,
        "classes": 651,
        "subclasses": 747,
    },
    "NAF rév.2": {
        "file": DATA_DIR / "naf2008.csv",
        "sections": 21,
        "divisions": 88,
        "groups": 272,
        "classes": 615,
        "subclasses": 732,
    },
}

ICON_OK = "✓"
ICON_FAIL = "✗"

errors = []


def check(label: str, expected, actual, critical: bool = True) -> bool:
    """Vérifie un comptage et affiche le résultat."""
    ok = actual == expected
    icon = ICON_OK if ok else ICON_FAIL
    print(f"  {icon} {label}: {actual}" + ("" if ok else f" (attendu: {expected})"))
    if not ok and critical:
        errors.append(f"{label}: attendu {expected}, obtenu {actual}")
    return ok


def validate_nomenclature(name: str, spec: dict) -> list:
    """Valide un fichier de nomenclature et retourne les erreurs."""
    local_errors = []
    path = spec["file"]
    print(f"\n{'─' * 50}")
    print(f"{name}")
    print(f"{'─' * 50}")

    if not path.exists():
        msg = f"Fichier introuvable : {path}"
        print(f"  {ICON_FAIL} {msg}")
        errors.append(msg)
        return [msg]

    with path.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    if not rows:
        msg = "Fichier vide"
        print(f"  {ICON_FAIL} {msg}")
        errors.append(msg)
        return [msg]

    # ── Comptages par niveau ──────────────────────────────────────────────
    sections = set()
    divisions = set()
    groups = set()
    classes = set()
    subclasses = set()

    for row in rows:
        sc = row.get("section_code", "").strip()
        div = row.get("division_code", "").strip()
        grp = row.get("group_code", "").strip()
        cls = row.get("class_code", "").strip()
        sub = row.get("subclass_code", "").strip()

        if sc:
            sections.add(sc)
        if div:
            divisions.add(div)
        if grp:
            groups.add(grp)
        if cls:
            classes.add(cls)
        if sub:
            subclasses.add(sub)

    check(f"{len(sections)} sections", spec["sections"], len(sections))
    check(f"{len(divisions)} divisions", spec["divisions"], len(divisions))
    check(f"{len(groups)} groupes", spec["groups"], len(groups))
    check(f"{len(classes)} classes", spec["classes"], len(classes))
    check(f"{len(subclasses)} sous-classes", spec["subclasses"], len(subclasses))

    # ── Doublons ─────────────────────────────────────────────────────────
    subclass_counts: dict = {}
    for row in rows:
        sub = row.get("subclass_code", "").strip()
        subclass_counts[sub] = subclass_counts.get(sub, 0) + 1
    duplicates = {k: v for k, v in subclass_counts.items() if v > 1}
    if duplicates:
        msg = f"Sous-classes dupliquées : {list(duplicates.keys())[:5]}"
        print(f"  {ICON_FAIL} {msg}")
        errors.append(msg)
    else:
        print(f"  {ICON_OK} Aucune sous-classe dupliquée")

    # ── Libellés vides ────────────────────────────────────────────────────
    empty_labels = [
        row.get("subclass_code") for row in rows
        if not row.get("subclass_label", "").strip()
    ]
    if empty_labels:
        msg = f"Libellés de sous-classe vides : {empty_labels[:5]}"
        print(f"  {ICON_FAIL} {msg}")
        errors.append(msg)
    else:
        print(f"  {ICON_OK} Aucun libellé de sous-classe vide")

    # ── Zéros initiaux préservés ──────────────────────────────────────────
    zero_lost = []
    for row in rows:
        div = row.get("division_code", "").strip()
        if div and not div.startswith("0") and len(div) < 2:
            zero_lost.append(div)
    if zero_lost:
        msg = f"Zéros initiaux perdus dans division_code : {zero_lost[:5]}"
        print(f"  {ICON_FAIL} {msg}")
        errors.append(msg)
    else:
        print(f"  {ICON_OK} Zéros initiaux préservés dans division_code")

    # ── Hiérarchie cohérente (chaque sous-classe a tout le chemin) ────────
    orphans = []
    for row in rows:
        if (not row.get("section_code", "").strip()
                or not row.get("division_code", "").strip()
                or not row.get("group_code", "").strip()
                or not row.get("class_code", "").strip()):
            orphans.append(row.get("subclass_code", "?"))
    if orphans:
        msg = (
            f"{len(orphans)} sous-classe(s) avec chemin hiérarchique "
            f"incomplet : {orphans[:5]}"
        )
        print(f"  {ICON_FAIL} {msg}")
        errors.append(msg)
    else:
        print(f"  {ICON_OK} Chemin hiérarchique complet pour toutes les sous-classes")

    return local_errors


def validate_correspondances(rows_2008: list, rows_2025: list) -> None:
    """Valide le fichier de correspondances."""
    print(f"\n{'─' * 50}")
    print("Correspondances")
    print(f"{'─' * 50}")

    path = DATA_DIR / "correspondances_2008_2025.csv"
    if not path.exists():
        print(f"  {ICON_FAIL} Fichier introuvable : {path}")
        errors.append(f"Correspondances introuvables : {path}")
        return

    with path.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    codes_2008 = {r.get("subclass_code", "") for r in rows_2008}
    codes_2025 = {r.get("subclass_code", "") for r in rows_2025}

    unknown_2008 = [
        r.get("code_2008") for r in rows
        if r.get("code_2008") and r.get("code_2008") not in codes_2008
    ]
    unknown_2025 = [
        r.get("code_2025") for r in rows
        if r.get("code_2025") and r.get("code_2025") not in codes_2025
    ]

    print(f"  {ICON_OK} {len(rows)} relations")

    if unknown_2008:
        print(
            f"  {ICON_FAIL} {len(unknown_2008)} code(s) 2008 inconnus : "
            f"{unknown_2008[:5]}"
        )
        errors.append(f"Codes 2008 inconnus dans correspondances : {unknown_2008[:5]}")
    else:
        print(f"  {ICON_OK} 0 code source inconnu")

    if unknown_2025:
        print(
            f"  {ICON_FAIL} {len(unknown_2025)} code(s) 2025 inconnus : "
            f"{unknown_2025[:5]}"
        )
        errors.append(
            f"Codes 2025 inconnus dans correspondances : {unknown_2025[:5]}"
        )
    else:
        print(f"  {ICON_OK} 0 code cible inconnu")


def main() -> None:
    print("Validation des données de référence — Explorateur NAF")
    print("=" * 55)

    rows_all = {}
    for name, spec in EXPECTED.items():
        validate_nomenclature(name, spec)
        # Recharger pour les correspondances
        path = spec["file"]
        if path.exists():
            with path.open(encoding="utf-8") as f:
                rows_all[name] = list(csv.DictReader(f))
        else:
            rows_all[name] = []

    validate_correspondances(rows_all.get("NAF rév.2", []), rows_all.get("NAF 2025", []))

    print(f"\n{'═' * 50}")
    if errors:
        print(f"{ICON_FAIL} {len(errors)} erreur(s) critique(s) :")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print(f"{ICON_OK} Tous les contrôles ont réussi.")


if __name__ == "__main__":
    main()
