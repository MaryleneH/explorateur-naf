/**
 * naf-bodacc.js — cas pratique « Du JSON BODACC à une table statistique ».
 *
 * Règle du site : aucun nombre recopié à la main. Tout ce que cette page
 * affiche de calculable est calculé ici, à partir des fichiers versionnés :
 *   - data/exemples/bodacc/raw/*.json           (les 3 annonces réelles)
 *   - data/exemples/bodacc/processed/*.csv      (les sorties du programme)
 *   - data/etudes/sources.csv                   (liens officiels BODACC)
 *
 * La page reste lisible sans JavaScript : chaque zone dynamique a un texte
 * de repli qui renvoie vers les fichiers du dépôt.
 */
(function () {
  "use strict";

  var root = document.getElementById("naf-bx");
  if (!root) return;

  var DATA = "../../data/exemples/bodacc/";

  var RAW_FILES = [
    { file: "01_creation.json", court: "création" },
    { file: "02_procedure_collective.json", court: "procédure collective" },
    { file: "03_radiation.json", court: "radiation" },
  ];

  // Branches imbriquées pertinentes pour les trois familles du cas
  // pratique. radiationaurcs reste affichée même vide partout : c'est la
  // leçon de l'annonce 3 (la branche attendue peut être absente).
  var BRANCHES = ["listepersonnes", "listeetablissements", "acte",
                  "jugement", "radiationaurcs"];

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function fetchJson(url) {
    return fetch(url).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status + " " + url);
      return response.json();
    });
  }

  /* ── Radiographie : mêmes fichiers, branches différentes ──────────── */

  function renderMatrix(annonces) {
    var holder = document.getElementById("naf-bx-matrix");
    if (!holder) return;
    holder.textContent = "";

    var table = el("table", "naf-comp-grain naf-bx-matrix");
    var caption = el("caption", "naf-bx-caption",
      "Branches réellement remplies dans les trois annonces (✓ = présente, — = null). " +
      "Tableau calculé à partir des fichiers de data/exemples/bodacc/raw/.");
    table.appendChild(caption);
    var thead = el("thead", null);
    var headRow = el("tr", null);
    headRow.appendChild(el("th", null, "branche"));
    annonces.forEach(function (a) {
      var th = el("th", null, a.court);
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = el("tbody", null);
    BRANCHES.forEach(function (branche) {
      // N'afficher que les branches qu'au moins un fichier connaît :
      // on ne décrit pas des champs absents des trois exemples.
      var presente = annonces.some(function (a) {
        return branche in a.json;
      });
      if (!presente) return;
      var row = el("tr", null);
      var cell = el("td", null);
      cell.appendChild(el("span", "naf-mono", branche));
      row.appendChild(cell);
      annonces.forEach(function (a) {
        var rempli = a.json[branche] !== null && a.json[branche] !== undefined;
        var td = el("td", rempli ? "naf-bx-oui" : "naf-bx-non",
                    rempli ? "✓" : "—");
        td.setAttribute("aria-label", branche + " " +
          (rempli ? "présente" : "absente") + " dans l'annonce " + a.court);
        row.appendChild(td);
      });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    var wrap = el("div", "naf-comp-grainwrap");
    wrap.appendChild(table);
    holder.appendChild(wrap);
  }

  /* ── Extraits JSON réels, dépliables ──────────────────────────────── */

  function renderExtraits(annonces) {
    annonces.forEach(function (a, i) {
      var holder = document.getElementById("naf-bx-json-" + (i + 1));
      if (!holder) return;
      holder.textContent = JSON.stringify(a.json, null, 2);
    });
    // « JSON dans le JSON » : la branche listepersonnes de l'annonce 1,
    // d'abord telle quelle (une chaîne), puis re-parsée.
    var brut = document.getElementById("naf-bx-imbrique-brut");
    var parse = document.getElementById("naf-bx-imbrique-parse");
    var chaine = annonces[0] && annonces[0].json.listepersonnes;
    if (brut && typeof chaine === "string") {
      brut.textContent = JSON.stringify(chaine.slice(0, 120) + "…");
    }
    if (parse && typeof chaine === "string") {
      try {
        parse.textContent = JSON.stringify(JSON.parse(chaine), null, 2);
      } catch (error) { /* le repli statique reste affiché */ }
    }
  }

  /* ── Chaîne réelle : compteurs calculés ───────────────────────────── */

  function renderChaine(annonces, tables) {
    var valeurs = {
      "naf-bx-n-json": annonces.length,
      "naf-bx-n-annonces": tables.annonces.length,
      "naf-bx-n-evenements": tables.evenements.length,
    };
    Object.keys(valeurs).forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.textContent = String(valeurs[id]);
    });
  }

  /* ── Tables de résultat réelles ───────────────────────────────────── */

  function renderTable(holderId, rows, colonnes) {
    var holder = document.getElementById(holderId);
    if (!holder || !rows.length) return;
    holder.textContent = "";
    var wrap = el("div", "naf-comp-grainwrap");
    var table = el("table", "naf-comp-grain");
    var thead = el("thead", null);
    var headRow = el("tr", null);
    colonnes.forEach(function (c) {
      headRow.appendChild(el("th", null, c.titre));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = el("tbody", null);
    rows.forEach(function (row) {
      var tr = el("tr", null);
      colonnes.forEach(function (c) {
        var valeur = row[c.champ] || "";
        var td = el("td", c.mono ? "naf-mono" : null,
                    c.max && valeur.length > c.max
                      ? valeur.slice(0, c.max - 1) + "…" : valeur);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    holder.appendChild(wrap);
  }

  function renderResultats(tables) {
    var evenementsParId = {};
    tables.evenements.forEach(function (e) {
      evenementsParId[e.id_annonce] = e;
    });
    var lignes = tables.annonces.map(function (a) {
      var e = evenementsParId[a.id_annonce] || {};
      return {
        id_annonce: a.id_annonce,
        famille_avis: a.famille_avis,
        siren: a.siren,
        denomination: a.denomination,
        type_evenement: e.type_evenement,
        date_evenement: e.date_evenement,
      };
    });
    renderTable("naf-bx-resultat", lignes, [
      { champ: "id_annonce", titre: "annonce", mono: true },
      { champ: "famille_avis", titre: "famille" },
      { champ: "siren", titre: "SIREN", mono: true },
      { champ: "denomination", titre: "dénomination", max: 26 },
      { champ: "type_evenement", titre: "événement" },
      { champ: "date_evenement", titre: "date" },
    ]);

    renderTable("naf-bx-controles", tables.controles, [
      { champ: "controle", titre: "contrôle", mono: true },
      { champ: "valeur", titre: "valeur" },
      { champ: "statut", titre: "statut", mono: true },
    ]);
  }

  /* ── Mini-exploitation statistique ────────────────────────────────── */

  function renderExploitation(tables) {
    var holder = document.getElementById("naf-bx-stats");
    if (!holder) return;
    holder.textContent = "";

    holder.appendChild(el("p", "naf-bx-stat-line",
      "Nombre d'annonces : " + tables.annonces.length + "."));

    var familles = {};
    tables.annonces.forEach(function (a) {
      familles[a.famille_avis] = (familles[a.famille_avis] || 0) + 1;
    });
    var ulF = el("ul", "naf-bx-stat-list");
    Object.keys(familles).sort().forEach(function (f) {
      ulF.appendChild(el("li", null, f + " — " + familles[f] +
        (familles[f] > 1 ? " annonces" : " annonce")));
    });
    holder.appendChild(el("p", "naf-bx-stat-line", "Familles observées :"));
    holder.appendChild(ulF);

    var natures = {};
    tables.evenements.forEach(function (e) {
      var cle = e.type_evenement || "(non déterminé)";
      natures[cle] = (natures[cle] || 0) + 1;
    });
    var ulN = el("ul", "naf-bx-stat-list");
    Object.keys(natures).sort().forEach(function (n) {
      ulN.appendChild(el("li", null, n + " — " + natures[n] +
        (natures[n] > 1 ? " événements" : " événement")));
    });
    holder.appendChild(el("p", "naf-bx-stat-line",
      "Événements par nature :"));
    holder.appendChild(ulN);
  }

  /* ── Liens officiels depuis le manifeste des sources ──────────────── */

  function renderLiensOfficiels() {
    var holders = root.querySelectorAll("[data-src-doc]");
    if (!holders.length || !window.NAF || !window.NAF.loadCsv) return;
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

  /* ── Chargement ───────────────────────────────────────────────────── */

  function charger() {
    var rawPromises = RAW_FILES.map(function (spec) {
      return fetchJson(DATA + "raw/" + spec.file).then(function (json) {
        return { file: spec.file, court: spec.court, json: json };
      });
    });
    var csvPromises = ["bodacc_annonces.csv", "bodacc_evenements.csv",
                       "bodacc_controles.csv"].map(function (nom) {
      return window.NAF.loadCsv("exemples/bodacc/processed/" + nom);
    });

    Promise.all([Promise.all(rawPromises), Promise.all(csvPromises)])
      .then(function (resultats) {
        var annonces = resultats[0];
        var tables = {
          annonces: resultats[1][0],
          evenements: resultats[1][1],
          controles: resultats[1][2],
        };
        renderMatrix(annonces);
        renderExtraits(annonces);
        renderChaine(annonces, tables);
        renderResultats(tables);
        renderExploitation(tables);
      })
      .catch(function (error) {
        var alerte = document.getElementById("naf-bx-error");
        if (alerte) {
          alerte.hidden = false;
          alerte.textContent = "Les fichiers d'exemple n'ont pas pu être " +
            "chargés (" + error.message + "). Ils restent consultables " +
            "dans le dépôt : data/exemples/bodacc/.";
        }
      });
  }

  renderLiensOfficiels();
  charger();
})();
