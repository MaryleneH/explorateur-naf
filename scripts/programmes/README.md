# scripts/programmes — les chaînes complètes d'exploitation

Deux niveaux cohabitent dans le dépôt :

```text
scripts/toolbox/
= une fonction ou un geste ciblé
  (interroger une API, retrouver la bonne ressource, télécharger proprement)

scripts/programmes/
= une chaîne complète d'exploitation
  (du fichier brut jusqu'à une table statistique contrôlée)
```

Un programme de cette bibliothèque est structuré en sections explicites
(objectif, entrées, sorties, dépendances, paramètres, fonctions, programme
principal, contrôles, limites), sépare lecture / extraction / normalisation /
contrôles / export, consigne ses anomalies au lieu de supprimer des lignes
en silence, et produit un rapport de qualité versionnable.

## Programmes disponibles

| Programme | Objectif | Langages | Entrée | Sortie | Page pédagogique |
|---|---|---|---|---|---|
| `python/bodacc_json.py` · `R/bodacc_json.R` | Passer d'annonces BODACC JSON (semi-structurées, branches variables selon la famille d'avis) à deux tables au grain contrôlé — annonces + événements harmonisés — avec rapport de qualité | Python · R | JSON (`data/exemples/bodacc/raw/`) | `bodacc_annonces.csv`, `bodacc_evenements.csv`, `bodacc_controles.csv` | [Du JSON BODACC à une table statistique](../../comprendre/programmes/bodacc-json.qmd) |

## Exécution

```bash
python scripts/programmes/python/bodacc_json.py
Rscript scripts/programmes/R/bodacc_json.R
```

Aucun accès réseau : les programmes ne lisent que des fichiers locaux.
Les trois annonces d'exemple et leur traçabilité complète (id, URL d'API,
date de collecte, licence) sont documentées dans
`data/exemples/bodacc/provenance.csv`.

## Tests

```bash
python -m pytest tests/test_bodacc_examples.py tests/test_bodacc_programme.py
```
