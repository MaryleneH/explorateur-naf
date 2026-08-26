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
- `assets/js/explorer-naf.js` : logique de navigation progressive (desktop) et drill-down (mobile).
- `data/*.csv` : schémas de données sans valeurs inventées.

## Lancer le site

```bash
quarto render
```

Puis ouvrir `_site/index.html`.

## Données

Les fichiers `data/` sont volontairement vides (en-têtes uniquement) tant que les sources officielles ne sont pas intégrées.
