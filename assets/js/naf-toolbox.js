/**
 * naf-toolbox.js
 * Confort de la Boîte à outils.
 *
 * La page reste lisible sans JavaScript : fiches et recettes sont des
 * <details> natifs, la vue « Par source » est celle par défaut du HTML.
 * Ce script ajoute :
 *   - la bascule Par besoin / Par source ;
 *   - l'ouverture d'une fiche ciblée depuis un besoin ou l'URL ;
 *   - l'injection des points d'entrée depuis data/etudes/sources.csv,
 *     la source de vérité du site (aucune URL dupliquée ici).
 */
(function () {
  "use strict";

  var root = document.getElementById("naf-tb");
  if (!root) return;

  /* ── Bascule Par besoin / Par source ─────────────────────────── */

  var modeButtons = root.querySelectorAll(".naf-tb-modes .naf-version");

  function setMode(mode) {
    root.dataset.mode = mode;
    Array.prototype.forEach.call(modeButtons, function (button) {
      var isCurrent = button.dataset.mode === mode;
      button.setAttribute("aria-checked", isCurrent ? "true" : "false");
      button.classList.toggle("is-current", isCurrent);
    });
  }

  Array.prototype.forEach.call(modeButtons, function (button) {
    button.addEventListener("click", function () {
      setMode(button.dataset.mode);
    });
  });

  // Vue par défaut : le besoin d'abord — c'est lui qui choisit la source.
  setMode(root.dataset.mode || "besoin");

  /* ── Un besoin ouvre sa fiche ────────────────────────────────── */

  function openFiche(id, focus) {
    var fiche = document.getElementById(id);
    if (!fiche) return;
    setMode("source");
    fiche.open = true;
    fiche.scrollIntoView({ block: "start" });
    if (focus) fiche.querySelector("summary").focus();
  }

  Array.prototype.forEach.call(
    root.querySelectorAll(".naf-tb-need"), function (link) {
      link.addEventListener("click", function (event) {
        var id = (link.hash || "").replace("#", "");
        if (!id) return;
        event.preventDefault();
        history.replaceState(null, "", "#" + id);
        openFiche(id, true);
      });
    });

  function applyHash() {
    var id = window.location.hash.replace("#", "");
    if (!id) return;
    var target = document.getElementById(id);
    if (!target) return;
    var details = target.closest("details") ||
      (target.tagName === "DETAILS" ? target : null);
    if (details && details.classList.contains("naf-tb-fiche")) {
      openFiche(details.id, false);
    } else if (details) {
      details.open = true;
    }
  }

  window.addEventListener("hashchange", applyHash);
  applyHash();

  /* ── Injection du manifeste de sources ───────────────────────── */

  var LINK_LABELS = [
    ["url", "Portail ↗"],
    ["url_documentation", "Documentation ↗"],
    ["url_api", "API ↗"],
    ["url_download", "Téléchargement ↗"],
  ];

  function renderEntry(row) {
    var entry = document.createElement("div");
    entry.className = "naf-tb-entry";

    var name = document.createElement("span");
    name.className = "naf-tb-entry-name";
    name.textContent = row.nom || row.source_id;
    entry.appendChild(name);

    var links = document.createElement("span");
    links.className = "naf-tb-entry-links";
    LINK_LABELS.forEach(function (pair) {
      var url = (row[pair[0]] || "").trim();
      if (!url) return;
      var link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = pair[1];
      links.appendChild(link);
    });
    entry.appendChild(links);

    var meta = document.createElement("span");
    meta.className = "naf-tb-entry-meta";
    var bits = [];
    if (row.frequence) bits.push(row.frequence);
    if (row.acces) bits.push(row.acces);
    if ((row.auth_requise || "").trim() === "oui") bits.push("clé requise");
    meta.textContent = bits.join(" · ");
    entry.appendChild(meta);

    return entry;
  }

  function injectManifest(rows) {
    var byId = {};
    rows.forEach(function (row) { byId[row.source_id] = row; });

    Array.prototype.forEach.call(
      root.querySelectorAll("[data-mf-links]"), function (holder) {
        var ids = holder.dataset.mfLinks.split(",");
        var found = false;
        ids.forEach(function (id) {
          var row = byId[id.trim()];
          if (!row) return;
          holder.appendChild(renderEntry(row));
          found = true;
        });
        if (!found) fallback(holder);
      });
  }

  function fallback(holder) {
    var note = document.createElement("p");
    note.className = "naf-tb-entry-meta";
    note.textContent = "Points d'entrée : voir data/etudes/sources.csv " +
      "(manifeste de provenance du dépôt).";
    holder.appendChild(note);
  }

  if (window.NAF && window.NAF.loadCsv) {
    window.NAF.loadCsv("etudes/sources.csv").then(injectManifest)
      .catch(function () {
        Array.prototype.forEach.call(
          root.querySelectorAll("[data-mf-links]"), fallback);
      });
  }
})();
