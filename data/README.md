# Données

## `naf2008.csv` / `naf2025.csv`

Nomenclatures complètes (sections → sous-classes), libellés officiels Insee.

- NAF rév.2 (2008) : 21 sections, 732 sous-classes.
- NAF 2025 : 22 sections, 747 sous-classes.

Source : Insee — <https://www.insee.fr/fr/information/8201411>

## `correspondances_2008_2025.csv`

Extrait **partiel** de la table de correspondance NAF rév.2 → NAF 2025.
Une ligne = une relation entre une sous-classe 2008 et une sous-classe 2025.

Colonnes : `code_2008, libelle_2008, code_2025, libelle_2025,
type_correspondance, source_url, source_reference`.

Limites connues, assumées et affichées dans l'interface :

- **Couverture partielle.** Toutes les sous-classes n'y figurent pas ;
  une absence de ligne ne signifie pas une absence de correspondance.
  La table officielle complète fait foi :
  <https://www.insee.fr/fr/information/8201411>
- **Relations intra-classe uniquement.** Toutes les lignes relient des codes
  partageant le même préfixe de classe (`xx.xx`). Les correspondances qui
  changent de classe — par exemple 30.30Z (construction aéronautique et
  spatiale) vers 30.31Y/30.32Y — ne sont **pas** couvertes par cet extrait.
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
source_reference, source_secondaire_url, source_secondaire_reference,
niveau_confiance, commentaire`.

- `niveau_defense` : `explicite_industriel`, `dual_officiel`,
  `ecosysteme_observe`, `administration_defense`, ou `piste_dualite` pour les
  pistes de dualité **non validées** — jamais affichées comme duales ni
  comptées.
- `nature_dualite` (duales uniquement) : `dual_naf_explicite` (les notes ou la
  nomenclature de produits officielles Insee couvrent des usages civils et
  militaires), `dual_source_defense` (source institutionnelle, ex. dispositif
  RAPID DGA/AID), `dual_refd_observe` (secteur observé parmi les entreprises
  de défense par l'enquête EDIS du SSM, adossée au REFD, avec preuve
  complémentaire — règlement (UE) 2021/821), `dual_a_confirmer` (piste).
- Une duale validée doit porter justification, usages civils, usages Défense,
  source(s) et niveau de confiance `élevé` ou `moyen` — contrôlé par
  `scripts/validate_reference_data.py`, qui refuse aussi une catégorie duale
  vide.
- Fournisseur n'est pas dual : observer des fournisseurs de la Défense dans un
  code ne suffit jamais à qualifier la sous-classe.
