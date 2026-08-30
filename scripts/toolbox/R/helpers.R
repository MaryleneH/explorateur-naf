# helpers.R — socle des scripts de la boîte à outils (R).
#
# Mêmes principes que la version Python :
#   - dry-run d'abord : décrire l'opération sans télécharger ;
#   - les bruts vont dans data/raw/ (ignoré par git) ;
#   - les clés d'API viennent de Sys.getenv(), jamais du code.
#
# Dépendances : httr2 (requêtes), jsonlite. Pour les gros fichiers :
# duckdb ou arrow — jamais read.csv() sur des millions de lignes.

toolbox_root <- function() {
  # scripts/toolbox/R/ → racine du dépôt
  args <- commandArgs(trailingOnly = FALSE)
  script <- sub("--file=", "", grep("--file=", args, value = TRUE)[1])
  if (is.na(script)) return(normalizePath("."))
  normalizePath(file.path(dirname(script), "..", "..", ".."))
}

RAW_DIR <- file.path(toolbox_root(), "data", "raw")
USER_AGENT <- paste0("explorateur-naf-toolbox/1.0 ",
                     "(+https://maryleneh.github.io/explorateur-naf/)")

http_json <- function(url, headers = list()) {
  req <- httr2::request(url) |>
    httr2::req_user_agent(USER_AGENT) |>
    httr2::req_headers(!!!headers) |>
    httr2::req_timeout(60)
  httr2::req_perform(req) |> httr2::resp_body_json()
}

telecharger <- function(url, dest, dry_run = FALSE) {
  if (dry_run) {
    cat("[dry-run] téléchargement qui serait effectué :\n")
    cat("  URL         :", url, "\n")
    cat("  destination :", dest, "\n")
    cat("  opération   : GET complet, écriture sur disque\n")
    return(invisible(NULL))
  }
  dir.create(dirname(dest), recursive = TRUE, showWarnings = FALSE)
  cat("[fetch]", url, "\n")
  httr2::request(url) |>
    httr2::req_user_agent(USER_AGENT) |>
    httr2::req_timeout(600) |>
    httr2::req_perform(path = dest)
  cat("[écrit]", dest, sprintf("(%.1f Mo)\n", file.size(dest) / 1e6))
  invisible(dest)
}

decrire_requete <- function(titre, url, params = list()) {
  cat("[dry-run]", titre, "\n")
  cat("  URL      :", url, "\n")
  for (nom in names(params)) cat("  param    :", nom, "=", params[[nom]], "\n")
  cat("  opération: GET (aucun téléchargement en dry-run)\n")
}
