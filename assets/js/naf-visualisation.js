/**
 * naf-visualisation.js
 * Voyage visuel dans la NAF : icicle (partition) zoomable, construit avec D3
 * à partir des mêmes CSV que l'Explorer (naf-core.js reste la seule couche
 * de données).
 *
 * Pourquoi une icicle plutôt qu'un sunburst : les cinq niveaux de la NAF se
 * lisent en colonnes, exactement comme dans l'Explorer classique ; les
 * libellés restent horizontaux donc lisibles ; et le geste « cliquer pour
 * plonger » fonctionne aussi bien au doigt qu'à la souris.
 *
 * État :
 *   versionId  "2025" | "2008"
 *   focus      nœud d3 qui occupe la colonne de gauche (zoom courant)
 *   selected   nœud d3 sélectionné (panneau + contour), peut être une feuille
 *
 * La surface de chaque rectangle est proportionnelle au nombre de
 * sous-classes de la branche : on « sent » le poids relatif des familles.
 */
(function () {
  "use strict";

  var NAF = window.NAF;
  var d3 = window.d3;

  var app = document.getElementById("naf-viz");
  if (!app || !d3) return;

  var dom = {
    app: app,
    searchForm: document.getElementById("naf-viz-searchbox"),
    search: document.getElementById("naf-viz-q"),
    searchClear: document.getElementById("naf-viz-clear"),
    versions: app.querySelectorAll(".naf-version"),
    counts: document.getElementById("naf-viz-counts"),
    results: document.getElementById("naf-viz-results"),
    crumbs: document.getElementById("naf-viz-crumbs"),
    reset: document.getElementById("naf-viz-reset"),
    chart: document.getElementById("naf-viz-chart"),
    hint: document.getElementById("naf-viz-hint"),
    panel: document.getElementById("naf-viz-panel"),
    error: document.getElementById("naf-viz-error"),
    tooltip: document.getElementById("naf-viz-tooltip"),
  };

  /* ─────────────────────────────────────────────────────────────────────
     Palette
     22 teintes sourdes (vert minéral, pétrole, bleu nuit, cuivre, olive,
     terre, ardoise, sable…), luminosité alternée sombre/claire pour que
     deux sections voisines restent distinguables, y compris en vision des
     couleurs déficiente. Validée hors ligne (bande L 0.43–0.77, chroma
     ≥ 0.10, ΔE adjacents ≥ 15 en vision normale). Les descendants d'une
     section reprennent sa teinte, éclaircie à chaque niveau : une
     sous-classe « appartient » visiblement à sa grande famille.
  ───────────────────────────────────────────────────────────────────── */

  var SECTION_COLORS = [
    "#2a7449", "#c08e43", "#2a669f", "#cc8553", "#017a5d", "#9c9e51",
    "#934c3a", "#43a6c3", "#46712b", "#d28063", "#006e9e", "#69aa77",
    "#925019", "#5aa0d0", "#676815", "#ca874e", "#007096", "#84a561",
    "#984742", "#38abb1", "#796006", "#d37d6f",
  ];
  var ROOT_COLOR = "#33475f";
  // Éclaircissement vers le papier selon la profondeur (1 = section).
  var DEPTH_TINT = [0, 0, 0.22, 0.4, 0.56, 0.7];

  function mixWithWhite(hex, t) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    r = Math.round(r + (250 - r) * t);
    g = Math.round(g + (250 - g) * t);
    b = Math.round(b + (249 - b) * t);
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  function luminance(hex, t) {
    function chan(v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    r = r + (250 - r) * t; g = g + (250 - g) * t; b = b + (249 - b) * t;
    return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
  }

  /* ─────────────────────────────────────────────────────────────────────
     État
  ───────────────────────────────────────────────────────────────────── */

  var state = {
    versionId: "2025",
    nomenclature: null,
    root: null,        // hiérarchie d3
    focus: null,
    selected: null,
    byKey: null,       // "level:code" → nœud d3
    query: "",
    results: [],
  };

  var el = NAF.el;
  var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)");
  var HOVER_FINE = window.matchMedia("(hover: hover) and (pointer: fine)");

  function duration() { return REDUCED.matches ? 0 : 420; }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function sectionIndexOf(node) {
    var a = node.ancestors();           // node → … → racine
    var section = a[a.length - 2];      // profondeur 1
    if (!section) return -1;
    return state.root.children.indexOf(section);
  }

  function fillOf(node) {
    if (node.depth === 0) return ROOT_COLOR;
    var index = sectionIndexOf(node);
    var base = SECTION_COLORS[index % SECTION_COLORS.length] || ROOT_COLOR;
    var t = DEPTH_TINT[Math.min(node.depth, DEPTH_TINT.length - 1)];
    // Légère alternance entre voisins d'une même fratrie, en plus du liseré.
    if (node.depth > 1 && node.parent) {
      var i = node.parent.children.indexOf(node);
      if (i % 2 === 1) t = Math.min(t + 0.07, 0.8);
    }
    return mixWithWhite(base, t);
  }

  function inkFor(node) {
    if (node.depth === 0) return "#ffffff";
    var index = sectionIndexOf(node);
    var base = SECTION_COLORS[index % SECTION_COLORS.length] || ROOT_COLOR;
    var t = DEPTH_TINT[Math.min(node.depth, DEPTH_TINT.length - 1)];
    if (node.depth > 1 && node.parent && node.parent.children.indexOf(node) % 2 === 1) {
      t = Math.min(t + 0.07, 0.8);
    }
    return luminance(base, t) > 0.32 ? "#14181d" : "#ffffff";
  }

  /* ─────────────────────────────────────────────────────────────────────
     Compteurs de descendants (pour tooltip et panneau)
  ───────────────────────────────────────────────────────────────────── */

  function levelCounts(node) {
    var counts = {};
    node.descendants().forEach(function (d) {
      if (d === node || !d.data.level || d.data.level === "root") return;
      counts[d.data.level] = (counts[d.data.level] || 0) + 1;
    });
    return NAF.LEVELS
      .filter(function (level) { return counts[level]; })
      .map(function (level) {
        var n = counts[level];
        return n + " " + (n > 1 ? NAF.LEVEL_PLURALS[level]
                                : NAF.LEVEL_LABELS[level].toLowerCase());
      });
  }

  function ancestorList(node) {
    return node.ancestors().reverse().slice(1, -1); // sans racine ni le nœud
  }

  /* ─────────────────────────────────────────────────────────────────────
     Mise en page
  ───────────────────────────────────────────────────────────────────── */

  var layout = { width: 0, height: 0, colW: 0, visibleCols: 3 };
  var svg = null, cellGroups = null;

  function computeLayout() {
    var w = dom.chart.clientWidth || 320;
    var isNarrow = w < 700;
    layout.width = w;
    layout.height = isNarrow
      ? Math.max(430, Math.min(540, window.innerHeight - 260))
      : Math.max(480, Math.min(660, window.innerHeight - 240));
    layout.visibleCols = isNarrow ? 3 : 6;
    layout.colW = layout.width / layout.visibleCols;
  }

  function buildHierarchy() {
    var version = NAF.VERSIONS[state.versionId];
    var rootData = {
      code: version.shortLabel,
      label: "Toute l'économie",
      level: "root",
      children: state.nomenclature.roots,
    };
    var root = d3.hierarchy(rootData, function (d) { return d.children; })
      .sum(function (d) { return d.children && d.children.length ? 0 : 1; });

    state.root = root;
    state.byKey = new Map();
    root.descendants().forEach(function (d) {
      if (d.data.level && d.data.level !== "root") {
        state.byKey.set(d.data.level + ":" + d.data.code, d);
      }
    });
  }

  function partition() {
    d3.partition()
      .size([layout.height, (state.root.height + 1) * layout.colW])(state.root);
    state.root.each(function (d) {
      d.current = { x0: d.x0, x1: d.x1, y0: d.y0, y1: d.y1 };
    });
  }

  function rectHeight(g) {
    return Math.max(0, g.x1 - g.x0 - Math.min(1, (g.x1 - g.x0) / 2));
  }

  function labelVisible(g) {
    return g.y0 >= -1 && g.y0 < layout.width - 4 && g.x1 - g.x0 > 15;
  }

  function labelText(node, g) {
    var maxChars = Math.floor((g.y1 - g.y0 - 20) / 6.4);
    var code = node.data.code;
    if (g.x1 - g.x0 < 30 || maxChars <= code.length + 3) return code;
    var label = node.data.label || "";
    var room = maxChars - code.length - 1;
    if (label.length > room) label = label.slice(0, Math.max(room - 1, 0)) + "…";
    return code + "  " + label;
  }

  /* ─────────────────────────────────────────────────────────────────────
     Rendu SVG
  ───────────────────────────────────────────────────────────────────── */

  function renderChart() {
    clear(dom.chart);
    computeLayout();
    partition();

    var version = NAF.VERSIONS[state.versionId];
    svg = d3.create("svg")
      .attr("viewBox", [0, 0, layout.width, layout.height])
      .attr("width", layout.width)
      .attr("height", layout.height)
      .attr("role", "img")
      .attr("aria-label",
        "Vue hiérarchique de la " + version.longLabel + " : " +
        NAF.formatCounts(state.nomenclature.counts, false) +
        ". Cliquer sur une branche zoome dessus ; le détail du nœud " +
        "sélectionné est lu dans le panneau ci-contre. La même hiérarchie " +
        "est disponible sous forme de liste dans l'Explorer.");

    cellGroups = svg.append("g")
      .selectAll("g")
      .data(state.root.descendants())
      .join("g")
      .attr("transform", function (d) {
        return "translate(" + d.current.y0 + "," + d.current.x0 + ")";
      });

    cellGroups.append("rect")
      .attr("width", function (d) { return d.current.y1 - d.current.y0 - 1; })
      .attr("height", function (d) { return rectHeight(d.current); })
      .attr("rx", 2)
      .attr("fill", function (d) { return fillOf(d); })
      .attr("class", "naf-viz-cell")
      .style("cursor", "pointer")
      .on("click", clicked)
      .on("mousemove", HOVER_FINE.matches ? moved : null)
      .on("mouseleave", HOVER_FINE.matches ? left : null)
      .append("title")
      .text(function (d) {
        return d.data.code + (d.data.label ? " — " + d.data.label : "");
      });

    cellGroups.append("text")
      .attr("class", "naf-viz-label")
      .attr("x", 7)
      .attr("y", function (d) {
        var h = rectHeight(d.current);
        return h > 26 ? 17 : h / 2 + 4;
      })
      .attr("fill", function (d) { return inkFor(d); })
      .attr("pointer-events", "none")
      .style("display", function (d) {
        return labelVisible(d.current) ? null : "none";
      })
      .text(function (d) { return labelText(d, d.current); });

    dom.chart.appendChild(svg.node());
    applySelectionStyle();
  }

  /* ─────────────────────────────────────────────────────────────────────
     Zoom
  ───────────────────────────────────────────────────────────────────── */

  function zoomTo(p, animate) {
    state.focus = p;
    if (p !== state.root) dom.app.dataset.zoomed = "1";

    // Moins il reste de niveaux sous le focus, plus les colonnes s'élargissent :
    // la scène reste pleine au lieu de laisser la moitié droite vide.
    var remaining = state.root.height + 1 - p.depth;
    var k = layout.width / (Math.min(remaining, layout.visibleCols) * layout.colW);

    state.root.each(function (d) {
      d.target = {
        x0: (d.x0 - p.x0) / (p.x1 - p.x0) * layout.height,
        x1: (d.x1 - p.x0) / (p.x1 - p.x0) * layout.height,
        y0: (d.y0 - p.y0) * k,
        y1: (d.y1 - p.y0) * k,
      };
    });

    var t = svg.transition().duration(animate === false ? 0 : duration());

    cellGroups.transition(t)
      .attr("transform", function (d) {
        return "translate(" + d.target.y0 + "," + d.target.x0 + ")";
      })
      .on("end", function (d) { d.current = d.target; });

    cellGroups.select("rect").transition(t)
      .attr("width", function (d) { return Math.max(0, d.target.y1 - d.target.y0 - 1); })
      .attr("height", function (d) { return rectHeight(d.target); });

    cellGroups.select("text").transition(t)
      .attr("y", function (d) {
        var h = rectHeight(d.target);
        return h > 26 ? 17 : h / 2 + 4;
      })
      .style("display", function (d) {
        return labelVisible(d.target) ? null : "none";
      })
      .text(function (d) { return labelText(d, d.target); });
  }

  // Le zoom ne descend jamais plus bas que le groupe : à ce niveau, classes
  // et sous-classes sont déjà largement lisibles, et zoomer plus loin
  // viderait l'écran (une classe n'a souvent qu'une ou deux sous-classes).
  var MAX_FOCUS_DEPTH = 3;

  function focusFor(node) {
    if (!node) return state.root;
    var target = node.children ? node : node.parent || state.root;
    while (target.depth > MAX_FOCUS_DEPTH) target = target.parent;
    return target;
  }

  function clicked(event, p) {
    hideTooltip();
    if (p === state.focus) {
      // Cliquer la colonne de gauche remonte d'un cran.
      var up = p.parent || p;
      setSelection(up === state.root ? null : up, up);
      return;
    }
    setSelection(p, focusFor(p));
  }

  /** Point d'entrée unique : met à jour sélection, zoom, panneau, URL. */
  function setSelection(selected, focusNode, options) {
    state.selected = selected;
    zoomTo(focusNode || state.root, options ? options.animate : undefined);
    renderCrumbs();
    renderPanel();
    applySelectionStyle();
    if (!options || options.updateUrl !== false) updateUrl();
  }

  function applySelectionStyle() {
    if (!cellGroups) return;
    cellGroups.select("rect")
      .attr("stroke", function (d) { return d === state.selected ? "#14181d" : null; })
      .attr("stroke-width", function (d) { return d === state.selected ? 2 : null; })
      .attr("aria-current", function (d) { return d === state.selected ? "true" : null; });
  }

  function resetView() {
    setSelection(null, state.root);
  }

  /* ─────────────────────────────────────────────────────────────────────
     Tooltip (survol, uniquement pointeur fin — jamais porteur exclusif
     d'information : tout est aussi dans le panneau au clic)
  ───────────────────────────────────────────────────────────────────── */

  function moved(event, d) {
    if (d.depth === 0) { hideTooltip(); return; }
    var tip = dom.tooltip;
    clear(tip);
    tip.hidden = false;

    tip.appendChild(el("p", "naf-viz-tip-code naf-mono", d.data.code));
    tip.appendChild(el("p", "naf-viz-tip-label", d.data.label));
    tip.appendChild(el("p", "naf-viz-tip-meta",
      NAF.LEVEL_LABELS[d.data.level] + " · " + NAF.VERSIONS[state.versionId].shortLabel));

    var parents = ancestorList(d);
    if (parents.length) {
      var lines = el("p", "naf-viz-tip-parents");
      parents.forEach(function (a) {
        var line = el("span", "naf-viz-tip-parent");
        line.appendChild(el("span", "naf-mono", a.data.code));
        line.appendChild(document.createTextNode(" · " + a.data.label));
        lines.appendChild(line);
      });
      tip.appendChild(lines);
    }

    var counts = levelCounts(d);
    if (counts.length) {
      tip.appendChild(el("p", "naf-viz-tip-counts", counts.join(" · ")));
    }

    var pad = 14;
    var rect = dom.app.getBoundingClientRect();
    var x = event.clientX - rect.left + pad;
    var y = event.clientY - rect.top + pad;
    var maxX = rect.width - tip.offsetWidth - 8;
    if (x > maxX) x = Math.max(8, event.clientX - rect.left - tip.offsetWidth - pad);
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }

  function left() { hideTooltip(); }
  function hideTooltip() { dom.tooltip.hidden = true; }

  /* ─────────────────────────────────────────────────────────────────────
     Fil d'Ariane
  ───────────────────────────────────────────────────────────────────── */

  function renderCrumbs() {
    clear(dom.crumbs);
    var head = state.selected || state.focus;
    var path = head.ancestors().reverse();

    path.forEach(function (node, index) {
      if (index) {
        var sep = el("span", "naf-viz-crumb-sep", "›");
        sep.setAttribute("aria-hidden", "true");
        dom.crumbs.appendChild(sep);
      }
      var button = el("button", "naf-viz-crumb",
        node.depth === 0 ? node.data.code : node.data.code);
      button.type = "button";
      button.title = node.data.label || "";
      if (index === path.length - 1) button.setAttribute("aria-current", "true");
      button.addEventListener("click", function () {
        if (node.depth === 0) resetView();
        else setSelection(node, focusFor(node));
      });
      dom.crumbs.appendChild(button);
    });

    dom.reset.hidden = state.focus === state.root && !state.selected;
  }

  /* ─────────────────────────────────────────────────────────────────────
     Panneau pédagogique
  ───────────────────────────────────────────────────────────────────── */

  function renderPanel() {
    clear(dom.panel);
    var version = NAF.VERSIONS[state.versionId];
    var node = state.selected;

    dom.panel.appendChild(el("p", "naf-viz-panel-kicker", "Vous regardez"));

    if (!node) {
      dom.panel.appendChild(el("p", "naf-viz-panel-code naf-mono", version.shortLabel));
      dom.panel.appendChild(el("p", "naf-viz-panel-label", "Toute l'économie"));
      var sections = state.root.children.length;
      var hand = el("p", "naf-hand naf-viz-panel-hand",
        "« " + sections + " portes d'entrée »");
      hand.setAttribute("aria-hidden", "true");
      dom.panel.appendChild(hand);
      dom.panel.appendChild(el("p", "naf-viz-panel-counts",
        levelCounts(state.root).join(" · ")));
      dom.panel.appendChild(el("p", "naf-viz-panel-help",
        "Cliquez sur une section pour zoomer dedans, puis descendez de " +
        "niveau en niveau. Cliquer sur la colonne de gauche remonte d'un cran."));
      var browse = el("a", "naf-viz-panel-cta", "Ouvrir l'Explorer");
      browse.href = "index.html?v=" + state.versionId;
      dom.panel.appendChild(browse);
      return;
    }

    var swatch = el("p", "naf-viz-panel-code naf-mono", node.data.code);
    swatch.style.borderLeftColor = fillOf(node.depth > 1 ? node.ancestors()[node.ancestors().length - 2] : node);
    dom.panel.appendChild(swatch);
    dom.panel.appendChild(el("p", "naf-viz-panel-label", node.data.label));
    dom.panel.appendChild(el("p", "naf-viz-panel-meta",
      NAF.LEVEL_LABELS[node.data.level] + " · " + version.longLabel));

    var parents = ancestorList(node);
    if (parents.length) {
      dom.panel.appendChild(el("p", "naf-viz-panel-section", "Appartient à"));
      var list = el("ul", "naf-viz-panel-parents");
      parents.forEach(function (a) {
        var item = el("li");
        var button = el("button", "naf-viz-panel-parent");
        button.type = "button";
        button.appendChild(el("span", "naf-mono", a.data.code));
        button.appendChild(el("span", null, a.data.label));
        button.addEventListener("click", function () {
          setSelection(a, focusFor(a));
        });
        item.appendChild(button);
        list.appendChild(item);
      });
      dom.panel.appendChild(list);
    }

    var counts = levelCounts(node);
    if (counts.length) {
      dom.panel.appendChild(el("p", "naf-viz-panel-section", "Contient"));
      dom.panel.appendChild(el("p", "naf-viz-panel-counts", counts.join(" · ")));
    }

    var cta = el("a", "naf-viz-panel-cta",
      node.data.level === "subclass" ? "Voir la fiche dans l'Explorer" : "Voir dans l'Explorer");
    cta.href = "index.html?v=" + state.versionId +
      "&code=" + encodeURIComponent(node.data.code);
    dom.panel.appendChild(cta);
  }

  /* ─────────────────────────────────────────────────────────────────────
     Recherche (mêmes règles que l'Explorer : accents, casse, points)
  ───────────────────────────────────────────────────────────────────── */

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
        NAF.LEVEL_LABELS[entry.node.level] + " · " + NAF.VERSIONS[state.versionId].shortLabel));
      meta.appendChild(el("span", "naf-result-path",
        entry.path.map(function (n) { return n.code; }).join(" › ")));
      button.appendChild(meta);

      button.addEventListener("click", function () {
        closeSearch();
        var target = state.byKey.get(entry.node.level + ":" + entry.node.code);
        if (target) {
          setSelection(target, focusFor(target));
        }
      });
      list.appendChild(button);
    });
    dom.results.appendChild(list);
  }

  function runSearch(query) {
    state.query = query.trim();
    state.results = state.nomenclature
      ? NAF.search(state.nomenclature.entries, state.query, 30)
      : [];
    dom.searchClear.hidden = !state.query;
    renderResults();
  }

  function closeSearch() {
    dom.search.value = "";
    runSearch("");
  }

  /* ─────────────────────────────────────────────────────────────────────
     URL & compteurs
  ───────────────────────────────────────────────────────────────────── */

  function updateUrl() {
    var params = new URLSearchParams();
    params.set("v", state.versionId);
    if (state.selected) params.set("code", state.selected.data.code);
    window.history.replaceState(null, "",
      window.location.pathname + "?" + params.toString());
  }

  function renderCounts() {
    clear(dom.counts);
    if (!state.nomenclature) return;
    var counts = state.nomenclature.counts;
    dom.counts.appendChild(el("span", "naf-counts-full", NAF.formatCounts(counts, false)));
    dom.counts.appendChild(el("span", "naf-counts-compact", NAF.formatCounts(counts, true)));
  }

  /* ─────────────────────────────────────────────────────────────────────
     Chargement d'une version
  ───────────────────────────────────────────────────────────────────── */

  function setVersionButtons() {
    Array.prototype.forEach.call(dom.versions, function (button) {
      var isCurrent = button.dataset.version === state.versionId;
      button.setAttribute("aria-checked", isCurrent ? "true" : "false");
      button.classList.toggle("is-current", isCurrent);
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
      buildHierarchy();
      renderChart();

      var target = null;
      if (wantedCode) {
        var flat = NAF.findByCode(nomenclature, wantedCode);
        if (flat) target = state.byKey.get(flat.level + ":" + flat.code);
      }
      if (target) {
        setSelection(target, focusFor(target), { animate: false });
      } else {
        setSelection(null, state.root, { animate: false, updateUrl: !!wantedCode });
        if (!wantedCode) updateUrl();
      }
      if (state.query) runSearch(state.query);
    }).catch(function (error) {
      dom.counts.textContent = "";
      dom.error.hidden = false;
      dom.error.textContent =
        "Impossible de charger la nomenclature (" + error.message + "). " +
        "Rechargez la page ; si le problème persiste, les fichiers de " +
        "données ne sont pas accessibles.";
      clear(dom.chart);
      clear(dom.panel);
    });
  }

  /* ─────────────────────────────────────────────────────────────────────
     Câblage
  ───────────────────────────────────────────────────────────────────── */

  dom.searchForm.addEventListener("submit", function (event) {
    event.preventDefault();
    if (state.results.length) {
      var first = state.results[0];
      closeSearch();
      var target = state.byKey.get(first.node.level + ":" + first.node.code);
      if (target) setSelection(target, focusFor(target));
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
      dom.app.dataset.zoomed = "0";
      loadVersion(button.dataset.version, null);
    });
  });

  dom.reset.addEventListener("click", resetView);

  // Redimensionnement : on reconstruit la scène en conservant l'état.
  window.addEventListener("resize", NAF.debounce(function () {
    if (!state.nomenclature) return;
    var selectedKey = state.selected
      ? state.selected.data.level + ":" + state.selected.data.code : null;
    var focusKey = state.focus && state.focus !== state.root
      ? state.focus.data.level + ":" + state.focus.data.code : null;
    buildHierarchy();
    renderChart();
    var selected = selectedKey ? state.byKey.get(selectedKey) : null;
    var focusNode = focusKey ? state.byKey.get(focusKey) : state.root;
    setSelection(selected, focusNode || state.root,
      { animate: false, updateUrl: false });
  }, 200));

  window.addEventListener("popstate", applyUrl);

  function applyUrl() {
    var params = new URLSearchParams(window.location.search);
    var versionId = params.get("v") === "2008" ? "2008" : "2025";
    var code = params.get("code");
    var query = params.get("q");
    if (query) dom.search.value = query;
    loadVersion(versionId, code).then(function () {
      if (query) runSearch(query);
    });
  }

  applyUrl();
})();
