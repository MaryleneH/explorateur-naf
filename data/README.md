# Données

## `naf2008.csv` / `naf2025.csv`

Nomenclatures complètes (sections → sous-classes), libellés officiels Insee.

- NAF rév.2 (2008) : 21 sections, 732 sous-classes.
- NAF 2025 : 22 sections, 747 sous-classes.

Source : Insee — <https://www.insee.fr/fr/information/8201411>

## `correspondances_2008_2025.csv`

⚠️ **Ce fichier n'est PAS la table officielle Insee.** C'est une
**approximation construite par le site** : un rapprochement par préfixe de
classe partagé (`xx.xx`) entre les deux nomenclatures, en attendant
l'intégration de la table officielle « Correspondances_NAFrev2-NAF2025.xlsx »
rééditée par l'Insee en janvier 2026
(<https://www.insee.fr/fr/information/8181066>). Chaque ligne porte cette
mention dans `source_reference`, et l'interface l'affiche.

`scripts/build_reference_data.py` cherche la table officielle (fichier local
`data/raw/Correspondances_NAFrev2-NAF2025.xlsx`, option `--correspondances`,
ou téléchargement direct depuis l'Insee) et ne retombe sur l'approximation
qu'à défaut, en l'étiquetant comme telle.

Colonnes : `code_2008, libelle_2008, code_2025, libelle_2025,
type_correspondance, source_url, source_reference`.

Limites connues, assumées et affichées dans l'interface :

- **Approximation, pas constat.** Ni une relation affichée, ni une absence ne
  doivent être lues comme des faits officiels ; la typologie (1→1, 1→n, n→1,
  n↔n) est calculée sur les cardinalités de cette approximation.
- **Relations intra-classe uniquement, par construction.** Les correspondances
  qui changent de classe — par exemple 30.30Z (construction aéronautique et
  spatiale) vers 30.31Y/30.32Y — n'y figurent pas.
- Les compteurs affichés sur le site (relations, groupes de transformation,
  couverture) sont **calculés à partir de ce fichier**, jamais saisis à la main.

### Lignes retirées (2026-08-27)

Six lignes `1→1` ont été retirées car leurs libellés 2008 et 2025 décrivaient
des activités sans aucun rapport : elles semblaient produites mécaniquement par
similarité de code, et sont contredites par les libellés officiels
(ex. 25.40Z « Fabrication d'armes et de munitions » était appariée à 25.40Y
« Forgeage… », alors que les libellés officiels NAF 2025 situent la fabrication
d'armes en 25.30Y) :

`25.40Z→25.40Y`, `25.61Z→25.61Y`, `38.21Z→38.21Y`, `38.22Z→38.22Y`,
`38.31Z→38.31Y`, `38.32Z→38.32Y`.

Les correspondances réelles de ces codes n'ont **pas** été reconstruites à la
main : on ne devine pas une table de correspondance, on la cite. Ces codes
apparaissent donc comme « non couverts par l'extrait » dans l'interface.

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
