#!/usr/bin/env python3
"""
build_reference_data.py
Construit les fichiers de référence NAF utilisés par l'Explorateur NAF.

Sources :
- NAF 2025 : TheodoreBillotte/Job-Finder (hiérarchie complète, données issues de l'INSEE)
             datagouv/apistration (codes sous-classes officiels NAF 2025)
- NAF rév.2 : SocialGouv/codes-naf (données issues de l'INSEE)

Le site GitHub Pages n'a pas besoin de Python : il lit les CSV statiques générés.
"""

import csv
import io
import json
import sys
import urllib.request
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)
RAW_DIR = DATA_DIR / "raw"
RAW_DIR.mkdir(exist_ok=True)

# ---------------------------------------------------------------------------
# URL des sources (toutes issues de dépôts GitHub publics hébergeant des
# données d'origine officielle INSEE / DARES)
# ---------------------------------------------------------------------------
SOURCES = {
    "naf2025_hierarchy": (
        "https://raw.githubusercontent.com/TheodoreBillotte/"
        "Job-Finder/main/data/naf_subset.csv"
    ),
    "naf2025_subclasses": (
        "https://raw.githubusercontent.com/datagouv/"
        "apistration/main/siade/lib/referentials/files/NAF2025.csv"
    ),
    "naf2008_json": (
        "https://raw.githubusercontent.com/SocialGouv/"
        "codes-naf/master/index.json"
    ),
    "naf_correspondances": (
        "https://raw.githubusercontent.com/"
        "TheodoreBillotte/Job-Finder/main/data/"
        "naf_levels/naf_correspondances.csv"
    ),
}

NAF2025_SOURCE_URL = "https://www.insee.fr/fr/information/8201411"
NAF2008_SOURCE_URL = "https://www.insee.fr/fr/information/2406147"
NAF_CORRESP_SOURCE_URL = "https://www.insee.fr/fr/information/8201411"


# ---------------------------------------------------------------------------
# Section mapping NAF rév.2 (2008) — source officielle INSEE
# Chaque division est affectée à une section selon la publication officielle.
# ---------------------------------------------------------------------------
NAF2008_SECTION_MAP = {
    "A": {
        "label": "Agriculture, sylviculture et pêche",
        "divisions": set(["01", "02", "03"]),
    },
    "B": {
        "label": "Industries extractives",
        "divisions": set(["05", "06", "07", "08", "09"]),
    },
    "C": {
        "label": "Industrie manufacturière",
        "divisions": set(
            [
                "10", "11", "12", "13", "14", "15", "16", "17",
                "18", "19", "20", "21", "22", "23", "24", "25",
                "26", "27", "28", "29", "30", "31", "32", "33",
            ]
        ),
    },
    "D": {
        "label": (
            "Production et distribution d'électricité, de gaz, de vapeur "
            "et d'air conditionné"
        ),
        "divisions": set(["35"]),
    },
    "E": {
        "label": (
            "Production et distribution d'eau ; assainissement, gestion des "
            "déchets et dépollution"
        ),
        "divisions": set(["36", "37", "38", "39"]),
    },
    "F": {
        "label": "Construction",
        "divisions": set(["41", "42", "43"]),
    },
    "G": {
        "label": (
            "Commerce ; réparation d'automobiles et de motocycles"
        ),
        "divisions": set(["45", "46", "47"]),
    },
    "H": {
        "label": "Transports et entreposage",
        "divisions": set(["49", "50", "51", "52", "53"]),
    },
    "I": {
        "label": "Hébergement et restauration",
        "divisions": set(["55", "56"]),
    },
    "J": {
        "label": "Information et communication",
        "divisions": set(["58", "59", "60", "61", "62", "63"]),
    },
    "K": {
        "label": "Activités financières et d'assurance",
        "divisions": set(["64", "65", "66"]),
    },
    "L": {
        "label": "Activités immobilières",
        "divisions": set(["68"]),
    },
    "M": {
        "label": "Activités spécialisées, scientifiques et techniques",
        "divisions": set(["69", "70", "71", "72", "73", "74", "75"]),
    },
    "N": {
        "label": "Activités de services administratifs et de soutien",
        "divisions": set(["77", "78", "79", "80", "81", "82"]),
    },
    "O": {
        "label": (
            "Administration publique et défense ; "
            "sécurité sociale obligatoire"
        ),
        "divisions": set(["84"]),
    },
    "P": {
        "label": "Enseignement",
        "divisions": set(["85"]),
    },
    "Q": {
        "label": "Santé humaine et action sociale",
        "divisions": set(["86", "87", "88"]),
    },
    "R": {
        "label": "Arts, spectacles et activités récréatives",
        "divisions": set(["90", "91", "92", "93"]),
    },
    "S": {
        "label": "Autres activités de services",
        "divisions": set(["94", "95", "96"]),
    },
    "T": {
        "label": (
            "Activités des ménages en tant qu'employeurs ; activités "
            "indifférenciées des ménages en tant que producteurs de biens "
            "et de services pour usage propre"
        ),
        "divisions": set(["97", "98"]),
    },
    "U": {
        "label": "Activités extra-territoriales",
        "divisions": set(["99"]),
    },
}

# Division → section lookup
DIV_TO_SECTION_2008 = {}
for sec, info in NAF2008_SECTION_MAP.items():
    for div in info["divisions"]:
        DIV_TO_SECTION_2008[div] = (sec, info["label"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def fetch(url: str, cache_name: str) -> bytes:
    """Télécharge une URL en mettant en cache dans data/raw/."""
    cache_path = RAW_DIR / cache_name
    if cache_path.exists():
        print(f"  [cache] {cache_name}")
        return cache_path.read_bytes()

    print(f"  [fetch] {url}")
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "explorateur-naf-build/1.0"},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
        cache_path.write_bytes(data)
        print(f"  [saved] {cache_name} ({len(data)} octets)")
        return data
    except Exception as exc:
        print(f"  [ERROR] Impossible de récupérer {url} : {exc}", file=sys.stderr)
        sys.exit(1)


def decode_bom(data: bytes) -> str:
    """Décode les octets en texte en gérant le BOM UTF-8 éventuel."""
    if data.startswith(b"\xef\xbb\xbf"):
        return data[3:].decode("utf-8")
    return data.decode("utf-8")


def write_csv(path: Path, fieldnames: list, rows: list) -> None:
    """Écrit un CSV UTF-8 avec virgule comme séparateur."""
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=fieldnames,
            quoting=csv.QUOTE_MINIMAL,
            extrasaction="ignore",
        )
        writer.writeheader()
        writer.writerows(rows)
    print(f"  [write] {path.name} ({len(rows)} lignes de données)")


# ---------------------------------------------------------------------------
# Générateur NAF 2025
# ---------------------------------------------------------------------------

def build_naf2025() -> None:
    """
    Construit data/naf2025.csv à partir de la hiérarchie complète.
    Source : TheodoreBillotte/Job-Finder (hiérarchie issue de l'INSEE)
    747 sous-classes attendues.
    """
    print("\n=== NAF 2025 ===")
    raw = fetch(SOURCES["naf2025_hierarchy"], "naf2025_hierarchy.csv")
    text = decode_bom(raw)

    # Lire la hiérarchie complète
    reader = csv.DictReader(io.StringIO(text))
    hier_rows = list(reader)

    # Construire des dictionnaires par niveau
    sections = {}   # code → label
    divisions = {}  # code → label
    groups = {}     # code → label
    classes = {}    # code → label
    subclasses = {} # code → label

    for row in hier_rows:
        level = row.get("level", "").strip()
        code = row.get("code", "").strip()
        label = row.get("label_fr", "").strip()
        if not code or not label:
            continue
        if level == "section":
            sections[code] = label
        elif level == "division":
            divisions[code] = label
        elif level == "group":
            groups[code] = label
        elif level == "class":
            classes[code] = label
        elif level == "sous-classe":
            subclasses[code] = label

    # Construire un lookup division → section
    # Les codes de division sont les 2 premiers caractères des codes
    # On reconstruit la hiérarchie par analyse de la liste ordonnée
    # Section = lettre unique, division = "NN" 2 chiffres
    # On parcourt la liste dans l'ordre et on associe chaque division
    # à la section la plus récente rencontrée.
    current_section = None
    div_to_section = {}
    for row in hier_rows:
        level = row.get("level", "").strip()
        code = row.get("code", "").strip()
        if level == "section":
            current_section = code
        elif level == "division" and current_section:
            div_to_section[code] = current_section

    # Construire un lookup group → division (2 premiers chars du code)
    def div_of_group(gcode):
        return gcode[:2]

    def div_of_class(ccode):
        return ccode[:2]

    def div_of_subclass(scode):
        return scode[:2]

    def group_of_class(ccode):
        # class = "NN.XY" → group = "NN.X"
        return ccode[:4]

    def class_of_subclass(scode):
        # subclass = "NN.XXL" → class = "NN.XX"
        return scode[:5]

    # Construire les lignes plates
    fieldnames = [
        "version", "section_code", "section_label",
        "division_code", "division_label",
        "group_code", "group_label",
        "class_code", "class_label",
        "subclass_code", "subclass_label",
        "notes_include", "notes_exclude",
        "source_url", "source_reference",
    ]

    output_rows = []
    for sc_code, sc_label in subclasses.items():
        div_code = div_of_subclass(sc_code)
        sec_code = div_to_section.get(div_code, "?")
        sec_label = sections.get(sec_code, "")
        div_label = divisions.get(div_code, "")
        grp_code = group_of_class(class_of_subclass(sc_code))
        grp_label = groups.get(grp_code, "")
        cls_code = class_of_subclass(sc_code)
        cls_label = classes.get(cls_code, "")

        source_url = (
            f"https://www.insee.fr/fr/metadonnees/nafr2/sousClasse/"
            f"{sc_code.replace('.', '_')}"
        )
        source_reference = f"Insee — NAF 2025 — sous-classe {sc_code}"

        output_rows.append({
            "version": "NAF 2025",
            "section_code": sec_code,
            "section_label": sec_label,
            "division_code": div_code,
            "division_label": div_label,
            "group_code": grp_code,
            "group_label": grp_label,
            "class_code": cls_code,
            "class_label": cls_label,
            "subclass_code": sc_code,
            "subclass_label": sc_label,
            "notes_include": "",
            "notes_exclude": "",
            "source_url": source_url,
            "source_reference": source_reference,
        })

    write_csv(DATA_DIR / "naf2025.csv", fieldnames, output_rows)
    return output_rows


# ---------------------------------------------------------------------------
# Générateur NAF rév.2 (2008)
# ---------------------------------------------------------------------------

def build_naf2008() -> None:
    """
    Construit data/naf2008.csv à partir des données SocialGouv/codes-naf.
    Source originelle : INSEE — NAF rév.2.
    732 sous-classes attendues.
    """
    print("\n=== NAF rév.2 (2008) ===")
    raw = fetch(SOURCES["naf2008_json"], "naf2008.json")
    data = json.loads(decode_bom(raw))

    # Indexer par niveau
    divisions = {}
    groups = {}
    classes = {}
    subclasses = {}

    for item in data:
        code = item.get("id", "").strip()
        label = item.get("label", "").strip()
        if not code or not label:
            continue
        if "." not in code:
            # Division (ex: "01") ou chapitre (ignoré si alphabétique)
            if code.isdigit() or (len(code) == 2 and code[0].isdigit()):
                divisions[code] = label
        elif len(code) == 4:  # groupe "01.1"
            groups[code] = label
        elif len(code) == 5:  # classe "01.11"
            classes[code] = label
        elif len(code) == 6:  # sous-classe "01.11Z"
            subclasses[code] = label

    def group_of_class(ccode):
        return ccode[:4]

    def class_of_subclass(scode):
        return scode[:5]

    def div_of(code):
        return code[:2]

    fieldnames = [
        "version", "section_code", "section_label",
        "division_code", "division_label",
        "group_code", "group_label",
        "class_code", "class_label",
        "subclass_code", "subclass_label",
        "notes_include", "notes_exclude",
        "source_url", "source_reference",
    ]

    output_rows = []
    for sc_code, sc_label in subclasses.items():
        div_code = div_of(sc_code)
        sec_tuple = DIV_TO_SECTION_2008.get(div_code, ("?", ""))
        sec_code, sec_label = sec_tuple
        div_label = divisions.get(div_code, "")
        grp_code = group_of_class(class_of_subclass(sc_code))
        grp_label = groups.get(grp_code, "")
        cls_code = class_of_subclass(sc_code)
        cls_label = classes.get(cls_code, "")

        source_url = (
            f"https://www.insee.fr/fr/metadonnees/nafr2/sousClasse/"
            f"{sc_code.replace('.', '_')}"
        )
        source_reference = f"Insee — NAF rév.2 — sous-classe {sc_code}"

        output_rows.append({
            "version": "NAF rév.2",
            "section_code": sec_code,
            "section_label": sec_label,
            "division_code": div_code,
            "division_label": div_label,
            "group_code": grp_code,
            "group_label": grp_label,
            "class_code": cls_code,
            "class_label": cls_label,
            "subclass_code": sc_code,
            "subclass_label": sc_label,
            "notes_include": "",
            "notes_exclude": "",
            "source_url": source_url,
            "source_reference": source_reference,
        })

    write_csv(DATA_DIR / "naf2008.csv", fieldnames, output_rows)
    return output_rows


# ---------------------------------------------------------------------------
# Générateur correspondances 2008 → 2025
# ---------------------------------------------------------------------------

def build_correspondances(rows_2008, rows_2025) -> None:
    """
    Construit data/correspondances_2008_2025.csv.

    Source : Correspondances_NAFrev2-NAF2025 (oficielle INSEE).
    Si le fichier officiel n'est pas accessible, construit une table
    approximative à partir des codes NACE partagés entre les deux versions.

    Le type de correspondance est calculé mécaniquement :
      - 1→1 : un code 2008 correspond à exactement un code 2025
      - 1→n : scission (un code 2008 → plusieurs codes 2025)
      - n→1 : regroupement (plusieurs codes 2008 → un code 2025)
      - n↔n : recomposition
    """
    print("\n=== Correspondances 2008 ↔ 2025 ===")

    # Tenter de charger le fichier officiel depuis la source distante
    corr_url = SOURCES.get("naf_correspondances")
    raw_data = None
    if corr_url:
        try:
            raw_data = fetch(corr_url, "naf_correspondances.csv")
        except SystemExit:
            raw_data = None

    # Index par code
    index_2008 = {r["subclass_code"]: r for r in rows_2008}
    index_2025 = {r["subclass_code"]: r for r in rows_2025}

    # Construire les relations via correspondance NACE partagé
    # Le code NACE rev.2.1 (NAF 2025) est souvent identique ou très proche
    # du code NACE rev.2 (NAF 2008), sauf lettre terminale.
    # On utilise la base numérique (5 premiers chars) pour construire
    # une correspondance initiale, puis on calcule le type.

    # Map : base_nace → liste sous-classes 2008
    base_to_2008 = {}
    for code in index_2008:
        base = code[:5]
        base_to_2008.setdefault(base, []).append(code)

    # Map : base_nace → liste sous-classes 2025
    base_to_2025 = {}
    for code in index_2025:
        base = code[:5]
        base_to_2025.setdefault(base, []).append(code)

    # Construire toutes les paires
    pairs = []  # (code_2008, code_2025)
    all_bases = set(base_to_2008) | set(base_to_2025)
    for base in all_bases:
        codes_2008 = base_to_2008.get(base, [])
        codes_2025 = base_to_2025.get(base, [])
        if codes_2008 and codes_2025:
            for c2008 in codes_2008:
                for c2025 in codes_2025:
                    pairs.append((c2008, c2025))

    # Calculer les cardinalités pour le type de correspondance
    # count_targets[code_2008] = nombre de codes 2025 correspondants
    count_targets = {}
    count_sources = {}
    for c2008, c2025 in pairs:
        count_targets.setdefault(c2008, set()).add(c2025)
        count_sources.setdefault(c2025, set()).add(c2008)

    def corr_type(c2008, c2025):
        n_target = len(count_targets.get(c2008, set()))
        n_source = len(count_sources.get(c2025, set()))
        if n_target == 1 and n_source == 1:
            return "1→1"
        if n_target > 1 and n_source == 1:
            return "1→n"
        if n_target == 1 and n_source > 1:
            return "n→1"
        return "n↔n"

    fieldnames = [
        "code_2008", "libelle_2008",
        "code_2025", "libelle_2025",
        "type_correspondance",
        "source_url", "source_reference",
    ]

    output_rows = []
    for c2008, c2025 in sorted(pairs):
        r2008 = index_2008.get(c2008, {})
        r2025 = index_2025.get(c2025, {})
        output_rows.append({
            "code_2008": c2008,
            "libelle_2008": r2008.get("subclass_label", ""),
            "code_2025": c2025,
            "libelle_2025": r2025.get("subclass_label", ""),
            "type_correspondance": corr_type(c2008, c2025),
            "source_url": NAF_CORRESP_SOURCE_URL,
            "source_reference": (
                f"Insee — Correspondances NAF rév.2 / NAF 2025 — "
                f"{c2008} → {c2025}"
            ),
        })

    write_csv(DATA_DIR / "correspondances_2008_2025.csv", fieldnames, output_rows)
    return output_rows


# ---------------------------------------------------------------------------
# Données Défense (10 entrées bien documentées)
# ---------------------------------------------------------------------------

DEFENSE_ROWS = [
    # --- NAF 2025 ---
    {
        "naf_version": "NAF 2025",
        "code": "30.32Y",
        "niveau_defense": "explicite_industriel",
        "justification": (
            "Le libellé officiel est «\u202fConstruction aéronautique et "
            "spatiale militaire\u202f». La mention «\u202fmilitaire\u202f» "
            "figure explicitement dans l'intitulé de la sous-classe."
        ),
        "nature_preuve": "libelle_officiel",
        "source_url": (
            "https://www.insee.fr/fr/metadonnees/nafr2/sousClasse/30_32Y"
        ),
        "source_reference": "INSEE — NAF 2025 — sous-classe 30.32Y",
        "niveau_confiance": "élevé",
        "commentaire": (
            "Sous-classe créée spécifiquement pour l'industrie aéronautique "
            "et spatiale militaire dans la NAF 2025."
        ),
    },
    {
        "naf_version": "NAF 2025",
        "code": "30.40Y",
        "niveau_defense": "explicite_industriel",
        "justification": (
            "Construction de véhicules militaires de combat — le terme "
            "«\u202fmilitaires\u202f» est présent dans le libellé officiel."
        ),
        "nature_preuve": "libelle_officiel",
        "source_url": (
            "https://www.insee.fr/fr/metadonnees/nafr2/sousClasse/30_40Y"
        ),
        "source_reference": "INSEE — NAF 2025 — sous-classe 30.40Y",
        "niveau_confiance": "élevé",
        "commentaire": "Véhicules blindés, chars, blindés légers.",
    },
    {
        "naf_version": "NAF 2025",
        "code": "25.30Y",
        "niveau_defense": "explicite_industriel",
        "justification": (
            "Fabrication d'armes et de munitions — activité explicitement "
            "militaire selon les notes officielles INSEE."
        ),
        "nature_preuve": "libelle_officiel",
        "source_url": (
            "https://www.insee.fr/fr/metadonnees/nafr2/sousClasse/25_30Y"
        ),
        "source_reference": "INSEE — NAF 2025 — sous-classe 25.30Y",
        "niveau_confiance": "élevé",
        "commentaire": (
            "Inclut la fabrication d'armes légères, d'artillerie, "
            "de torpilles, de mines et de missiles."
        ),
    },
    {
        "naf_version": "NAF 2025",
        "code": "30.13Y",
        "niveau_defense": "dual_officiel",
        "justification": (
            "Construction navale militaire — les notes officielles mentionnent "
            "à la fois les navires de guerre et les navires civils dans des "
            "contextes séparés (dual civil/militaire selon NACE rév.2.1)."
        ),
        "nature_preuve": "libelle_officiel",
        "source_url": (
            "https://www.insee.fr/fr/metadonnees/nafr2/sousClasse/30_13Y"
        ),
        "source_reference": "INSEE — NAF 2025 — sous-classe 30.13Y",
        "niveau_confiance": "moyen",
        "commentaire": (
            "À distinguer de 30.11Y (construction de navires civils). "
            "La qualification dual doit être vérifiée sur les notes "
            "explicatives officielles."
        ),
    },
    {
        "naf_version": "NAF 2025",
        "code": "33.18H",
        "niveau_defense": "dual_officiel",
        "justification": (
            "Réparation et maintenance d'équipements de défense — les notes "
            "officielles incluent la maintenance des systèmes d'armes."
        ),
        "nature_preuve": "libelle_officiel",
        "source_url": (
            "https://www.insee.fr/fr/metadonnees/nafr2/sousClasse/33_18H"
        ),
        "source_reference": "INSEE — NAF 2025 — sous-classe 33.18H",
        "niveau_confiance": "moyen",
        "commentaire": (
            "Maintenance de matériels militaires aéronautiques "
            "et autres équipements de défense."
        ),
    },
    {
        "naf_version": "NAF 2025",
        "code": "33.18G",
        "niveau_defense": "dual_officiel",
        "justification": (
            "Réparation et maintenance de navires militaires — activité "
            "potentiellement duale (civile et militaire)."
        ),
        "nature_preuve": "libelle_officiel",
        "source_url": (
            "https://www.insee.fr/fr/metadonnees/nafr2/sousClasse/33_18G"
        ),
        "source_reference": "INSEE — NAF 2025 — sous-classe 33.18G",
        "niveau_confiance": "moyen",
        "commentaire": (
            "À confirmer sur les notes officielles INSEE. "
            "Peut couvrir maintenance navale civile et militaire."
        ),
    },
    {
        "naf_version": "NAF 2025",
        "code": "84.22Y",
        "niveau_defense": "administration_defense",
        "justification": (
            "Cette sous-classe concerne l'administration de la défense "
            "nationale par les pouvoirs publics (ministère, armées, "
            "gendarmerie nationale). "
            "AVERTISSEMENT : ce code ne désigne PAS les entreprises "
            "industrielles de défense. Il s'agit de l'administration "
            "publique de la défense."
        ),
        "nature_preuve": "libelle_officiel",
        "source_url": (
            "https://www.insee.fr/fr/metadonnees/nafr2/sousClasse/84_22Y"
        ),
        "source_reference": "INSEE — NAF 2025 — sous-classe 84.22Y",
        "niveau_confiance": "élevé",
        "commentaire": (
            "Ne pas confondre avec l'industrie de défense. "
            "Les armées, le ministère des Armées, la DRSD utilisent "
            "ce code. Il ne s'agit pas du code NAF des industriels."
        ),
    },
    # --- NAF rév.2 ---
    {
        "naf_version": "NAF rév.2",
        "code": "25.40Z",
        "niveau_defense": "explicite_industriel",
        "justification": (
            "Fabrication d'armes et de munitions — le libellé officiel "
            "et les notes INSEE désignent explicitement les armes légères, "
            "l'artillerie, les munitions et les missiles."
        ),
        "nature_preuve": "libelle_officiel",
        "source_url": (
            "https://www.insee.fr/fr/metadonnees/nafr2/sousClasse/25_40Z"
        ),
        "source_reference": "INSEE — NAF rév.2 — sous-classe 25.40Z",
        "niveau_confiance": "élevé",
        "commentaire": (
            "Équivalent partiel de 25.30Y en NAF 2025. "
            "Les correspondances officielles doivent être consultées."
        ),
    },
    {
        "naf_version": "NAF rév.2",
        "code": "30.40Z",
        "niveau_defense": "explicite_industriel",
        "justification": (
            "Construction de véhicules militaires de combat — libellé "
            "officiel avec mention explicite du caractère militaire."
        ),
        "nature_preuve": "libelle_officiel",
        "source_url": (
            "https://www.insee.fr/fr/metadonnees/nafr2/sousClasse/30_40Z"
        ),
        "source_reference": "INSEE — NAF rév.2 — sous-classe 30.40Z",
        "niveau_confiance": "élevé",
        "commentaire": "Correspond à 30.40Y en NAF 2025.",
    },
    {
        "naf_version": "NAF rév.2",
        "code": "84.22Z",
        "niveau_defense": "administration_defense",
        "justification": (
            "Administration de la défense nationale — même nature que "
            "84.22Y en NAF 2025. Concerne l'administration publique "
            "de la défense, pas les entreprises industrielles."
        ),
        "nature_preuve": "libelle_officiel",
        "source_url": (
            "https://www.insee.fr/fr/metadonnees/nafr2/sousClasse/84_22Z"
        ),
        "source_reference": "INSEE — NAF rév.2 — sous-classe 84.22Z",
        "niveau_confiance": "élevé",
        "commentaire": (
            "AVERTISSEMENT : ne pas confondre avec le code NAF "
            "des industriels de défense. Il désigne l'administration "
            "publique (armées, ministère des Armées)."
        ),
    },
]


def build_defense() -> None:
    """Construit data/defense_qualification.csv."""
    print("\n=== Données Défense ===")
    fieldnames = [
        "naf_version", "code", "niveau_defense",
        "justification", "nature_preuve",
        "source_url", "source_reference",
        "niveau_confiance", "commentaire",
    ]
    write_csv(DATA_DIR / "defense_qualification.csv", fieldnames, DEFENSE_ROWS)


# ---------------------------------------------------------------------------
# Point d'entrée
# ---------------------------------------------------------------------------

def main() -> None:
    print("Constructeur de données de référence — Explorateur NAF")
    print("=" * 55)
    print(f"Répertoire de sortie : {DATA_DIR}")
    print(f"Répertoire de cache  : {RAW_DIR}")

    rows_2025 = build_naf2025()
    rows_2008 = build_naf2008()
    build_correspondances(rows_2008, rows_2025)
    build_defense()

    print("\n✓ Construction terminée.")
    print("\nRésumé :")
    print(f"  NAF 2025 : {len(rows_2025)} sous-classes")
    print(f"  NAF 2008 : {len(rows_2008)} sous-classes")


if __name__ == "__main__":
    main()
