/**
 * naf-explorer.js
 * Navigateur hiérarchique de la NAF.
 *
 * Un seul arbre DOM sert les deux mises en page. Le JavaScript ne connaît
 * qu'un état ; c'est le CSS qui décide d'afficher toutes les colonnes
 * (desktop) ou seulement la dernière (drill-down mobile). Il n'y a donc
 * jamais deux rendus à maintenir en cohérence.
 *
 * État :
 *   versionId  "2025" | "2008"
 *   stack      chemin sélectionné, de la section vers la sous-classe
 *   query      texte de recherche courant
 *
 * L'attribut data-depth de #naf-app vaut stack.length : c'est lui qui pilote
 * l'affichage mobile (quelle colonne est active, quand ouvrir la fiche).
 */
(function () {
  "use strict";

  var NAF = window.NAF;
  var LEVELS = NAF.LEVELS;
  var LEVEL_LABELS = NAF.LEVEL_LABELS;
  var LEVEL_PLURALS = NAF.LEVEL_PLURALS;

  var app = document.getElementById("naf-app");
  if (!app) return;

  var dom = {
    app: app,
    searchForm: document.getElementById("naf-searchbox"),
    search: document.getElementById("naf-q"),
    searchClear: document.getElementById("naf-search-clear"),
    versions: document.querySelectorAll(".naf-version"),
    counts: document.getElementById("naf-counts"),
    results: document.getElementById("naf-results"),
    browser: document.getElementById("naf-browser"),
    mobilebar: document.getElementById("naf-mobilebar"),
    crumbs: document.getElementById("naf-crumbs"),
    columns: document.getElementById("naf-columns"),
    sheet: document.getElementById("naf-sheet"),
    error: document.getElementById("naf-error"),
  };

  var state = {
    versionId: "2025",
    nomenclature: null,
    stack: [],
    query: "",
    results: [],
  };

  // Données annexes, chargées à la demande à la première ouverture d'une fiche.
  var corresp = null;
  var defense = null;

  /* ═══════════════════════════════════════════════════════════════════
     Aides
  ═══════════════════════════════════════════════════════════════════ */

  var el = NAF.el;

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function deepest() {
    return state.stack.length ? state.stack[state.stack.length - 1] : null;
  }

  function nodesAtLevel(index) {
    if (!state.nomenclature) return [];
    if (index === 0) return state.nomenclature.roots;
    var parent = state.stack[index - 1];
    return parent ? parent.children : [];
  }

  /* ═══════════════════════════════════════════════════════════════════
     Ligne de nomenclature

     Une ligne, pas une carte : code en chasse fixe, libellé, chevron si
     l'entrée a des enfants. La sélection est portée par un rail vertical
     et un fond très léger, jamais par la couleur seule (aria-current).
  ═══════════════════════════════════════════════════════════════════ */

  function buildRow(node, levelIndex, isSelected) {
    var button = el("button", "naf-row");
    button.type = "button";
    button.dataset.code = node.code;
    button.dataset.levelIndex = String(levelIndex);

    if (isSelected) {
      button.classList.add("is-selected");
      button.setAttribute("aria-current", "true");
    }
    if (node.children.length) {
      button.setAttribute("aria-expanded", isSelected ? "true" : "false");
    }

    button.appendChild(el("span", "naf-row-code", node.code));
    button.appendChild(el("span", "naf-row-label", node.label));

    var mark = defenseFor(node.code);
    if (mark) {
      var dot = el("span", "naf-row-defense");
      dot.setAttribute("aria-label", "Activité qualifiée : " + DEFENSE_LABELS[mark.niveau_defense]);
      dot.title = DEFENSE_LABELS[mark.niveau_defense];
      button.appendChild(dot);
    }

    if (node.children.length) {
      var chevron = el("span", "naf-row-chevron");
      chevron.setAttribute("aria-hidden", "true");
      chevron.textContent = "›";
      button.appendChild(chevron);
    }

    // Nom accessible composé explicitement : concaténer le contenu donnerait
    // « AAGRICULTURE… », le code et le libellé n'étant séparés que visuellement.
    var name = node.code + ", " + node.label;
    if (node.children.length) {
      name += ", " + node.children.length + " " + LEVEL_PLURALS[node.children[0].level];
    }
    if (mark) {
      name += ", " + DEFENSE_LABELS[mark.niveau_defense];
    }
    button.setAttribute("aria-label", name);

    button.addEventListener("click", function () {
      select(levelIndex, node);
    });

    return button;
  }

  /* ═══════════════════════════════════════════════════════════════════
     Colonnes

     On ne rend jamais de colonne vide : le nombre de colonnes vaut
     stack.length + 1, plafonné à 5. À l'ouverture, une seule colonne large
     avec les 22 sections, ce qui évite les panneaux vides du départ.
  ═══════════════════════════════════════════════════════════════════ */

  function renderColumns() {
    clear(dom.columns);
    if (!state.nomenclature) return;

    var columnCount = Math.min(state.stack.length + 1, LEVELS.length);

    for (var i = 0; i < columnCount; i++) {
      var level = LEVELS[i];
      var nodes = nodesAtLevel(i);
      if (!nodes.length) continue;

      var column = el("section", "naf-col");
      column.dataset.level = level;
      column.dataset.index = String(i);
      if (i === columnCount - 1) column.classList.add("is-active");

      var head = el("header", "naf-col-head");
      head.appendChild(el("h2", "naf-col-title", LEVEL_LABELS[level]));
      head.appendChild(el("span", "naf-col-count", String(nodes.length)));
      column.appendChild(head);

      var list = el("div", "naf-col-list");
      list.setAttribute("role", "list");
      var selectedNode = state.stack[i];
      nodes.forEach(function (node) {
        var wrapper = el("div", "naf-row-wrap");
        wrapper.setAttribute("role", "listitem");
        wrapper.appendChild(buildRow(node, i, !!selectedNode && selectedNode.code === node.code));
        list.appendChild(wrapper);
      });
      column.appendChild(list);
      dom.columns.appendChild(column);
    }

    // Desktop : garder la dernière colonne visible quand on descend.
    var active = dom.columns.querySelector(".naf-col.is-active");
    if (active && dom.columns.scrollWidth > dom.columns.clientWidth) {
      dom.columns.scrollLeft = dom.columns.scrollWidth;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     Fil d'Ariane (desktop)
  ═══════════════════════════════════════════════════════════════════ */

  function renderCrumbs() {
    clear(dom.crumbs);
    if (!state.stack.length) {
      dom.crumbs.appendChild(el("span", "naf-crumb-hint",
        "Choisissez une section pour commencer."));
      return;
    }

    var list = el("ol", "naf-crumb-list");

    var root = el("li", "naf-crumb");
    var rootButton = el("button", "naf-crumb-btn", "Toutes les sections");
    rootButton.type = "button";
    rootButton.addEventListener("click", function () {
      setStack([]);
    });
    root.appendChild(rootButton);
    list.appendChild(root);

    state.stack.forEach(function (node, index) {
      var item = el("li", "naf-crumb");
      var button = el("button", "naf-crumb-btn");
      button.type = "button";
      button.appendChild(el("span", "naf-crumb-code", node.code));
      button.appendChild(el("span", "naf-crumb-label", node.label));
      if (index === state.stack.length - 1) button.setAttribute("aria-current", "true");
      button.addEventListener("click", function () {
        setStack(state.stack.slice(0, index + 1));
      });
      item.appendChild(button);
      list.appendChild(item);
    });

    dom.crumbs.appendChild(list);
  }

  /* ═══════════════════════════════════════════════════════════════════
     Barre mobile

     Le retour nomme toujours l'endroit où il ramène, jamais l'endroit d'où
     l'on vient : c'est ce que l'utilisateur cherche à lire avant de toucher.
  ═══════════════════════════════════════════════════════════════════ */

  function backTargetLabel() {
    var depth = state.stack.length;
    if (depth === 0) return null;
    if (depth === 1) return "Toutes les sections";
    var parent = state.stack[depth - 2];
    return LEVEL_LABELS[parent.level] + " " + parent.code;
  }

  function renderMobileBar() {
    clear(dom.mobilebar);
    var label = backTargetLabel();
    if (!label) return;

    var back = el("button", "naf-back");
    back.type = "button";
    back.appendChild(el("span", "naf-back-chevron", "‹"));
    back.appendChild(el("span", "naf-back-label", label));
    back.addEventListener("click", goBack);
    dom.mobilebar.appendChild(back);

    var parent = state.stack[state.stack.length - 1];
    if (parent && state.stack.length < LEVELS.length) {
      var context = el("div", "naf-context");
      context.appendChild(el("span", "naf-context-code", parent.code));
      context.appendChild(el("span", "naf-context-label", parent.label));
      dom.mobilebar.appendChild(context);
    }
  }

  function goBack() {
    if (!state.stack.length) return;
    setStack(state.stack.slice(0, state.stack.length - 1));
  }

  /* ═══════════════════════════════════════════════════════════════════
     Qualification Défense
  ═══════════════════════════════════════════════════════════════════ */

  var DEFENSE_LABELS = {
    explicite_industriel: "Défense explicite (industrie)",
    dual_officiel: "Activité duale (civile et militaire)",
    administration_defense: "Administration de la défense",
  };

  function defenseFor(code) {
    if (!defense) return null;
    var version = NAF.VERSIONS[state.versionId].csvVersion;
    for (var i = 0; i < defense.length; i++) {
      if (defense[i].code === code && defense[i].naf_version === version) return defense[i];
    }
    return null;
  }

  /* ═══════════════════════════════════════════════════════════════════
     Fiche

     Sections repliables natives : elles fonctionnent sans JavaScript, sont
     accessibles au clavier et ne cassent pas si le contenu est dynamique,
     contrairement à un tabset Quarto qui attend du contenu statique.
  ═══════════════════════════════════════════════════════════════════ */

  function buildSection(title, open) {
    var details = el("details", "naf-sheet-section");
    if (open) details.open = true;
    var summary = el("summary", "naf-sheet-summary");
    summary.appendChild(el("span", "naf-sheet-summary-text", title));
    details.appendChild(summary);
    var body = el("div", "naf-sheet-body");
    details.appendChild(body);
    details.body = body;
    return details;
  }

  function buildPathLine(node) {
    var path = NAF.pathOf(node);
    var line = el("p", "naf-sheet-path");
    path.forEach(function (step, index) {
      if (index) {
        var sep = el("span", "naf-sheet-path-sep", "›");
        sep.setAttribute("aria-hidden", "true");
        line.appendChild(sep);
      }
      var chip = el("button", "naf-sheet-path-step", step.code);
      chip.type = "button";
      chip.title = step.label;
      if (index === path.length - 1) chip.setAttribute("aria-current", "true");
      chip.addEventListener("click", function () {
        setStack(path.slice(0, index + 1));
      });
      line.appendChild(chip);
    });
    return line;
  }

  function inseeLink(node, text) {
    var url = NAF.inseeUrl(state.versionId, node.level, node.code);
    if (!url) return null;
    var link = el("a", "naf-link", text || url);
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  }

  function renderSheet() {
    clear(dom.sheet);
    var node = deepest();

    if (!node) {
      dom.sheet.hidden = true;
      return;
    }
    dom.sheet.hidden = false;

    var version = NAF.VERSIONS[state.versionId];

    /* En-tête */
    var head = el("header", "naf-sheet-head");
    head.appendChild(el("p", "naf-sheet-code", node.code));
    head.appendChild(el("h2", "naf-sheet-label", node.label));
    head.appendChild(el("p", "naf-sheet-meta",
      version.longLabel + " · " + LEVEL_LABELS[node.level]));
    head.appendChild(buildPathLine(node));
    dom.sheet.appendChild(head);

    /* Vue d'ensemble */
    var overview = buildSection("Vue d'ensemble", true);
    var list = el("dl", "naf-deflist");
    function addDef(term, value) {
      list.appendChild(el("dt", null, term));
      var dd = el("dd");
      if (typeof value === "string") dd.textContent = value;
      else if (value) dd.appendChild(value);
      list.appendChild(dd);
    }
    addDef("Niveau", LEVEL_LABELS[node.level]);
    var codeValue = el("span", "naf-mono", node.code);
    addDef("Code", codeValue);
    addDef("Libellé", node.label);
    addDef("Nomenclature", version.longLabel);
    if (node.children.length) {
      addDef("Contient",
        node.children.length + " " + LEVEL_PLURALS[node.children[0].level]);
    }
    overview.body.appendChild(list);
    dom.sheet.appendChild(overview);

    /* Notes officielles */
    var row = node.row || {};
    var include = buildSection("Comprend", false);
    include.body.appendChild(notesBlock(row.notes_include, node));
    dom.sheet.appendChild(include);

    var exclude = buildSection("Ne comprend pas", false);
    exclude.body.appendChild(notesBlock(row.notes_exclude, node));
    dom.sheet.appendChild(exclude);

    /* Correspondances */
    var corr = buildSection("2008 ↔ 2025", false);
    corr.body.appendChild(correspondancesBlock(node));
    dom.sheet.appendChild(corr);

    /* Défense */
    var def = buildSection("Défense", false);
    def.body.appendChild(defenseBlock(node));
    dom.sheet.appendChild(def);

    /* Sources */
    var sources = buildSection("Sources", false);
    sources.body.appendChild(sourcesBlock(node, row));
    dom.sheet.appendChild(sources);
  }

  function notesBlock(text, node) {
    if (text && text.trim()) {
      return el("p", "naf-sheet-text", text.trim());
    }
    var paragraph = el("p", "naf-sheet-text naf-sheet-muted");
    paragraph.appendChild(document.createTextNode(
      "Les notes explicatives détaillées ne figurent pas dans le jeu de données. "));
    var link = inseeLink(node, "Consulter la fiche officielle Insee");
    if (link) {
      paragraph.appendChild(link);
      paragraph.appendChild(document.createTextNode("."));
    }
    return paragraph;
  }

  function correspondancesBlock(node) {
    if (node.level !== "subclass") {
      return el("p", "naf-sheet-text naf-sheet-muted",
        "Les correspondances officielles sont publiées au niveau de la sous-classe.");
    }
    if (!corresp) {
      return el("p", "naf-sheet-text naf-sheet-muted", "Chargement des correspondances…");
    }

    var isCurrent2025 = state.versionId === "2025";
    var matches = corresp.filter(function (r) {
      return isCurrent2025 ? r.code_2025 === node.code : r.code_2008 === node.code;
    });

    if (!matches.length) {
      // Distinguer « pas de correspondance » de « table incomplète » : la table
      // dont nous disposons ne couvre pas encore toutes les sous-classes, et
      // laisser croire à une absence de correspondance serait faux.
      var missing = el("p", "naf-sheet-text naf-sheet-muted");
      missing.appendChild(document.createTextNode(
        "Ce code ne figure pas dans la table de correspondance dont nous " +
        "disposons, dont la couverture est partielle. Cela ne signifie pas " +
        "qu'aucune correspondance n'existe. "));
      var official = el("a", "naf-link", "Table officielle Insee ↗");
      official.href = "https://www.insee.fr/fr/information/8201411";
      official.target = "_blank";
      official.rel = "noopener noreferrer";
      missing.appendChild(official);
      return missing;
    }

    var fragment = document.createDocumentFragment();
    fragment.appendChild(el("p", "naf-sheet-text",
      isCurrent2025
        ? "Codes NAF rév.2 (2008) correspondants :"
        : "Codes NAF 2025 correspondants :"));

    var otherVersionId = isCurrent2025 ? "2008" : "2025";
    var list = el("ul", "naf-corr-list");
    matches.forEach(function (match) {
      var code = isCurrent2025 ? match.code_2008 : match.code_2025;
      var label = isCurrent2025 ? match.libelle_2008 : match.libelle_2025;
      var item = el("li", "naf-corr-item");
      var link = el("a", "naf-corr-code naf-mono", code);
      link.href = "?v=" + otherVersionId + "&code=" + encodeURIComponent(code);
      item.appendChild(link);
      item.appendChild(el("span", "naf-corr-label", label));
      if (match.type_correspondance) {
        item.appendChild(el("span", "naf-corr-type", match.type_correspondance));
      }
      list.appendChild(item);
    });
    fragment.appendChild(list);
    return fragment;
  }

  function defenseBlock(node) {
    var fragment = document.createDocumentFragment();
    var entry = defenseFor(node.code);

    if (!entry) {
      var note = el("p", "naf-sheet-text naf-sheet-muted");
      note.appendChild(document.createTextNode("Ce code est "));
      note.appendChild(el("strong", null, "non évalué"));
      note.appendChild(document.createTextNode(
        " au regard de la Défense. Non évalué ne signifie pas non Défense : " +
        "seuls quelques codes ont fait l'objet d'une qualification documentée."));
      fragment.appendChild(note);
      return fragment;
    }

    var list = el("dl", "naf-deflist");
    function addDef(term, value) {
      list.appendChild(el("dt", null, term));
      var dd = el("dd");
      if (typeof value === "string") dd.textContent = value;
      else if (value) dd.appendChild(value);
      list.appendChild(dd);
    }
    addDef("Qualification", DEFENSE_LABELS[entry.niveau_defense] || entry.niveau_defense);
    addDef("Justification", entry.justification);
    addDef("Nature de la preuve", entry.nature_preuve);
    addDef("Niveau de confiance", entry.niveau_confiance);
    fragment.appendChild(list);

    if (entry.niveau_defense === "administration_defense") {
      var warning = el("p", "naf-callout");
      warning.appendChild(el("strong", null, "À ne pas confondre. "));
      warning.appendChild(document.createTextNode(
        "Ce code désigne les activités d'administration et de défense nationale, " +
        "c'est-à-dire la sphère publique. Ce n'est pas le code NAF des entreprises " +
        "de l'industrie de Défense."));
      fragment.appendChild(warning);
    }

    if (entry.commentaire) {
      fragment.appendChild(el("p", "naf-sheet-text", entry.commentaire));
    }
    return fragment;
  }

  function sourcesBlock(node, row) {
    var list = el("dl", "naf-deflist");

    list.appendChild(el("dt", null, "Fiche officielle"));
    var dd = el("dd");
    var link = inseeLink(node, "insee.fr ↗");
    if (link) dd.appendChild(link);
    else dd.textContent = "—";
    list.appendChild(dd);

    if (row.source_reference) {
      list.appendChild(el("dt", null, "Référence"));
      list.appendChild(el("dd", null, row.source_reference));
    }

    var fragment = document.createDocumentFragment();
    fragment.appendChild(list);
    fragment.appendChild(el("p", "naf-sheet-text naf-sheet-muted",
      "Les liens pointent vers la fiche de métadonnées Insee de la nomenclature " +
      "affichée. Une fiche NAF 2025 et une fiche NAF rév.2 ne décrivent pas la " +
      "même activité, même à code identique."));
    return fragment;
  }

  /* ═══════════════════════════════════════════════════════════════════
     Recherche
  ═══════════════════════════════════════════════════════════════════ */

  function renderResults() {
    clear(dom.results);
    if (!state.query) {
      dom.results.hidden = true;
      return;
    }
    dom.results.hidden = false;

    if (!state.results.length) {
      dom.results.appendChild(el("p", "naf-results-empty",
        "Aucun résultat pour « " + state.query + " »."));
      return;
    }

    dom.results.appendChild(el("p", "naf-results-count",
      state.results.length === 1
        ? "1 résultat"
        : state.results.length + " résultats"));

    var list = el("div", "naf-results-list");
    state.results.forEach(function (entry) {
      var button = el("button", "naf-result");
      button.type = "button";

      var top = el("span", "naf-result-top");
      top.appendChild(el("span", "naf-result-code", entry.node.code));
      top.appendChild(el("span", "naf-result-label", entry.node.label));
      button.appendChild(top);

      var meta = el("span", "naf-result-meta");
      meta.appendChild(el("span", "naf-result-level",
        LEVEL_LABELS[entry.node.level] + " · " + NAF.VERSIONS[state.versionId].shortLabel));
      meta.appendChild(el("span", "naf-result-path",
        entry.path.map(function (n) { return n.code; }).join(" › ")));
      button.appendChild(meta);
      button.setAttribute("aria-label",
        entry.node.code + ", " + entry.node.label + ", " +
        LEVEL_LABELS[entry.node.level] + ", " + NAF.VERSIONS[state.versionId].shortLabel);

      button.addEventListener("click", function () {
        closeSearch();
        setStack(entry.path.slice());
      });
      list.appendChild(button);
    });
    dom.results.appendChild(list);
  }

  function runSearch(query) {
    state.query = query.trim();
    state.results = state.nomenclature
      ? NAF.search(state.nomenclature.entries, state.query, 40)
      : [];
    dom.app.dataset.view = state.query ? "search" : "browse";
    dom.searchClear.hidden = !state.query;
    renderResults();
  }

  function closeSearch() {
    dom.search.value = "";
    runSearch("");
  }

  /* ═══════════════════════════════════════════════════════════════════
     Transitions d'état
  ═══════════════════════════════════════════════════════════════════ */

  function select(levelIndex, node) {
    var next = state.stack.slice(0, levelIndex);
    next.push(node);
    setStack(next);
  }

  function setStack(stack, options) {
    state.stack = stack;
    dom.app.dataset.depth = String(stack.length);
    renderColumns();
    renderCrumbs();
    renderMobileBar();
    renderSheet();
    if (!options || options.updateUrl !== false) updateUrl();
    if (!options || options.scroll !== false) scrollToTopOfApp();
  }

  function scrollToTopOfApp() {
    // Sur mobile chaque niveau est un écran : on repart du haut de la liste.
    if (!window.matchMedia("(max-width: 860px)").matches) return;
    var top = dom.app.getBoundingClientRect().top + window.scrollY - 8;
    var behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";
    window.scrollTo({ top: Math.max(top, 0), behavior: behavior });
  }

  function updateUrl() {
    var params = new URLSearchParams();
    params.set("v", state.versionId);
    var node = deepest();
    if (node) params.set("code", node.code);
    var url = window.location.pathname + "?" + params.toString();
    window.history.replaceState(null, "", url);
  }

  /* ═══════════════════════════════════════════════════════════════════
     Compteurs
  ═══════════════════════════════════════════════════════════════════ */

  function renderCounts() {
    clear(dom.counts);
    if (!state.nomenclature) return;
    var counts = state.nomenclature.counts;

    var full = el("span", "naf-counts-full", NAF.formatCounts(counts, false));
    var compact = el("span", "naf-counts-compact", NAF.formatCounts(counts, true));
    dom.counts.appendChild(full);
    dom.counts.appendChild(compact);
  }

  /* ═══════════════════════════════════════════════════════════════════
     Chargement d'une version
  ═══════════════════════════════════════════════════════════════════ */

  function setVersionButtons() {
    Array.prototype.forEach.call(dom.versions, function (button) {
      var isCurrent = button.dataset.version === state.versionId;
      button.setAttribute("aria-checked", isCurrent ? "true" : "false");
      button.classList.toggle("is-current", isCurrent);
      button.tabIndex = isCurrent ? 0 : -1;
    });
  }

  function loadVersion(versionId, wantedCode) {
    state.versionId = versionId;
    setVersionButtons();
    dom.error.hidden = true;
    dom.counts.textContent = "Chargement de la nomenclature…";

    return NAF.loadNomenclature(versionId).then(function (nomenclature) {
      state.nomenclature = nomenclature;
      renderCounts();

      var stack = [];
      if (wantedCode) {
        var node = NAF.findByCode(nomenclature, wantedCode);
        if (node) stack = NAF.pathOf(node);
      }
      // Pas de défilement automatique à l'arrivée : la page doit s'ouvrir
      // sur son titre, pas déjà repositionnée sous la barre d'outils.
      setStack(stack, { scroll: false });

      // La recherche courante doit suivre le changement de nomenclature.
      if (state.query) runSearch(state.query);

      loadAuxiliaryData();
    }).catch(function (error) {
      state.nomenclature = null;
      dom.counts.textContent = "";
      dom.error.hidden = false;
      dom.error.textContent =
        "Impossible de charger la nomenclature (" + error.message + "). " +
        "Rechargez la page ; si le problème persiste, les fichiers de données " +
        "ne sont pas accessibles.";
      clear(dom.columns);
      dom.sheet.hidden = true;
    });
  }

  function loadAuxiliaryData() {
    if (corresp === null) {
      NAF.loadCorrespondances().then(function (rows) {
        corresp = rows;
        if (!dom.sheet.hidden) renderSheet();
      }).catch(function () {
        corresp = [];
      });
    }
    if (defense === null) {
      NAF.loadDefense().then(function (rows) {
        defense = rows;
        renderColumns();
        if (!dom.sheet.hidden) renderSheet();
      }).catch(function () {
        defense = [];
      });
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     Navigation au clavier dans les colonnes
  ═══════════════════════════════════════════════════════════════════ */

  function handleColumnKeys(event) {
    var row = event.target.closest(".naf-row");
    if (!row) return;

    var column = row.closest(".naf-col");
    var rows = Array.prototype.slice.call(column.querySelectorAll(".naf-row"));
    var index = rows.indexOf(row);
    var target = null;

    if (event.key === "ArrowDown") target = rows[index + 1];
    else if (event.key === "ArrowUp") target = rows[index - 1];
    else if (event.key === "Home") target = rows[0];
    else if (event.key === "End") target = rows[rows.length - 1];
    else if (event.key === "ArrowRight") {
      var nextColumn = column.nextElementSibling;
      if (nextColumn) target = nextColumn.querySelector(".naf-row.is-selected, .naf-row");
    } else if (event.key === "ArrowLeft") {
      var previousColumn = column.previousElementSibling;
      if (previousColumn) target = previousColumn.querySelector(".naf-row.is-selected, .naf-row");
    }

    if (target) {
      event.preventDefault();
      target.focus();
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     Câblage
  ═══════════════════════════════════════════════════════════════════ */

  dom.searchForm.addEventListener("submit", function (event) {
    event.preventDefault();
    if (state.results.length) {
      var first = state.results[0];
      closeSearch();
      setStack(first.path.slice());
    }
  });

  dom.search.addEventListener("input", NAF.debounce(function () {
    runSearch(dom.search.value);
  }, 120));

  dom.search.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeSearch();
  });

  dom.searchClear.addEventListener("click", function () {
    closeSearch();
    dom.search.focus();
  });

  Array.prototype.forEach.call(dom.versions, function (button) {
    button.addEventListener("click", function () {
      if (button.dataset.version === state.versionId) return;
      loadVersion(button.dataset.version, null);
    });
  });

  dom.columns.addEventListener("keydown", handleColumnKeys);

  // Le bouton retour du navigateur doit refermer la fiche, pas quitter la page.
  window.addEventListener("popstate", function () {
    applyUrl();
  });

  function applyUrl() {
    var params = new URLSearchParams(window.location.search);
    var versionId = params.get("v") === "2008" ? "2008" : "2025";
    var code = params.get("code");
    var query = params.get("q");

    if (query) {
      dom.search.value = query;
    }

    loadVersion(versionId, code).then(function () {
      if (query) runSearch(query);
    });
  }

  applyUrl();
})();
