# Du JSON BODACC à une table statistique — version R.
#
# OBJECTIF
#   Lire des annonces BODACC au format JSON (API Opendatasoft de la DILA,
#   dataset « annonces-commerciales ») et produire deux tables au grain
#   contrôlé : ANNONCES (une ligne par annonce, clé : id) et ÉVÉNEMENTS
#   (un événement harmonisé par annonce), plus un rapport de qualité.
#
# ENTRÉES   des fichiers *.json dans raw_dir — une annonce par fichier,
#           telle que renvoyée par l'API (une entrée de `results`). Les
#           branches imbriquées (listepersonnes, jugement, acte,
#           radiationaurcs…) sont des chaînes contenant du JSON : le
#           programme les re-parse.
# SORTIES   bodacc_annonces.csv, bodacc_evenements.csv,
#           bodacc_controles.csv dans out_dir.
# DÉPENDANCES  jsonlite (lecture JSON). Tout le reste est du R de base.
#              Aucun accès réseau.
# LIMITES   écrit pour ne jamais planter sur une branche absente : toutes
#           les familles d'avis ne remplissent pas les mêmes branches ;
#           l'annonce est conservée et l'anomalie consignée.
#
# Usage :
#   Rscript scripts/programmes/R/bodacc_json.R
#   Rscript scripts/programmes/R/bodacc_json.R chemin/raw chemin/processed

library(jsonlite)

# ── PARAMÈTRES ──────────────────────────────────────────────────────────

args <- commandArgs(trailingOnly = TRUE)
raw_dir <- if (length(args) >= 1) args[[1]] else "data/exemples/bodacc/raw"
out_dir <- if (length(args) >= 2) args[[2]] else "data/exemples/bodacc/processed"

# Familles d'avis (codes `familleavis`) → branche attendue de l'annonce.
familles_connues <- list(
  creation = "acte", immatriculation = "acte", collective = "jugement",
  radiation = "radiationaurcs", modification = "modificationsgenerales",
  vente = "acte", depot = "depot", annonce = NA, rectificatif = NA
)

types_evenement <- c(
  creation = "création", immatriculation = "immatriculation",
  collective = "procédure collective", radiation = "radiation",
  modification = "modification", vente = "vente ou cession",
  depot = "dépôt des comptes"
)

warnings_log <- character()
signaler <- function(message) {
  warnings_log <<- c(warnings_log, message)
}

# ── FONCTIONS ───────────────────────────────────────────────────────────

# `simplifyVector = FALSE` : on regarde la structure telle qu'elle est
# (des listes nommées), avant toute simplification automatique.
lire_json <- function(path) {
  fromJSON(path, simplifyVector = FALSE)
}

# Valeur sûre : x$champ vaut NULL quand la branche est absente ;
# `%||%` fournit alors une valeur de repli.
`%||%` <- function(x, y) if (is.null(x)) y else x

# Les branches imbriquées sont du JSON encodé dans une chaîne.
# Absente ou null n'est PAS une erreur : toutes les familles d'avis ne
# remplissent pas les mêmes branches.
parser_branche <- function(annonce, nom) {
  brut <- annonce[[nom]]
  if (is.null(brut)) return(NULL)
  if (is.list(brut)) return(brut)
  tryCatch(fromJSON(brut, simplifyVector = FALSE),
           error = function(e) {
             signaler(sprintf("%s : branche %s illisible (JSON invalide)",
                              annonce$id %||% "?", nom))
             NULL
           })
}

# « 879 178 804 » → « 879178804 ». Toujours une chaîne, jamais un
# entier : un identifiant est un code, pas une quantité.
normaliser_siren <- function(valeur) {
  if (is.null(valeur)) return(NA_character_)
  chiffres <- gsub("\\D", "", as.character(valeur))
  if (nchar(chiffres) == 9) chiffres else NA_character_
}

premiere_personne <- function(annonce) {
  personnes <- parser_branche(annonce, "listepersonnes")
  personne <- personnes$personne %||% list()
  # `personne` peut être un objet OU une liste d'objets.
  if (length(personne) > 0 && is.null(names(personne))) {
    if (length(personne) > 1) {
      signaler(sprintf("%s : %d personnes — seule la première alimente la table annonces",
                       annonce$id %||% "?", length(personne)))
    }
    personne <- personne[[1]]
  }
  personne
}

extraire_siren <- function(annonce) {
  for (candidat in annonce$registre %||% list()) {
    siren <- normaliser_siren(candidat)
    if (!is.na(siren)) return(siren)
  }
  personne <- premiere_personne(annonce)
  siren <- normaliser_siren(personne$numeroImmatriculation$numeroIdentification)
  if (is.na(siren)) signaler(sprintf("%s : SIREN introuvable", annonce$id %||% "?"))
  siren
}

normaliser_annonce <- function(annonce) {
  personne <- premiere_personne(annonce)
  adresse <- personne$adresseSiegeSocial %||% list()
  data.frame(
    id_annonce = annonce$id %||% NA_character_,
    date_parution = annonce$dateparution %||% NA_character_,
    publication = annonce$publicationavis %||% NA_character_,
    famille_avis = annonce$familleavis_lib %||% NA_character_,
    type_avis = annonce$typeavis_lib %||% NA_character_,
    siren = extraire_siren(annonce),
    tribunal = annonce$tribunal %||% NA_character_,
    departement = annonce$departement_nom_officiel %||% NA_character_,
    region = annonce$region_nom_officiel %||% NA_character_,
    url_annonce = annonce$url_complete %||% NA_character_,
    denomination = personne$denomination %||% NA_character_,
    forme_juridique = personne$formeJuridique %||% NA_character_,
    code_postal = adresse$codePostal %||% annonce$cp %||% NA_character_,
    ville = adresse$ville %||% annonce$ville %||% NA_character_,
    stringsAsFactors = FALSE
  )
}

extraire_evenement <- function(annonce) {
  famille <- annonce$familleavis %||% NA_character_
  # Indexer un vecteur nommé par un nom inconnu renvoie NA (pas NULL) :
  # le repli sur le code de famille est donc explicite.
  type_ev <- if (!is.na(famille) && famille %in% names(types_evenement)) {
    unname(types_evenement[[famille]])
  } else famille
  ligne <- data.frame(
    id_annonce = annonce$id %||% NA_character_,
    type_evenement = type_ev,
    date_evenement = NA_character_,
    nature_evenement = NA_character_,
    detail_evenement = NA_character_,
    stringsAsFactors = FALSE
  )
  if (is.na(famille) || !famille %in% names(familles_connues)) {
    signaler(sprintf("%s : famille d'avis inconnue « %s »",
                     annonce$id %||% "?", famille))
    return(ligne)
  }
  nom_branche <- familles_connues[[famille]]
  branche <- if (!is.na(nom_branche)) parser_branche(annonce, nom_branche)

  if (famille %in% c("creation", "immatriculation", "vente")) {
    acte <- branche %||% list()
    ligne$date_evenement <- acte$dateCommencementActivite %||%
      acte$dateImmatriculation %||% NA_character_
    ligne$nature_evenement <- acte$creation$categorieCreation %||% NA_character_
  } else if (famille == "collective") {
    jugement <- branche %||% list()
    ligne$date_evenement <- jugement$date %||% NA_character_
    ligne$nature_evenement <- jugement$nature %||% NA_character_
    ligne$detail_evenement <- jugement$famille %||% NA_character_
  } else if (famille == "radiation") {
    radiation <- branche %||% list()
    ligne$date_evenement <- radiation$dateCessationActivitePM %||%
      radiation$dateCessationActivitePP %||% NA_character_
    ligne$nature_evenement <- "Radiation au RCS"
  } else {
    ligne$nature_evenement <- annonce$familleavis_lib %||% NA_character_
  }

  if (!is.na(nom_branche) && is.null(branche)) {
    # Cas réel : un avis initial de radiation peut ne publier que
    # listepersonnes. L'événement est conservé, daté par la parution,
    # et l'anomalie consignée — jamais de suppression silencieuse.
    signaler(sprintf("%s : branche %s absente — événement daté par la parution",
                     annonce$id %||% "?", nom_branche))
    ligne$date_evenement <- annonce$dateparution %||% NA_character_
    ligne$detail_evenement <- "détail non publié dans l'annonce (branche absente)"
  }
  ligne
}

date_valide <- function(valeur) {
  !is.na(valeur) & !is.na(as.Date(valeur, format = "%Y-%m-%d"))
}

controler_annonces <- function(annonces, evenements, nb_fichiers) {
  ok <- function(condition) if (isTRUE(condition)) "OK" else "ATTENTION"
  sirens <- annonces$siren[!is.na(annonces$siren)]
  data.frame(
    controle = c("fichiers_lus", "annonces_produites", "id_annonce_renseigne",
                 "id_annonce_unique", "siren_9_chiffres",
                 "date_parution_valide", "famille_avis_renseignee",
                 "evenements_produits", "anomalies_signalees"),
    valeur = c(nb_fichiers, nrow(annonces), sum(!is.na(annonces$id_annonce)),
               length(unique(annonces$id_annonce)),
               sum(grepl("^\\d{9}$", sirens)),
               sum(date_valide(annonces$date_parution)),
               sum(!is.na(annonces$famille_avis)),
               nrow(evenements), length(warnings_log)),
    statut = c(ok(nb_fichiers > 0), ok(nrow(annonces) == nb_fichiers),
               ok(all(!is.na(annonces$id_annonce))),
               ok(length(unique(annonces$id_annonce)) == nrow(annonces)),
               ok(all(grepl("^\\d{9}$", sirens))),
               ok(all(date_valide(annonces$date_parution))),
               ok(all(!is.na(annonces$famille_avis))),
               ok(nrow(evenements) > 0),
               if (length(warnings_log) == 0) "OK" else "A_LIRE"),
    stringsAsFactors = FALSE
  )
}

# ── PROGRAMME PRINCIPAL ─────────────────────────────────────────────────

main <- function() {
  fichiers <- sort(list.files(raw_dir, pattern = "\\.json$", full.names = TRUE))
  if (length(fichiers) == 0) stop("Aucun fichier JSON dans ", raw_dir)

  annonces_liste <- list()
  evenements_liste <- list()
  for (fichier in fichiers) {
    annonce <- lire_json(fichier)
    annonces_liste[[fichier]] <- normaliser_annonce(annonce)
    evenements_liste[[fichier]] <- extraire_evenement(annonce)
  }
  annonces <- do.call(rbind, annonces_liste)
  evenements <- do.call(rbind, evenements_liste)
  rownames(annonces) <- rownames(evenements) <- NULL
  # Le SIREN de la table annonces est reporté sur l'événement.
  evenements$siren <- annonces$siren[match(evenements$id_annonce,
                                           annonces$id_annonce)]
  evenements <- evenements[, c("id_annonce", "siren", "type_evenement",
                               "date_evenement", "nature_evenement",
                               "detail_evenement")]
  controles <- controler_annonces(annonces, evenements, length(fichiers))

  dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
  write.csv(annonces, file.path(out_dir, "bodacc_annonces.csv"),
            row.names = FALSE, na = "", fileEncoding = "UTF-8")
  write.csv(evenements, file.path(out_dir, "bodacc_evenements.csv"),
            row.names = FALSE, na = "", fileEncoding = "UTF-8")
  write.csv(controles, file.path(out_dir, "bodacc_controles.csv"),
            row.names = FALSE, na = "", fileEncoding = "UTF-8")

  cat(sprintf("%d fichier(s) lu(s) → %d annonce(s), %d événement(s)\n",
              length(fichiers), nrow(annonces), nrow(evenements)))
  print(controles, row.names = FALSE)
  for (w in warnings_log) cat("  !", w, "\n")
  invisible(controles)
}

if (sys.nframe() == 0) main()
