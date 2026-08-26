# Explorateur NAF

[![Build & Deploy](https://github.com/MaryleneH/explorateur-naf/actions/workflows/pages.yml/badge.svg)](https://github.com/MaryleneH/explorateur-naf/actions/workflows/pages.yml)
[![Quarto](https://img.shields.io/badge/Quarto-website-blue?logo=quarto)](https://quarto.org)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-live-brightgreen)](https://maryleneh.github.io/explorateur-naf/)

---

## 🌐 Application en ligne

**[Ouvrir l'Explorateur NAF →](https://maryleneh.github.io/explorateur-naf/)**

> <https://maryleneh.github.io/explorateur-naf/>

---


Architecture V1 d'un site **Quarto Website** pour :

- explorer la hiérarchie NAF (2025 / 2008),
- préparer la comparaison 2008 ↔ 2025,
- structurer une lecture analytique « NAF & Défense ».

## Structure

- `_quarto.yml` : configuration du site et navigation.
- `index.qmd` : accueil court avec trois portes d'entrée.
- `explorer/index.qmd` : composant principal d'exploration hiérarchique.
- `comparer/`, `defense/`, `comprendre/`, `methode/` : pages métier structurantes.
- `assets/css/theme.scss` : design system (couleurs, layout, états interactifs).
- `assets/js/naf-core.js` : chargement des CSV, arbre hiérarchique, index de recherche.
- `assets/js/naf-explorer.js` : navigation en colonnes (desktop) et drill-down (mobile).
- `assets/js/naf-home.js`, `naf-comparer.js`, `naf-defense.js` : recherche de l'accueil,
  table de correspondance, qualifications Défense.
- `data/*.csv` : données de référence issues de sources officielles Insee.
- `scripts/` : génération et validation des données de référence.

## Lancer le site

```bash
quarto render
```

Puis ouvrir `_site/index.html`.

## Données

Les fichiers `data/` contiennent les nomenclatures complètes.

| Fichier | Contenu |
|---|---|
| `naf2025.csv` | 22 sections, 87 divisions, 287 groupes, 651 classes, 747 sous-classes |
| `naf2008.csv` | 21 sections, 88 divisions, 272 groupes, 615 classes, 732 sous-classes |
| `correspondances_2008_2025.csv` | 742 relations 2008 ↔ 2025 (couverture partielle) |
| `defense_qualification.csv` | 10 codes qualifiés au regard de la Défense |

Contrôle des comptages, des codes et des URL de sources :

```bash
python scripts/validate_reference_data.py
```
