# Étude 04 — Concentration des importations, familles de produits liées à la
# Défense. Version R du script Python homonyme.
#
# Garde-fous (voir la page Comprendre) :
#   - le commerce extérieur classe des PRODUITS (NC8/SH), pas des activités
#     (NAF) : jamais de passage direct NAF → importations ;
#   - la passerelle est data/etudes/mapping_produits_defense.csv, où chaque
#     famille porte sa justification et son niveau de confiance ;
#   - on décrit une concentration d'importations, on ne fabrique pas un
#     « indice de dépendance Défense ».
#
# Dépendances : install.packages(c("duckdb", "dplyr"))
# Usage :
#   Rscript scripts/etudes/04_dependances_commerciales.R \
#     data/cache/national_nc8_pays.csv NC8 PAYS VALEUR MOIS FLUX I
# (fichier téléchargé depuis https://www.douane.gouv.fr/la-douane/opendata ;
#  les noms de colonnes varient selon les millésimes, d'où les arguments.)

suppressPackageStartupMessages({
  library(duckdb)
  library(dplyr)
})

args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 7) {
  stop("Arguments : fichier col_produit col_pays col_valeur col_mois ",
       "col_flux valeur_import")
}
fichier <- args[[1]]
cols <- setNames(args[2:6],
                 c("produit", "pays", "valeur", "mois", "flux"))
val_import <- args[[7]]

racine <- normalizePath(file.path(dirname(sub("--file=", "",
  grep("--file=", commandArgs(), value = TRUE))), "..", ".."))
mapping <- read.csv(file.path(racine, "data", "etudes",
                              "mapping_produits_defense.csv"),
                    colClasses = "character", fileEncoding = "UTF-8")

con <- dbConnect(duckdb())
on.exit(dbDisconnect(con, shutdown = TRUE))
src <- gsub("\\\\", "/", fichier)

# 13 derniers mois réellement présents : on suit le dernier millésime
# disponible au lieu de coder une date en dur.
mois <- dbGetQuery(con, sprintf(
  "SELECT DISTINCT \"%s\" AS mois FROM read_csv('%s', header=true,
   all_varchar=true, sample_size=-1) ORDER BY 1 DESC LIMIT 13",
  cols["mois"], src))$mois
mois_sql <- paste(sprintf("'%s'", mois), collapse = ",")

resultats <- lapply(seq_len(nrow(mapping)), function(i) {
  entree <- mapping[i, ]
  flux <- dbGetQuery(con, sprintf("
    SELECT \"%s\" AS pays, SUM(TRY_CAST(\"%s\" AS DOUBLE)) AS valeur
    FROM read_csv('%s', header=true, all_varchar=true, sample_size=-1)
    WHERE \"%s\" = '%s' AND \"%s\" IN (%s)
      AND starts_with(\"%s\", '%s')
    GROUP BY 1 ORDER BY 2 DESC",
    cols["pays"], cols["valeur"], src, cols["flux"], val_import,
    cols["mois"], mois_sql, cols["produit"], entree$code))
  total <- sum(flux$valeur, na.rm = TRUE)
  if (total == 0) return(NULL)
  parts <- flux$valeur / total
  data.frame(
    famille = entree$famille,
    code_produit = entree$code,
    niveau_confiance = entree$niveau_confiance,
    mois_debut = tail(mois, 1), mois_fin = mois[[1]],
    valeur_importee = round(total),
    premier_pays = flux$pays[[1]],
    part_premier_pays_pct = round(100 * parts[[1]], 1),
    part_top3_pays_pct = round(100 * sum(head(parts, 3)), 1),
    hhi_pays = round(sum(parts^2), 3),
    nb_pays = nrow(flux))
})

sortie <- bind_rows(resultats)
if (nrow(sortie) == 0) {
  stop("Aucune famille agrégée : vérifier les colonnes passées en argument ",
       "(aucune sortie fictive n'est écrite).")
}
dest <- file.path(racine, "data", "etudes", "dependances_commerciales.csv")
write.csv(sortie, dest, row.names = FALSE, fileEncoding = "UTF-8")
cat("Écrit :", dest, "—", nrow(sortie), "familles ·",
    "fenêtre", tail(mois, 1), "→", mois[[1]], "\n")
