# scripts/etudes — boîte à outils des études

Programmes accompagnant la page [Comprendre](../../comprendre/index.qmd),
section « Étudier la Défense ». Chaque script met en œuvre un **protocole
d'étude documenté** : tant qu'il n'a pas été exécuté sur les données, l'étude
reste au statut *protocole proposé* et le site n'affiche aucun résultat.

## Principes communs (implémentés dans `common.py`)

- **API > téléchargement officiel > scraping.** Le scraping n'apparaît que
  là où aucune interface structurée n'existe (volet veille AID de l'étude 06),
  avec vérification de `robots.txt`, User-Agent explicite, temporisation et
  cache. Aucun contournement.
- **Gros fichiers.** Sirene, DECP ou Douanes ne sont jamais chargés en
  mémoire : DuckDB lit les CSV en ne projetant que les colonnes nécessaires.
- **Cache.** Tout téléchargement va dans `data/cache/` (ignoré par git).
- **Provenance.** Chaque exécution inscrit sa `date_collecte` dans le
  manifeste `data/etudes/sources.csv` ; la `date_reference_max` (période que
  décrivent les données) est renseignée quand elle est connue. Les deux dates
  ne doivent jamais être confondues.
- **Pas de sortie fictive.** Un script qui ne peut pas collecter s'arrête et
  l'explique, il n'écrit jamais de valeurs inventées.
- **Pipeline.** Collecte → contrôle → validation humaine → publication.
  Aucun script ne modifie directement le contenu éditorial du site.

## Les études

| # | Script | Question | Données | Sortie |
|---|---|---|---|---|
| 01 | `01_transition_naf2025.py` / `.R` | La NAF 2025 repère-t-elle mieux certaines activités de Défense que la NAF 2008 ? | Stocks Sirene (double codage APE / NAF25, diffusé du 16/12/2025 à début 01/2027) | `transition_naf2025_summary.csv`, `_regions.csv` |
| 02 | `02_pulse_economie_guerre.py` | Quels signaux publics mensuels de montée en cadence ? | BOAMP, BODACC, DECP, Sirene | `pulse_mensuel.csv` |
| 03 | `03_geographie_capacites.py` | Les capacités sont-elles territorialement concentrées ? | Sirene établissements (+ géolocalisation) | `geographie_capacites.csv` |
| 04 | `04_dependances_commerciales.py` / `.R` | De quels pays dépendent les importations de familles de produits liées à la Défense ? | Douanes (NC8 × pays) + `mapping_produits_defense.csv` | `dependances_commerciales.csv` |
| 05 | `05_resilience_fournisseurs.py` | Quels signaux publics de fragilité ou de consolidation dans un périmètre fournisseurs ? | BODACC (API), Sirene | `resilience_evenements.csv`, `_resume.csv` |
| 06 | `06_innovation_duale.py` | Où sont les signaux d'innovation dans les technologies duales ? | INPI (export), veille AID | `innovation_signaux.csv`, `veille_aid.csv` |

## Dépendances

```bash
pip install duckdb            # requis (études 01, 03, 04)
# R : install.packages(c("duckdb", "dplyr"))
```

Le reste utilise uniquement la bibliothèque standard Python.

## Lancer une étude

```bash
python scripts/etudes/01_transition_naf2025.py
```

```bash
python scripts/etudes/02_pulse_economie_guerre.py --mois 2026-07
```

```bash
Rscript scripts/etudes/01_transition_naf2025.R
```

Chaque script documente ses arguments (`--help`) et refuse de s'exécuter si
une hypothèse n'est plus vérifiée (par exemple : la variable NAF25 des stocks
Sirene, retirée début janvier 2027).

## Répartition Python / R

- **Python** : ingestion, API, gros fichiers, agrégation (DuckDB).
- **R** : reproduction des analyses (`01`, `04`) avec DuckDB + dplyr,
  point de départ pour cartes et restitutions.

Les sorties sont de petits CSV agrégés dans `data/etudes/`, consommables par
le site statique. Aucune microdonnée, aucun stock complet n'est versionné.
