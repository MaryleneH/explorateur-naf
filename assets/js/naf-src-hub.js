/**
 * naf-src-hub.js — rubrique « Comprendre les sources ».
 *
 * Deux responsabilités, aucune donnée dupliquée :
 *   1. la navigation locale entre les pages de sources (une seule
 *      définition des familles et des pages, ci-dessous) — rendue dans
 *      chaque page à l'emplacement #naf-src-nav, repliée sur mobile,
 *      ouverte sur écran large, avec la page courante marquée ;
 *   2. l'injection des liens officiels depuis data/etudes/sources.csv
 *      (la source de vérité du site) : [data-src-doc] reçoit
 *      url_documentation (ou url à défaut), [data-src-portal] reçoit url.
 *
 * Sans JavaScript, chaque page garde un lien de repli vers l'accueil de
 * la rubrique — rien n'est bloqué.
 */
(function () {
  "use strict";

  var root = document.getElementById("naf-src");
  if (!root) return;

  // L'unique définition de la navigation de la rubrique. Les regroupements
  // sont des repères de lecture, jamais un ordre d'analyse.
  var FAMILLES = [
    { titre: "Identifier & caractériser", pages: [
      { slug: "sirene", label: "Sirene" },
      { slug: "sirus", label: "Sirus" },
      { slug: "side", label: "SIDE" },
    ]},
    { titre: "Commande publique", pages: [
      { slug: "boamp", label: "BOAMP" },
      { slug: "decp", label: "DECP" },
    ]},
    { titre: "Vie des entreprises", pages: [
      { slug: "bodacc", label: "BODACC" },
      { slug: "rne", label: "RNE" },
    ]},
    { titre: "Échanges extérieurs", pages: [
      { slug: "douanes", label: "Douanes" },
    ]},
    { titre: "Innovation", pages: [
      { slug: "inpi-brevets", label: "INPI — brevets" },
    ]},
    { titre: "Économie de la Défense", pages: [
      { slug: "refd", label: "REFD" },
      { slug: "edis", label: "EDIS" },
    ]},
  ];

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  /* ── Navigation locale ────────────────────────────────────────────── */

  function renderNav() {
    var holder = document.getElementById("naf-src-nav");
    if (!holder) return;
    var current = holder.dataset.current || "";
    holder.textContent = "";

    var details = el("details", "naf-src-navbox");
    var summary = el("summary", "naf-src-navsummary");
    summary.appendChild(el("span", "naf-src-navtitle", "Comprendre les sources"));
    summary.appendChild(el("span", "naf-src-navhint",
      current ? "changer de source" : "choisir une source"));
    details.appendChild(summary);

    var body = el("div", "naf-src-navbody");
    var accueil = el("a", "naf-src-navhome", "← Accueil de la rubrique");
    accueil.href = "index.html";
    body.appendChild(accueil);

    FAMILLES.forEach(function (famille) {
      var group = el("div", "naf-src-navgroup");
      group.appendChild(el("p", "naf-src-navfam", famille.titre));
      var ul = el("ul", null);
      famille.pages.forEach(function (page) {
        var li = el("li", null);
        var a = el("a", "naf-src-navlink", page.label);
        a.href = page.slug + ".html";
        if (page.slug === current) {
          a.setAttribute("aria-current", "page");
        }
        li.appendChild(a);
        ul.appendChild(li);
      });
      group.appendChild(ul);
      body.appendChild(group);
    });
    details.appendChild(body);
    holder.appendChild(details);

    // Ouverte d'emblée sur écran large ; repliée sur mobile pour ne pas
    // occuper la moitié de l'écran. L'utilisateur garde la main ensuite.
    if (window.matchMedia("(min-width: 861px)").matches) {
      details.open = true;
    }
  }

  /* ── Liens officiels depuis le manifeste ──────────────────────────── */

  function renderLiens() {
    var docs = root.querySelectorAll("[data-src-doc]");
    var portails = root.querySelectorAll("[data-src-portal]");
    if (!(docs.length || portails.length) || !window.NAF || !window.NAF.loadCsv) return;
    window.NAF.loadCsv("etudes/sources.csv").then(function (rows) {
      var byId = {};
      rows.forEach(function (row) { byId[row.source_id] = row; });
      Array.prototype.forEach.call(docs, function (link) {
        var source = byId[link.dataset.srcDoc];
        var url = source &&
          ((source.url_documentation || "").trim() || source.url);
        if (url) link.href = url;
        else link.remove();
      });
      Array.prototype.forEach.call(portails, function (link) {
        var source = byId[link.dataset.srcPortal];
        if (source && source.url) link.href = source.url;
        else link.remove();
      });
    }).catch(function () {
      Array.prototype.forEach.call(docs, function (l) { l.remove(); });
      Array.prototype.forEach.call(portails, function (l) { l.remove(); });
    });
  }

  renderNav();
  renderLiens();
})();
