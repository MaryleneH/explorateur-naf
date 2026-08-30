# sirene.R — accéder proprement au répertoire Sirene depuis R.
#
# Stratégie « stock » : on interroge les MÉTADONNÉES data.gouv du jeu
# Sirene pour retrouver la ressource la plus récente (CSV zippé ou
# Parquet) — aucun lien mensuel figé dans le code.
#
# Dépendances : httr2 (install.packages("httr2")).
# Usage :
#   Rscript scripts/toolbox/R/sirene.R stock --dry-run
#   Rscript scripts/toolbox/R/sirene.R stock StockUniteLegale parquet
#   Rscript scripts/toolbox/R/sirene.R api 552100554 --dry-run
#
# La clé de l'API Sirene 3.11 (requêtes ciblées) vient de la variable
# d'environnement SIRENE_API_TOKEN — jamais du code.

source(file.path(dirname(sub("--file=", "",
  grep("--file=", commandArgs(), value = TRUE)[1])), "helpers.R"))

DATASET <- paste0("https://www.data.gouv.fr/api/1/datasets/",
                  "base-sirene-des-entreprises-et-de-leurs-etablissements-",
                  "siren-siret/")
SIRENE_API <- "https://api.insee.fr/api-sirene/3.11"

derniere_ressource <- function(motif, format = NULL) {
  meta <- http_json(DATASET)
  ressources <- Filter(function(r) {
    # « StockEtablissement - » et non « StockEtablissement » : le jeu
    # contient aussi les fichiers LiensSuccession et Historique.
    ok <- grepl(paste0(motif, " -"), r$title %||% "", ignore.case = TRUE)
    if (!is.null(format)) ok <- ok && identical(tolower(r$format %||% ""),
                                                tolower(format))
    ok
  }, meta$resources)
  if (length(ressources) == 0) stop("Aucune ressource « ", motif, " » : ",
                                    "vérifier les métadonnées data.gouv.")
  dates <- vapply(ressources, function(r) r$last_modified %||% "", "")
  ressources[[order(dates, decreasing = TRUE)[1]]]
}

`%||%` <- function(x, y) if (is.null(x)) y else x

cmd_stock <- function(fichier, format, dry_run) {
  r <- derniere_ressource(fichier, format)
  cat("ressource la plus récente :", r$title, "\n")
  telecharger(r$url, file.path(RAW_DIR, basename(r$url)), dry_run = dry_run)
  if (dry_run) cat("\nEnsuite : lecture en colonnes projetées avec duckdb",
                   "ou arrow, jamais read.csv() complet.\n")
}

cmd_api <- function(siren, dry_run) {
  url <- sprintf("%s/siret?q=siren:%s&nombre=20", SIRENE_API, siren)
  if (dry_run) {
    decrire_requete(paste("établissements du SIREN", siren), url,
                    list(`en-tête` = "X-INSEE-Api-Key-Integration = ***"))
    return(invisible(NULL))
  }
  token <- Sys.getenv("SIRENE_API_TOKEN")
  if (!nzchar(token)) stop("Définir SIRENE_API_TOKEN (portail api.insee.fr).")
  reponse <- http_json(url, list(`X-INSEE-Api-Key-Integration` = token))
  for (etab in reponse$etablissements) {
    cat(etab$siret, "|",
        etab$adresseEtablissement$libelleCommuneEtablissement %||% "", "\n")
  }
}

args <- commandArgs(trailingOnly = TRUE)
dry_run <- "--dry-run" %in% args
args <- setdiff(args, "--dry-run")

if (length(args) == 0) stop("Commande attendue : stock | api")
if (args[[1]] == "stock") {
  cmd_stock(fichier = if (length(args) >= 2) args[[2]] else "StockEtablissement",
            format = if (length(args) >= 3) args[[3]] else NULL,
            dry_run = dry_run)
} else if (args[[1]] == "api") {
  if (length(args) < 2) stop("Usage : api <siren> [--dry-run]")
  cmd_api(args[[2]], dry_run)
} else {
  stop("Commande inconnue : ", args[[1]])
}
