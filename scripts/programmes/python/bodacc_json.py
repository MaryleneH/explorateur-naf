"""Du JSON BODACC à une table statistique.

OBJECTIF
    Lire des annonces BODACC au format JSON (API Opendatasoft de la DILA,
    dataset « annonces-commerciales »), comprendre leur structure
    semi-structurée, puis produire deux tables au grain contrôlé :
      - une table ANNONCES  (grain : une annonce, clé : id) ;
      - une table ÉVÉNEMENTS (grain : un événement harmonisé par annonce).

ENTRÉES
    Des fichiers *.json dans RAW_DIR — chacun contient UNE annonce telle
    que renvoyée par l'API (une entrée de `results`). Les branches
    imbriquées (listepersonnes, jugement, acte, radiationaurcs…) y sont
    des chaînes de caractères contenant elles-mêmes du JSON : c'est une
    réalité de la source, le programme les re-parse.

SORTIES (dans OUT_DIR)
    bodacc_annonces.csv    une ligne par annonce
    bodacc_evenements.csv  une ligne par événement harmonisé
    bodacc_controles.csv   le rapport de qualité (controle, valeur, statut)

DÉPENDANCES
    Python ≥ 3.9, pandas. Aucun accès réseau : le programme ne lit que
    des fichiers locaux.

LIMITES
    Le programme est écrit pour ne jamais planter sur une branche absente
    (toutes les familles d'avis ne remplissent pas les mêmes branches) :
    il conserve l'annonce, produit ce qui peut l'être et consigne une
    anomalie plutôt que de supprimer silencieusement une ligne.

Usage :
    python scripts/programmes/python/bodacc_json.py
    python scripts/programmes/python/bodacc_json.py --raw-dir … --out-dir …
"""

from __future__ import annotations

import argparse
import datetime
import json
import re
import sys
from pathlib import Path

import pandas as pd

# ── PARAMÈTRES ──────────────────────────────────────────────────────────

REPO = Path(__file__).resolve().parents[3]
RAW_DIR_DEFAUT = REPO / "data" / "exemples" / "bodacc" / "raw"
OUT_DIR_DEFAUT = REPO / "data" / "exemples" / "bodacc" / "processed"

# Familles d'avis observées dans le dataset (codes `familleavis`) et, pour
# celles que ce programme harmonise, la branche attendue de l'annonce.
# Une famille inconnue n'interrompt pas le traitement : elle est signalée.
FAMILLES_CONNUES = {
    "creation": "acte",
    "immatriculation": "acte",
    "collective": "jugement",
    "radiation": "radiationaurcs",
    "modification": "modificationsgenerales",
    "vente": "acte",
    "depot": "depot",
    "annonce": None,
    "rectificatif": None,
}

# Libellé harmonisé de l'événement produit pour chaque famille.
TYPE_EVENEMENT = {
    "creation": "création",
    "immatriculation": "immatriculation",
    "collective": "procédure collective",
    "radiation": "radiation",
    "modification": "modification",
    "vente": "vente ou cession",
    "depot": "dépôt des comptes",
}

# ── FONCTIONS ───────────────────────────────────────────────────────────


def lire_json(path: Path) -> dict:
    """Lit un fichier JSON en UTF-8 et retourne l'objet Python."""
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def parser_branche(annonce: dict, nom: str, warnings: list[str]):
    """Retourne la branche `nom` de l'annonce sous forme d'objet Python.

    Dans les enregistrements de l'API BODACC, ces branches sont des
    chaînes contenant du JSON (« JSON dans le JSON ») ; elles peuvent
    aussi être absentes ou null — ce qui n'est PAS une erreur : toutes
    les familles d'avis ne remplissent pas les mêmes branches.
    """
    brut = annonce.get(nom)
    if brut is None:
        return None
    if isinstance(brut, (dict, list)):
        return brut
    try:
        return json.loads(brut)
    except (TypeError, ValueError):
        warnings.append(
            f"{annonce.get('id', '?')} : branche {nom} illisible (JSON invalide)")
        return None


def normaliser_siren(valeur) -> str | None:
    """« 879 178 804 » → « 879178804 ». Toujours une chaîne, jamais un
    entier : un identifiant est un code, pas une quantité."""
    if valeur is None:
        return None
    chiffres = re.sub(r"\D", "", str(valeur))
    return chiffres if len(chiffres) == 9 else None


def extraire_siren(annonce: dict, warnings: list[str]) -> str | None:
    """Cherche le SIREN dans `registre`, puis dans la personne."""
    for candidat in annonce.get("registre") or []:
        siren = normaliser_siren(candidat)
        if siren:
            return siren
    personnes = parser_branche(annonce, "listepersonnes", warnings) or {}
    personne = personnes.get("personne") or {}
    if isinstance(personne, list):          # une annonce peut porter
        personne = personne[0] if personne else {}   # plusieurs personnes
    immat = personne.get("numeroImmatriculation") or {}
    siren = normaliser_siren(immat.get("numeroIdentification"))
    if siren is None:
        warnings.append(f"{annonce.get('id', '?')} : SIREN introuvable")
    return siren


def extraire_personne(annonce: dict, warnings: list[str]) -> dict:
    """Dénomination, forme juridique et adresse du siège.

    `listepersonnes.personne` peut être un objet OU une liste d'objets :
    ce programme retient la première personne pour la table annonces (le
    grain « personne × annonce » serait une autre table)."""
    personnes = parser_branche(annonce, "listepersonnes", warnings) or {}
    personne = personnes.get("personne")
    if isinstance(personne, list):
        if len(personne) > 1:
            warnings.append(
                f"{annonce.get('id', '?')} : {len(personne)} personnes — "
                "seule la première alimente la table annonces")
        personne = personne[0] if personne else {}
    personne = personne or {}
    adresse = personne.get("adresseSiegeSocial") or {}
    return {
        "denomination": personne.get("denomination"),
        "forme_juridique": personne.get("formeJuridique"),
        "code_postal": adresse.get("codePostal") or annonce.get("cp"),
        "ville": adresse.get("ville") or annonce.get("ville"),
    }


def extraire_evenement(annonce: dict, warnings: list[str]) -> dict:
    """Harmonise l'événement porté par l'annonce, quelle que soit la
    branche qui le décrit (acte, jugement, radiationaurcs…)."""
    famille = annonce.get("familleavis")
    evenement = {
        "id_annonce": annonce.get("id"),
        "type_evenement": TYPE_EVENEMENT.get(famille, famille),
        "date_evenement": None,
        "nature_evenement": None,
        "detail_evenement": None,
    }

    if famille not in FAMILLES_CONNUES:
        warnings.append(
            f"{annonce.get('id', '?')} : famille d'avis inconnue « {famille} »")
        return evenement

    nom_branche = FAMILLES_CONNUES[famille]
    branche = parser_branche(annonce, nom_branche, warnings) if nom_branche else None

    if famille in ("creation", "immatriculation", "vente"):
        acte = branche or {}
        creation = acte.get("creation") or {}
        evenement["date_evenement"] = (acte.get("dateCommencementActivite")
                                       or acte.get("dateImmatriculation"))
        evenement["nature_evenement"] = creation.get("categorieCreation")
    elif famille == "collective":
        jugement = branche or {}
        evenement["date_evenement"] = jugement.get("date")
        evenement["nature_evenement"] = jugement.get("nature")
        evenement["detail_evenement"] = jugement.get("famille")
    elif famille == "radiation":
        radiation = branche or {}
        evenement["date_evenement"] = (radiation.get("dateCessationActivitePM")
                                       or radiation.get("dateCessationActivitePP"))
        evenement["nature_evenement"] = "Radiation au RCS"
    else:
        evenement["nature_evenement"] = annonce.get("familleavis_lib")

    if nom_branche and branche is None:
        # Cas réel : un avis initial de radiation peut ne publier que
        # listepersonnes. On garde l'événement, daté par défaut à la
        # parution, et on le signale — jamais de suppression silencieuse.
        warnings.append(
            f"{annonce.get('id', '?')} : branche {nom_branche} absente — "
            "événement daté par la parution")
        evenement["date_evenement"] = annonce.get("dateparution")
        evenement["detail_evenement"] = (
            "détail non publié dans l'annonce (branche absente)")

    return evenement


def normaliser_annonce(annonce: dict, warnings: list[str]) -> dict:
    """Construit la ligne de la table ANNONCES (grain : une annonce)."""
    ligne = {
        "id_annonce": annonce.get("id"),
        "date_parution": annonce.get("dateparution"),
        "publication": annonce.get("publicationavis"),
        "famille_avis": annonce.get("familleavis_lib"),
        "type_avis": annonce.get("typeavis_lib"),
        "siren": extraire_siren(annonce, warnings),
        "tribunal": annonce.get("tribunal"),
        "departement": annonce.get("departement_nom_officiel"),
        "region": annonce.get("region_nom_officiel"),
        "url_annonce": annonce.get("url_complete"),
    }
    ligne.update(extraire_personne(annonce, warnings))
    return ligne


def date_valide(valeur) -> bool:
    try:
        datetime.date.fromisoformat(str(valeur))
        return True
    except (TypeError, ValueError):
        return False


def controler_annonces(annonces: pd.DataFrame, evenements: pd.DataFrame,
                       nb_fichiers: int, warnings: list[str]) -> pd.DataFrame:
    """Rapport de qualité : chaque contrôle, sa valeur, son statut."""
    def ok(condition):
        return "OK" if condition else "ATTENTION"

    ids = annonces["id_annonce"]
    sirens = annonces["siren"].dropna()
    controles = [
        ("fichiers_lus", nb_fichiers, ok(nb_fichiers > 0)),
        ("annonces_produites", len(annonces), ok(len(annonces) == nb_fichiers)),
        ("id_annonce_renseigne", int(ids.notna().sum()),
         ok(ids.notna().all())),
        ("id_annonce_unique", int(ids.nunique()),
         ok(ids.nunique() == len(annonces))),
        ("siren_9_chiffres", int(sirens.str.fullmatch(r"\d{9}").sum()),
         ok(sirens.str.fullmatch(r"\d{9}").all())),
        ("date_parution_valide",
         int(annonces["date_parution"].map(date_valide).sum()),
         ok(annonces["date_parution"].map(date_valide).all())),
        ("famille_avis_renseignee",
         int(annonces["famille_avis"].notna().sum()),
         ok(annonces["famille_avis"].notna().all())),
        ("evenements_produits", len(evenements), ok(len(evenements) > 0)),
        ("anomalies_signalees", len(warnings),
         "OK" if not warnings else "A_LIRE"),
    ]
    return pd.DataFrame(controles, columns=["controle", "valeur", "statut"])


# ── PROGRAMME PRINCIPAL ─────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--raw-dir", type=Path, default=RAW_DIR_DEFAUT,
                        help="dossier des annonces JSON (une par fichier)")
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR_DEFAUT,
                        help="dossier des CSV produits")
    args = parser.parse_args(argv)

    fichiers = sorted(args.raw_dir.glob("*.json"))
    if not fichiers:
        print(f"Aucun fichier JSON dans {args.raw_dir}", file=sys.stderr)
        return 1

    warnings: list[str] = []
    lignes_annonces, lignes_evenements = [], []
    for fichier in fichiers:
        annonce = lire_json(fichier)
        lignes_annonces.append(normaliser_annonce(annonce, warnings))
        lignes_evenements.append(extraire_evenement(annonce, warnings))

    annonces = pd.DataFrame(lignes_annonces)
    evenements = pd.DataFrame(lignes_evenements)
    evenements.insert(1, "siren",
                      evenements["id_annonce"].map(
                          annonces.set_index("id_annonce")["siren"]))
    controles = controler_annonces(annonces, evenements,
                                   len(fichiers), warnings)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    annonces.to_csv(args.out_dir / "bodacc_annonces.csv", index=False)
    evenements.to_csv(args.out_dir / "bodacc_evenements.csv", index=False)
    controles.to_csv(args.out_dir / "bodacc_controles.csv", index=False)

    print(f"{len(fichiers)} fichier(s) lu(s) → "
          f"{len(annonces)} annonce(s), {len(evenements)} événement(s)")
    print(controles.to_string(index=False))
    for w in warnings:
        print(f"  ! {w}")
    return 0 if (controles["statut"] != "ATTENTION").all() else 2


if __name__ == "__main__":
    raise SystemExit(main())
