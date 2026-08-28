# Données

## `naf2008.csv` / `naf2025.csv`

Nomenclatures complètes (sections → sous-classes), libellés officiels Insee.

- NAF rév.2 (2008) : 21 sections, 732 sous-classes.
- NAF 2025 : 22 sections, 747 sous-classes.

Source : Insee — <https://www.insee.fr/fr/information/8201411>

## `correspondances_2008_2025.csv`

**Table de correspondance officielle Insee** NAF rév.2 → NAF 2025
(« Correspondances_NAFrev2-NAF2025.xlsx », réédition de janvier 2026,
<https://www.insee.fr/fr/information/8181066>), intégrée le 2026-08-28.

- **1 223 relations** de sous-classes, couvrant la totalité des 732
  sous-classes 2008 et 746 des 747 sous-classes 2025 (46.89Y n'a pas
  d'antécédent listé dans la table).
- Chaque ligne porte le **type officiel** publié par l'Insee
  (`type_officiel` : `Unique` — tout le contenu de la sous-classe 2008
  passe dans la sous-classe 2025 — ou `Multiple`) et le **contenu commun**
  (`contenu_commun`) : la description officielle de ce qui passe d'un code
  à l'autre.
- La typologie du site (`type_correspondance` : 1→1, 1→n, n→1, n↔n) est
  **calculée** sur les cardinalités des codes dans la table ; les groupes de
  transformation (identique, scission, regroupement, recomposition) sont
  calculés par composantes connexes.
- Les compteurs affichés sur le site (relations, groupes, couverture) sont
  **calculés à partir de ce fichier**, jamais saisis à la main.

Colonnes : `code_2008, libelle_2008, code_2025, libelle_2025,
type_correspondance, type_officiel, contenu_commun, source_url,
source_reference`.

Reconstruction : `scripts/build_reference_data.py` lit le fichier local
`data/raw/Correspondances_NAFrev2-NAF2025.xlsx` (non versionné — le déposer
depuis la publication Insee) et régénère le CSV
(`--only-correspondances` pour ne reconstruire que cette table, à partir des
nomenclatures déjà présentes dans `data/`). À défaut du fichier officiel, le
script retombe sur une approximation par préfixe de classe, étiquetée comme
telle dans `source_reference` — ce mode dégradé n'est plus utilisé par le
site publié.

### Note historique

Jusqu'au 2026-08-28, le site utilisait cette approximation par préfixe de
classe (relations intra-classe uniquement, six paires mécaniques retirées à
la main le 2026-08-27 : `25.40Z→25.40Y`, `25.61Z→25.61Y`, `38.21Z→38.21Y`,
`38.22Z→38.22Y`, `38.31Z→38.31Y`, `38.32Z→38.32Y`). Elle est **entièrement
remplacée** par la table officielle : les relations inter-classes (650) et
inter-sections (299) — par exemple 30.30Z → 30.31Y/30.32Y — sont désormais
présentes, et certaines paires autrefois retirées réapparaissent
légitimement au sein d'éventails officiels (ex. 38.21Z → 38.21Y parmi
d'autres destinations).

## `defense_qualification.csv`

Qualification éditoriale (non officielle) du lien de sous-classes NAF avec la
sphère défense. Schéma et méthode documentés sur la page « NAF & Défense ».

Colonnes : `naf_version, code, niveau_defense, nature_dualite, famille,
justification, nature_preuve, usages_civils, usages_defense, source_url,
source_reference, source_repere, source_secondaire_url,
source_secondaire_reference, niveau_confiance, limite_interpretation,
commentaire`.

Deux dimensions distinctes :

- `niveau_defense` (statut) : `explicite_industriel`, `dualite_demontree`
  (dualité prouvée au niveau de la nomenclature), `relation_intermediaire`
  (dual-use / écosystème observé — jamais présentée comme dualité démontrée),
  `administration_defense`, ou `piste_dualite` (**non validée** : jamais
  affichée ni comptée).
- `nature_dualite` (typologie de preuve, **multi-valuée**, séparateur `;`,
  catégories non exclusives) : `dual_naf_directe` (fiche/notes/produits
  officiels couvrent civil ET militaire), `dual_naf_crossref` (renvois
  officiels entre structures ou nomenclatures), `technologie_dual_use`
  (règlement (UE) 2021/821 — ne qualifie jamais toute la sous-classe),
  `ecosysteme_defense_observe` (enquête EDIS/REFD — même limite),
  `projets_duaux_documentes` (ex. dispositif RAPID), `dual_a_confirmer`.

Règles contrôlées par `scripts/validate_reference_data.py` :

- une dualité NAF démontrée exige une preuve de nomenclature
  (`libelle_officiel`, `note_officielle_insee`, `nomenclature_produits_cpf`,
  `structure_naf_2025`) **et** un `source_repere` (la phrase à chercher dans
  la source) — EDIS ou le règlement européen seuls ne suffisent jamais ;
- toute preuve intermédiaire porte une `limite_interpretation` affichée
  (« ce qu'il ne faut pas en déduire ») ;
- les catégories annoncées ne sont jamais vides ; les pistes sont marquées et
  exclues des compteurs ;
- fournisseur n'est pas dual : observer des fournisseurs de la Défense dans
  un code ne suffit jamais à qualifier la sous-classe.
