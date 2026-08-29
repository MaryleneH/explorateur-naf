# scripts/quality — contrôle des sources

Chaîne complète, de la déclaration d'une source à son affichage sur le site :

```text
data/etudes/sources.csv          identité, grain, fréquence, accès, limites,
                                 mode_controle, criticite, controle…
        ↓
scripts/quality/check_sources.py
        ↓                        HEAD puis GET partiel (2 Ko ; 30 Ko max pour
        ↓                        un contrôle de mot-clé) — aucune donnée
        ↓                        téléchargée
        ├── artifacts/source-link-report.{csv,md}   rapport détaillé par URL
        │                                           (artifact GitHub Actions,
        │                                           non versionné)
        └── data/quality/source_status.json         état agrégé PAR SOURCE,
                                                    versionné, consommé par
                                                    la page Bonus
        ↓
bonus/sources.qmd + assets/js/naf-sources.js
                                 assemblent manifeste + snapshot
```

## Statuts par source

| Statut | Sens |
|---|---|
| `AVAILABLE` | le point d'entrée répond normalement |
| `WARNING` | réponse inhabituelle, probablement temporaire (429, 5xx, anti-bot, mot attendu absent) |
| `ACCESS_SPECIFIC` | compte, clé ou droits statistiques requis — une caractéristique, pas une panne (Sirus, INPI, API Sirene, RNE) |
| `UNAVAILABLE` | lien réellement cassé (404/410, domaine disparu) |
| `MANUAL` | source déclarée non contrôlable automatiquement (`controle=manual`) |

Priorité d'agrégation : `MANUAL` (déclaré) > `UNAVAILABLE` >
`ACCESS_SPECIFIC` (si `auth_requise=oui`) > `WARNING` > `AVAILABLE`.

## Niveaux de contrôle (`controle` dans le manifeste)

- `http` — accessibilité simple ;
- `http_keyword` — accessibilité + présence d'un mot attendu
  (`mot_attendu`) dans le début de la page, pour détecter une page qui
  répond mais n'est plus la bonne ;
- `manual` — non contrôlable automatiquement.

## Zéro churn Git

`source_status.json` n'est réécrit **que si un statut change** : tant que
tout est stable, `generated_at` reste la date du dernier changement d'état
(« état stable depuis… » sur la page). Le workflow
`.github/workflows/check-sources.yml` (hebdomadaire + manuel + sur
modification du manifeste/scripts/tests) commite le snapshot uniquement
lors des passages planifiés ou manuels, jamais sur un run déclenché par un
push. Le workflow Pages reste totalement indépendant : une source en panne
n'empêche jamais un déploiement.

## Lancer localement

```bash
python scripts/quality/check_sources.py
```

```bash
python -m unittest discover -s tests
```

Ce que le contrôle ne prouve pas : que le contenu est complet, que les
données sont récentes, que le schéma n'a pas changé, ni que la source
convient à une étude. C'est écrit sur la page, et ça doit le rester.
