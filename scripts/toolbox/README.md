# scripts/toolbox — la boîte à outils exécutable

Compagnons de la page [Boîte à outils](../../comprendre/boite-outils.qmd) :
des scripts courts qui montrent **comment accéder proprement aux sources**,
pas des pipelines d'étude (ceux-ci vivent dans `scripts/etudes/`).

## À quoi servent-ils ?

| Script | Rôle |
|---|---|
| `python/sirene.py` · `R/sirene.R` | Retrouver la **ressource stock la plus récente** via les métadonnées data.gouv (jamais de lien mensuel figé), interroger l'API Sirene 3.11, récupérer la géolocalisation. |
| `python/opendatasoft.py` · `R/opendatasoft.R` | Client générique de l'API Opendatasoft Explore v2.1, avec raccourcis BOAMP, BODACC et DECP. |
| `python/helpers.py` · `R/helpers.R` | Socle : User-Agent explicite, téléchargements vers `data/raw/`, affichage dry-run, clés d'API par variables d'environnement. |

## Que téléchargent-ils ?

**Rien par défaut d'important** : le mode `--dry-run` affiche l'URL, les
paramètres et la destination sans rien télécharger. Sans `--dry-run` :

- `sirene.py stock` / `geo` téléchargent un fichier stock (plusieurs
  centaines de Mo à quelques Go) dans `data/raw/` ;
- `sirene.py api` et `opendatasoft.py` font des requêtes de quelques Ko.

## Dépendances

```bash
pip install duckdb        # lecture des stocks en colonnes projetées
# R : install.packages(c("httr2", "duckdb"))
```

Les scripts Python d'accès n'utilisent que la bibliothèque standard.

## Dry-run

```bash
python scripts/toolbox/python/sirene.py stock --format parquet --dry-run
```

```bash
python scripts/toolbox/python/opendatasoft.py boamp --where "search('défense')" --limit 5 --dry-run
```

```bash
Rscript scripts/toolbox/R/sirene.R stock --dry-run
```

## Clés d'API

Jamais dans le code, le CSV, le QMD ou un workflow. Uniquement :

```bash
export SIRENE_API_TOKEN="..."   # clé du portail api.insee.fr
```

```r
Sys.getenv("SIRENE_API_TOKEN")
```

## Où vont les données ?

- Bruts téléchargés → `data/raw/` (ignoré par git) ;
- caches des études → `data/cache/` (ignoré par git) ;
- seuls de **petits agrégats** sont versionnés, dans `data/etudes/`.

Ne jamais versionner : stocks Sirene, dumps DECP/BODACC, fichiers Douanes,
exports INPI. Le `.gitignore` du dépôt les exclut déjà.
