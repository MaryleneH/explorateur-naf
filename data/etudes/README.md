# data/etudes — référentiels et sorties des études

Ce répertoire contient les **petits fichiers de référence** des études
documentées dans la page [Comprendre](../../comprendre/index.qmd) et les
**sorties agrégées** produites par les scripts de `scripts/etudes/`.

## Fichiers de référence (versionnés)

| Fichier | Rôle |
|---|---|
| `sources.csv` | Manifeste de provenance : une ligne par source mobilisable (producteur, URL, fréquence, accès, unité statistique, limites). Les scripts y inscrivent `date_collecte` et `date_reference_max` quand ils s'exécutent. |
| `contexte_strategique.csv` | Jalons du contexte stratégique cités par le site, chacun **daté et sourcé**. Aucune actualisation automatique : toute modification est éditoriale. |
| `mapping_produits_defense.csv` | Passerelle documentée entre familles de produits (positions SH/NC8) et chaînes de valeur potentiellement pertinentes pour la Défense. Chaque ligne porte une justification et un niveau de confiance. |

## Sorties d'études (produites par les scripts)

Les scripts écrivent ici des **agrégats légers** (CSV de quelques Ko),
jamais de microdonnées. Exemples attendus :

- `transition_naf2025_summary.csv`, `transition_naf2025_regions.csv`
- `geographie_capacites.csv`
- `dependances_commerciales.csv`
- `resilience_evenements.csv`, `pulse_mensuel.csv`

Une sortie absente signifie que l'étude est au stade **protocole proposé** :
le script existe, il n'a pas encore été exécuté sur les données.
Le site n'affiche jamais de résultats fictifs.

## Ce qui ne doit jamais être versionné

Stocks Sirene complets, DECP massifs, dumps BODACC, fichiers Douanes
volumineux : ils vivent dans `data/cache/` (ignoré par git).
