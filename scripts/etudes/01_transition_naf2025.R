# Étude 01 — Ce que la NAF 2025 change pour mesurer l'industrie de Défense.
# Version R : reproduit l'analyse du script Python homonyme.
#
# Fenêtre unique : du 16/12/2025 à début janvier 2027, les stocks Sirene
# diffusent à la fois le code APE officiel (NAF rév.2) et le futur code
# NAF 2025 (variable activitePrincipaleNAF25Etablissement).
# Source : Insee, Sirene open data actualités (information/9019311).
#
# Le fichier stockEtablissement (plusieurs Go décompressé) n'est JAMAIS
# chargé en mémoire : DuckDB lit le CSV en ne projetant que 4 colonnes.
#
# Dépendances : install.packages(c("duckdb", "dplyr"))
# Usage      : Rscript scripts/etudes/01_transition_naf2025.R [chemin_csv]
#              (sans argument : cherche le stock décompressé dans data/cache/)

suppressPackageStartupMessages({
  library(duckdb)
  library(dplyr)
})

args <- commandArgs(trailingOnly = TRUE)
racine <- normalizePath(file.path(dirname(sub("--file=", "",
  grep("--file=", commandArgs(), value = TRUE))), "..", ".."))

csv_stock <- if (length(args) >= 1) args[[1]] else {
  candidats <- list.files(file.path(racine, "data", "cache"),
                          pattern = "StockEtablissement.*\\.csv$",
                          full.names = TRUE)
  if (length(candidats) == 0) {
    stop("Stock introuvable : lancer d'abord le script Python (qui télécharge ",
         "et met en cache), ou passer le chemin du CSV en argument.")
  }
  candidats[[1]]
}

codes_2008 <- c("30.30Z", "30.11Z", "30.40Z", "25.40Z", "33.15Z", "33.16Z")

con <- dbConnect(duckdb())
on.exit(dbDisconnect(con, shutdown = TRUE))

# Détection des colonnes : les noms varient selon les millésimes, et la
# variable NAF25 disparaît des stocks début janvier 2027.
entete <- names(read.csv(csv_stock, nrows = 1, check.names = FALSE))
col_ape   <- grep("activiteprincipale.*etablissement", tolower(entete))
col_ape   <- entete[setdiff(col_ape, grep("naf25", tolower(entete)))][1]
col_naf25 <- entete[grep("naf25.*etablissement", tolower(entete))][1]
col_etat  <- entete[grep("etatadministratif.*etablissement", tolower(entete))][1]
col_com   <- entete[grep("codecommune", tolower(entete))][1]
if (is.na(col_naf25)) {
  stop("Pas de variable NAF25 dans ce millésime (diffusée du 16/12/2025 à ",
       "début janvier 2027).")
}

requete <- sprintf("
  SELECT \"%s\" AS ape2008,
         COALESCE(NULLIF(\"%s\", ''), '(non renseigné)') AS ape2025,
         \"%s\" AS commune
  FROM read_csv('%s', header=true, all_varchar=true, sample_size=-1)
  WHERE \"%s\" = 'A' AND \"%s\" IN (%s)",
  col_ape, col_naf25, col_com,
  gsub("\\\\", "/", csv_stock), col_etat, col_ape,
  paste(sprintf("'%s'", codes_2008), collapse = ","))

flux <- dbGetQuery(con, requete)

transition <- flux |>
  count(ape2008, ape2025, name = "etablissements_actifs") |>
  group_by(ape2008) |>
  mutate(part_pct = round(100 * etablissements_actifs /
                            sum(etablissements_actifs), 2)) |>
  ungroup() |>
  arrange(ape2008, desc(etablissements_actifs))

sortie <- file.path(racine, "data", "etudes",
                    "transition_naf2025_summary.csv")
write.csv(transition, sortie, row.names = FALSE, fileEncoding = "UTF-8")
cat("Écrit :", sortie, "—", nrow(transition), "transitions distinctes\n")
cat("Rappel : chaque part est calculée sur les établissements actifs\n",
    "réellement observés dans ce millésime ; rien n'est estimé.\n")
