# opendatasoft.R — client générique BOAMP / BODACC / DECP depuis R.
#
# Les trois sources partagent l'API Opendatasoft Explore v2.1 : un seul
# client httr2 suffit. La pagination de l'API s'arrête à 10 000 lignes :
# au-delà, resserrer le filtre where= plutôt que d'aspirer le dataset.
#
# Dépendances : httr2.
# Usage :
#   Rscript scripts/toolbox/R/opendatasoft.R boamp \
#     "dateparution >= date'2026-08-01' AND search('défense')" 5 --dry-run
#   Rscript scripts/toolbox/R/opendatasoft.R bodacc "registre IN ('552100554')" 5

source(file.path(dirname(sub("--file=", "",
  grep("--file=", commandArgs(), value = TRUE)[1])), "helpers.R"))

PORTAILS <- list(
  boamp  = c("https://boamp-datadila.opendatasoft.com", "boamp"),
  bodacc = c("https://bodacc-datadila.opendatasoft.com",
             "annonces-commerciales"),
  decp   = c("https://data.economie.gouv.fr", "decp-v3-marches-valides")
)

records <- function(portail, where = NULL, limit = 10, dry_run = FALSE) {
  conf <- PORTAILS[[portail]]
  if (is.null(conf)) stop("Portail inconnu : ", portail)
  url <- sprintf("%s/api/explore/v2.1/catalog/datasets/%s/records",
                 conf[[1]], conf[[2]])
  req <- httr2::request(url) |>
    httr2::req_user_agent(USER_AGENT) |>
    httr2::req_url_query(limit = limit) |>
    httr2::req_timeout(60)
  if (!is.null(where) && nzchar(where)) {
    req <- httr2::req_url_query(req, where = where)
  }
  if (dry_run) {
    decrire_requete(paste("interrogation", portail), req$url,
                    list(where = where %||% "(aucun filtre)", limit = limit))
    return(invisible(NULL))
  }
  httr2::req_perform(req) |> httr2::resp_body_json()
}

`%||%` <- function(x, y) if (is.null(x)) y else x

args <- commandArgs(trailingOnly = TRUE)
dry_run <- "--dry-run" %in% args
args <- setdiff(args, "--dry-run")
if (length(args) == 0) stop("Usage : <boamp|bodacc|decp> [where] [limit]")

resultat <- records(
  portail = args[[1]],
  where = if (length(args) >= 2) args[[2]] else NULL,
  limit = if (length(args) >= 3) as.integer(args[[3]]) else 10,
  dry_run = dry_run)

if (!is.null(resultat)) {
  cat(length(resultat$results), "enregistrement(s)\n")
  for (ligne in resultat$results) {
    apercu <- head(ligne, 5)
    cat(" ", paste(names(apercu), unlist(lapply(apercu, function(v)
      paste(format(v), collapse = "+"))), sep = "=", collapse = " | "), "\n")
  }
}
