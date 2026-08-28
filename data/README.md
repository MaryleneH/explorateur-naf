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
Chaque ligne cite sa preuve (libellé officiel ou scission NAF 2025) et sa
source Insee.
