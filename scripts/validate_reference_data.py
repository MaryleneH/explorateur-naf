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
import re
import sys
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"

# La console Windows utilise cp1252 par défaut et ne sait pas afficher les
# caractères de cadre ni les accents du rapport.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

EXPECTED = {
    "NAF 2025": {
        "file": DATA_DIR / "naf2025.csv",
        "sections": 22,
        "divisions": 87,
        "groups": 287,
        "classes": 651,
        "subclasses": 747,
        "segment": "naf2025",
    },
    "NAF rév.2": {
        "file": DATA_DIR / "naf2008.csv",
        "sections": 21,
        "divisions": 88,
        "groups": 272,
        "classes": 615,
        "subclasses": 732,
        "segment": "nafr2",
    },
}

# Segment d'URL de l'autre nomenclature : une fiche NAF 2025 ne doit jamais
# pointer vers /nafr2/ et réciproquement.
OTHER_SEGMENT = {"naf2025": "nafr2", "nafr2": "naf2025"}

SUBCLASS_CODE_RE = re.compile(r"^\d{2}\.\d{2}[A-Z]$")

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

    # ── Format des codes de sous-classe ──────────────────────────────────
    malformed = [
        row.get("subclass_code") for row in rows
        if not SUBCLASS_CODE_RE.match(row.get("subclass_code", "").strip())
    ]
    if malformed:
        msg = f"Codes de sous-classe mal formés : {malformed[:5]}"
        print(f"  {ICON_FAIL} {msg}")
        errors.append(msg)
    else:
        print(f"  {ICON_OK} Codes de sous-classe au format NN.NNL")

    # ── URL des fiches Insee ─────────────────────────────────────────────
    validate_source_urls(name, spec["segment"], rows, code_field="subclass_code")

    return local_errors


def validate_source_urls(name: str, segment: str, rows: list, code_field: str) -> None:
    """Contrôle que chaque source_url pointe vers la bonne nomenclature Insee.

    Trois régressions sont possibles et toutes ont déjà été observées :
      - le segment de nomenclature de l'autre version (une fiche NAF 2025
        renvoyant vers /nafr2/ affiche une activité différente) ;
      - le code écrit avec un underscore (30_32Y), qui donne une 404 ;
      - le code de l'URL désynchronisé du code de la ligne.
    """
    expected_prefix = f"https://www.insee.fr/fr/metadonnees/{segment}/sousClasse/"
    wrong_nomenclature = []
    underscored = []
    mismatched = []

    for row in rows:
        url = row.get("source_url", "").strip()
        code = row.get(code_field, "").strip()
        if f"/{OTHER_SEGMENT[segment]}/" in url:
            wrong_nomenclature.append(f"{code} → {url}")
            continue
        if not url.startswith(expected_prefix):
            mismatched.append(f"{code} → {url}")
            continue
        tail = url[len(expected_prefix):]
        if "_" in tail:
            underscored.append(f"{code} → {url}")
        elif tail != code:
            mismatched.append(f"{code} → {url}")

    if wrong_nomenclature:
        msg = (
            f"{name} : {len(wrong_nomenclature)} URL pointent vers la mauvaise "
            f"nomenclature : {wrong_nomenclature[:3]}"
        )
        print(f"  {ICON_FAIL} {msg}")
        errors.append(msg)
    if underscored:
        msg = (
            f"{name} : {len(underscored)} URL utilisent un underscore au lieu "
            f"d'un point : {underscored[:3]}"
        )
        print(f"  {ICON_FAIL} {msg}")
        errors.append(msg)
    if mismatched:
        msg = (
            f"{name} : {len(mismatched)} URL ne correspondent pas au code de la "
            f"ligne : {mismatched[:3]}"
        )
        print(f"  {ICON_FAIL} {msg}")
        errors.append(msg)
    if not (wrong_nomenclature or underscored or mismatched):
        print(f"  {ICON_OK} {len(rows)} URL Insee cohérentes (/{segment}/sousClasse/)")


VALID_LEVELS = {
    "explicite_industriel", "dualite_demontree", "relation_intermediaire",
    "administration_defense", "piste_dualite",
}
# nature_dualite est multi-valuée (séparateur « ; ») : les catégories de
# preuve ne sont pas exclusives, et c'est assumé dans l'interface.
VALID_DUALITES = {
    "dual_naf_directe", "dual_naf_crossref", "technologie_dual_use",
    "ecosysteme_defense_observe", "projets_duaux_documentes",
    "dual_a_confirmer",
}
# Une dualité NAF démontrée exige une preuve de nomenclature : EDIS ou un
# règlement seuls ne suffisent jamais.
NAF_PROOFS = {
    "libelle_officiel", "note_officielle_insee",
    "nomenclature_produits_cpf", "structure_naf_2025",
    "table_correspondance_officielle",
}
VALID_PROOFS = NAF_PROOFS | {
    "enquete_ssm_refd", "reglement_ue_bdu", "dispositif_ministeriel",
}
VALID_CONFIDENCE = {"élevé", "moyen", "piste"}


def dualites_of(row) -> list:
    return [v for v in row.get("nature_dualite", "").split(";") if v]


def validate_defense_urls(nomenclature_rows: dict) -> None:
    """Contrôle le fichier de qualification Défense (URL + couche dualité)."""
    print(f"\n{'─' * 50}")
    print("Qualification Défense")
    print(f"{'─' * 50}")

    path = DATA_DIR / "defense_qualification.csv"
    if not path.exists():
        print(f"  {ICON_FAIL} Fichier introuvable : {path}")
        errors.append(f"Qualification Défense introuvable : {path}")
        return

    with path.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    print(f"  {ICON_OK} {len(rows)} code(s) qualifié(s)")

    by_version: dict = {}
    for row in rows:
        by_version.setdefault(row.get("naf_version", "").strip(), []).append(row)

    for version, version_rows in sorted(by_version.items()):
        spec = EXPECTED.get(version)
        if spec is None:
            msg = f"Version inconnue dans defense_qualification.csv : {version!r}"
            print(f"  {ICON_FAIL} {msg}")
            errors.append(msg)
            continue
        validate_source_urls(version, spec["segment"], version_rows, code_field="code")

        # Chaque code qualifié doit exister dans sa nomenclature.
        known = {r.get("subclass_code", "") for r in nomenclature_rows.get(version, [])}
        unknown = [r["code"] for r in version_rows if r.get("code") not in known]
        if unknown:
            msg = f"{version} : codes qualifiés absents de la nomenclature : {unknown[:5]}"
            print(f"  {ICON_FAIL} {msg}")
            errors.append(msg)
        else:
            print(f"  {ICON_OK} {version} : tous les codes qualifiés existent dans la nomenclature")

    # ── Couche dualité / relation Défense ─────────────────────────────────
    print(f"\n{'─' * 50}")
    print("Couche « relation Défense & dualité »")
    print(f"{'─' * 50}")

    def fail(msg):
        print(f"  {ICON_FAIL} {msg}")
        errors.append(msg)

    for row in rows:
        code = row.get("code", "?")
        level = row.get("niveau_defense", "")
        if level not in VALID_LEVELS:
            fail(f"{code} : niveau_defense invalide {level!r}")
        for d in dualites_of(row):
            if d not in VALID_DUALITES:
                fail(f"{code} : nature_dualite invalide {d!r}")
        if row.get("nature_preuve", "") not in VALID_PROOFS:
            fail(f"{code} : nature_preuve invalide {row.get('nature_preuve')!r}")
        if row.get("niveau_confiance", "") not in VALID_CONFIDENCE:
            fail(f"{code} : niveau_confiance invalide {row.get('niveau_confiance')!r}")
        if not row.get("justification", "").strip():
            fail(f"{code} : justification vide")
        if not row.get("source_url", "").strip():
            fail(f"{code} : source_url vide")

    demontrees = [r for r in rows if r.get("niveau_defense") == "dualite_demontree"]
    intermediaires = [r for r in rows if r.get("niveau_defense") == "relation_intermediaire"]
    pistes = [r for r in rows if r.get("niveau_defense") == "piste_dualite"]

    # §42 — une dualité NAF démontrée (directe ou crossref) exige une preuve
    # de nomenclature officielle ; EDIS/règlement seuls ne suffisent jamais.
    for row in rows:
        code = row.get("code", "?")
        dualites = set(dualites_of(row))
        if dualites & {"dual_naf_directe", "dual_naf_crossref"}:
            if row.get("nature_preuve") not in NAF_PROOFS:
                fail(f"{code} : dualité NAF démontrée sans preuve de nomenclature "
                     f"(nature_preuve={row.get('nature_preuve')!r})")
            if not row.get("source_repere", "").strip():
                fail(f"{code} : dualité NAF démontrée sans repère dans la source")
        # §43 — technologie_dual_use exige une base institutionnelle explicite.
        if "technologie_dual_use" in dualites:
            text = row.get("justification", "") + row.get("source_secondaire_reference", "")
            if "2021/821" not in text and "double usage" not in text:
                fail(f"{code} : technologie_dual_use sans référence au règlement "
                     "(UE) 2021/821 ou source institutionnelle équivalente")
        # §44 — ecosysteme_defense_observe exige EDIS/REFD ou équivalent.
        if "ecosysteme_defense_observe" in dualites:
            text = (row.get("justification", "") +
                    row.get("source_secondaire_reference", "") +
                    row.get("source_secondaire_url", ""))
            if "EDIS" not in text and "REFD" not in text:
                fail(f"{code} : ecosysteme_defense_observe sans source EDIS/REFD")

    for row in demontrees:
        code = row.get("code", "?")
        dualites = set(dualites_of(row))
        if not dualites & {"dual_naf_directe", "dual_naf_crossref"}:
            fail(f"{code} : dualite_demontree exige dual_naf_directe ou dual_naf_crossref")
        if row.get("niveau_confiance") == "piste":
            fail(f"{code} : dualité démontrée avec confiance « piste » — à déclasser")
        for field in ("usages_civils", "usages_defense"):
            if not row.get(field, "").strip():
                fail(f"{code} : dualité démontrée sans {field}")

    # §38/§41 — toute preuve intermédiaire porte une limite d'interprétation.
    for row in intermediaires:
        code = row.get("code", "?")
        dualites = set(dualites_of(row))
        if dualites & {"dual_naf_directe", "dual_naf_crossref"}:
            fail(f"{code} : relation_intermediaire ne peut pas porter une dualité NAF démontrée")
        if not dualites:
            fail(f"{code} : relation_intermediaire sans nature_dualite")
        if not row.get("limite_interpretation", "").strip():
            fail(f"{code} : preuve intermédiaire sans limite_interpretation")
        for field in ("usages_civils", "usages_defense"):
            if not row.get(field, "").strip():
                fail(f"{code} : relation intermédiaire sans {field}")

    for row in pistes:
        code = row.get("code", "?")
        if dualites_of(row) != ["dual_a_confirmer"]:
            fail(f"{code} : piste_dualite doit porter nature_dualite=dual_a_confirmer")
        if row.get("niveau_confiance") != "piste":
            fail(f"{code} : piste_dualite doit porter niveau_confiance=piste")

    # Les catégories annoncées ne doivent jamais être vides.
    for version in EXPECTED:
        n_dem = sum(1 for r in demontrees if r.get("naf_version") == version)
        n_int = sum(1 for r in intermediaires if r.get("naf_version") == version)
        if n_dem == 0:
            fail(f"{version} : aucune dualité NAF démontrée — la catégorie serait vide")
        else:
            print(f"  {ICON_OK} {version} : {n_dem} dualité(s) NAF démontrée(s), "
                  f"{n_int} relation(s) intermédiaire(s)")

    by_nature: dict = {}
    for r in rows:
        if r.get("niveau_defense") == "piste_dualite":
            continue
        for d in dualites_of(r):
            by_nature[d] = by_nature.get(d, 0) + 1
    print(f"  {ICON_OK} Natures de dualité (non exclusives) : " + ", ".join(
        f"{k}={v}" for k, v in sorted(by_nature.items())))
    print(f"  {ICON_OK} {len(pistes)} piste(s) non validée(s), hors compteurs")


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
    validate_defense_urls(rows_all)

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
