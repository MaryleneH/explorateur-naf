/**
 * naf-toolbox.js
 * Confort de la Boîte à outils, version « gestes d'abord ».
 *
 * La page reste lisible sans JavaScript (index d'ancres natives, recettes
 * en <details>, tabsets Quarto). Ce script ajoute :
 *   - le sélecteur global Python / R du haut de page, qui pilote les
 *     tabsets Quarto synchronisés (group="langage", mémorisés par Quarto
 *     dans localStorage : choisi une fois, appliqué partout) ;
 *   - le suivi de section dans la navigation locale collante ;
 *   - l'ouverture d'une recette ciblée par l'URL, y compris via les
 *     ANCIENNES ancres (#recette-01…, #fiche-…) qui restent toutes
 *     fonctionnelles — aucune redirection cassée ;
 *   - l'injection des liens officiels depuis data/etudes/sources.csv
 *     (source de vérité : aucune URL officielle dupliquée ici).
 */
(function () {
  "use strict";

  var root = document.getElementById("naf-tb");
  if (!root) return;

  /* ── Anciennes ancres : compatibilité totale ─────────────────────── */

  // recette-0N (ancienne numérotation) → geste explicite.
  var LEGACY = {
    "recette-01": "trouver-entreprise",
    "recette-02": "etablissements",
    "recette-03": "stock-sirene",
    "recette-04": "boamp",
    "recette-05": "decp",
    "recette-06": "bodacc",
    "recette-07": "douanes",
    "recette-08": "inpi",
    "recette-09": "appariement",
    // fiche-X (anciennes fiches sources, désormais dans l'État des
    // sources) → le geste correspondant quand il existe…
    "fiche-sirene": "trouver-entreprise",
    "fiche-boamp": "boamp",
    "fiche-decp": "decp",
    "fiche-bodacc": "bodacc",
    "fiche-douanes": "douanes",
    "fiche-inpi": "inpi",
  };

  // …et vers la fiche de l'État des sources quand aucun geste n'existe
  // (Sirus et SIDE ne sont volontairement pas des recettes).
  var LEGACY_EXTERNAL = {
    "fiche-sirus": "../bonus/sources.html#source-sirus",
    "fiche-side": "../bonus/sources.html#source-side",
    "fiche-refd": "../bonus/sources.html#source-refd",
    "fiche-naf": "../bonus/sources.html#source-naf_correspondance",
  };

  function applyHash() {
    var id = window.location.hash.replace("#", "");
    if (!id) return;
    if (LEGACY_EXTERNAL[id]) {
      window.location.replace(LEGACY_EXTERNAL[id]);
      return;
    }
    if (LEGACY[id]) {
      id = LEGACY[id];
      history.replaceState(null, "", "#" + id);
    }
    var target = document.getElementById(id);
    if (!target) return;
    var details = target.closest("details") ||
      (target.tagName === "DETAILS" ? target : null);
    if (details) details.open = true;
    target.scrollIntoView({ block: "start" });
  }

  window.addEventListener("hashchange", applyHash);
  applyHash();

  /* ── Sélecteur global Python / R ─────────────────────────────────── */

  var langBox = document.getElementById("naf-tb-lang");

  function currentTabsetLang() {
    // Quarto mémorise le choix des tabsets group="langage".
    try {
      var stored = JSON.parse(
        localStorage.getItem("quarto-persistent-tabsets-data") || "{}");
      return (stored.langage || "").toLowerCase() || null;
    } catch (error) {
      return null;
    }
  }

  function reflectLang(lang) {
    if (!langBox || !lang) return;
    Array.prototype.forEach.call(
      langBox.querySelectorAll(".naf-version"), function (button) {
        var current = button.dataset.lang === lang;
        button.classList.toggle("is-current", current);
        button.setAttribute("aria-checked", current ? "true" : "false");
      });
  }

  function activateLang(lang) {
    // Cliquer un onglet du bon libellé suffit : Quarto synchronise tous
    // les tabsets du groupe et mémorise le choix.
    var label = lang === "r" ? "R" : "Python";
    var links = root.querySelectorAll(".panel-tabset .nav-link");
    for (var i = 0; i < links.length; i++) {
      if (links[i].textContent.trim() === label) {
        links[i].click();
        break;
      }
    }
    reflectLang(lang);
  }

  if (langBox) {
    langBox.addEventListener("click", function (event) {
      var button = event.target.closest(".naf-version");
      if (button) activateLang(button.dataset.lang);
    });
    // Refléter un choix mémorisé lors d'une visite précédente.
    reflectLang(currentTabsetLang() || "python");
    // Et suivre les clics faits directement dans un tabset.
    root.addEventListener("click", function (event) {
      var tab = event.target.closest(".panel-tabset .nav-link");
      if (!tab) return;
      var text = tab.textContent.trim();
      if (text === "Python" || text === "R") {
        reflectLang(text.toLowerCase());
      }
    });
  }

  /* ── Navigation locale : suivi de section ────────────────────────── */

  var nav = document.getElementById("naf-tb-nav");
  if (nav && "IntersectionObserver" in window) {
    var links = Array.prototype.slice.call(
      nav.querySelectorAll(".naf-comp-nav-link"));
    var sections = links.map(function (link) {
      return document.getElementById((link.hash || "").replace("#", ""));
    }).filter(Boolean);

    var visible = new Map();
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        visible.set(entry.target.id, entry.isIntersecting);
      });
      var current = sections.filter(function (section) {
        return visible.get(section.id);
      })[0];
      if (!current) return;
      links.forEach(function (link) {
        var isCurrent = (link.hash || "") === "#" + current.id;
        if (isCurrent) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      });
    }, { rootMargin: "-10% 0px -70% 0px" });
    sections.forEach(function (section) { observer.observe(section); });
  }

  /* ── Liens officiels depuis le manifeste ─────────────────────────── */

  var holders = root.querySelectorAll("[data-src-doc]");
  if (holders.length && window.NAF && window.NAF.loadCsv) {
    window.NAF.loadCsv("etudes/sources.csv").then(function (rows) {
      var byId = {};
      rows.forEach(function (row) { byId[row.source_id] = row; });
      Array.prototype.forEach.call(holders, function (link) {
        var source = byId[link.dataset.srcDoc];
        var url = source &&
          ((source.url_documentation || "").trim() || source.url);
        if (url) link.href = url;
        else link.remove();
      });
    }).catch(function () {
      Array.prototype.forEach.call(holders, function (link) {
        link.remove();
      });
    });
  }
})();
