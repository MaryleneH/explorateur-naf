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
    treenote: document.getElementById("naf-viz-treenote"),
    pannote: document.getElementById("naf-viz-pannote"),
    zoomctrl: document.getElementById("naf-viz-zoomctrl"),
    zoomIn: document.getElementById("naf-viz-zoomin"),
    zoomOut: document.getElementById("naf-viz-zoomout"),
    zoomFit: document.getElementById("naf-viz-zoomfit"),
    gotoWrap: document.getElementById("naf-viz-goto-wrap"),
    goto: document.getElementById("naf-viz-goto"),
    viewButtons: app.querySelectorAll(".naf-view"),
    introModes: app.querySelectorAll(".naf-viz-intro-mode"),
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
    view: "structure", // "structure" (icicle) | "arbre" (métaphore)
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

  /** Point d'entrée unique : met à jour sélection, vue courante, panneau, URL. */
  function setSelection(selected, focusNode, options) {
    state.selected = selected;
    state.focus = focusNode || state.root;
    renderCrumbs();
    renderPanel();
    if (state.view === "arbre") {
      renderTree(options);
    } else {
      zoomTo(state.focus, options ? options.animate : undefined);
      applySelectionStyle();
    }
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
     Vue « Arbre »

     Métaphore : le focus courant est le tronc, ses enfants sont des
     branches déployées en éventail, ses petits-enfants des rameaux — et
     lorsque ceux-ci sont des sous-classes, des feuilles stylisées.
     La géométrie découle entièrement de la hiérarchie (part de
     sous-classes = ouverture angulaire et épaisseur), les couleurs sont
     celles des sections. À chaque sélection, la scène est reconstruite :
     au plus ~150 éléments, le re-rendu complet reste instantané.
  ───────────────────────────────────────────────────────────────────── */

  // Variation déterministe (pas de Math.random : le rendu doit être stable).
  function wobble(i, j) {
    return (((i * 53 + (j || 0) * 29) % 17) / 17) - 0.5;
  }

  /* ── Caméra : pan + zoom D3, indépendants de la sélection logique.
     Le transform s'applique au seul groupe racine ; le breadcrumb ne bouge
     jamais quand on déplace la caméra. Réinstallé à chaque re-rendu. ── */

  var treeCamera = { svg: null, g: null, zoom: null, height: 0 };
  var panNoteDismissed = false;

  function dismissPanNote() {
    if (panNoteDismissed) return;
    panNoteDismissed = true;
    if (dom.pannote) dom.pannote.hidden = true;
  }

  function installTreeCamera(svgT, g, height) {
    treeCamera.svg = svgT;
    treeCamera.g = g;
    treeCamera.height = height;

    treeCamera.zoom = d3.zoom()
      .scaleExtent([0.5, 5])
      .filter(function (event) {
        // Un doigt = scroll de page et tap ; le pan/zoom tactile se fait à
        // deux doigts, pour ne jamais piéger le défilement vertical.
        if (event.type === "touchstart" || event.type === "touchmove") {
          return event.touches.length > 1;
        }
        return !event.button;
      })
      .on("zoom", function (event) {
        g.attr("transform", event.transform);
        // Ne masquer l'indication que sur un geste réel de l'utilisateur,
        // pas sur les recadrages programmés (fit, boutons).
        if (event.sourceEvent) dismissPanNote();
      });

    svgT.call(treeCamera.zoom).on("dblclick.zoom", null);
    // d3.zoom pose touch-action: none ; pan-y rend le scroll une main possible.
    svgT.style("touch-action", "pan-y");
  }

  /** Cadre l'arbre entier (bounding box réelle, labels compris). */
  function fitTree(animate) {
    if (!treeCamera.svg || !treeCamera.g) return;
    var node = treeCamera.g.node();
    var bbox = node.getBBox();
    if (!bbox.width || !bbox.height) return;

    // Marge autour de l'arbre : les branches extrêmes ne collent pas au bord.
    var pad = layout.width < 700 ? 24 : 44;
    var w = layout.width;
    var h = treeCamera.height;
    var scale = Math.min(
      2,
      0.98 * Math.min(w / (bbox.width + pad * 2), h / (bbox.height + pad * 2))
    );
    var t = d3.zoomIdentity
      .translate(w / 2, h / 2)
      .scale(scale)
      .translate(-(bbox.x + bbox.width / 2), -(bbox.y + bbox.height / 2));

    var target = animate && !REDUCED.matches
      ? treeCamera.svg.transition().duration(duration())
      : treeCamera.svg;
    target.call(treeCamera.zoom.transform, t);
  }

  function cameraZoomBy(factor) {
    if (!treeCamera.svg) return;
    dismissPanNote();
    treeCamera.svg.transition().duration(200)
      .call(treeCamera.zoom.scaleBy, factor);
  }

  function onPath(node) {
    return state.selected && state.selected.ancestors().indexOf(node) !== -1;
  }

  function treeAriaLabel(version) {
    return "L'arbre de la " + version.longLabel + " : le tronc est le niveau " +
      "sélectionné, chaque branche un niveau inférieur, chaque feuille une " +
      "sous-classe. Les mêmes informations sont lisibles dans le panneau " +
      "de détail et dans l'Explorer en liste.";
  }

  function renderTree(options) {
    clear(dom.chart);
    computeLayout();
    var width = layout.width;
    var height = Math.max(layout.height, 460);
    var animate = !REDUCED.matches && !(options && options.animate === false);
    var version = NAF.VERSIONS[state.versionId];
    var focus = state.focus;
    var hasSelection = state.selected && state.selected !== focus;

    if (focus !== state.root) dom.app.dataset.zoomed = "1";

    var svgT = d3.create("svg")
      .attr("viewBox", [0, 0, width, height])
      .attr("width", width)
      .attr("height", height)
      .attr("role", "img")
      .attr("aria-label", treeAriaLabel(version));
    var g = svgT.append("g");

    var baseX = width / 2;
    var baseY = height - 12;
    var trunkTopY = height * 0.62;

    /* Tronc — cliquer le tronc remonte d'un cran. */
    var trunk = g.append("path")
      .attr("d", "M" + baseX + " " + baseY +
        " C " + (baseX - 5) + " " + (baseY - 40) +
        ", " + (baseX + 4) + " " + (trunkTopY + 46) +
        ", " + baseX + " " + trunkTopY)
      .attr("fill", "none")
      .attr("stroke", "#4a4f58")
      .attr("stroke-width", focus.depth === 0 ? 16 : 12)
      .attr("stroke-linecap", "round");
    if (focus.depth > 0) {
      trunk.style("cursor", "pointer").on("click", goUpTree);
      if (HOVER_FINE.matches) trunk.on("mousemove", moved).on("mouseleave", left).datum(focus);
    }

    /* Tronc typographique : le code du focus s'empile verticalement. */
    var trunkText = focus.depth === 0 ? "NAF" : focus.data.code;
    trunkText.split("").forEach(function (ch, i) {
      g.append("text")
        .attr("class", "naf-viz-trunk-char")
        .attr("x", baseX)
        .attr("y", trunkTopY + 26 + i * 15)
        .attr("text-anchor", "middle")
        .text(ch);
    });
    if (focus.depth === 0) {
      g.append("text")
        .attr("class", "naf-viz-trunk-year")
        .attr("x", baseX)
        .attr("y", baseY - 4)
        .attr("text-anchor", "middle")
        .text(state.versionId);
    }

    var children = focus.children || [];
    if (!children.length) { dom.chart.appendChild(svgT.node()); return; }

    var totalValue = d3.sum(children, function (c) { return c.value; }) || 1;
    var maxValue = d3.max(children, function (c) { return c.value; }) || 1;
    var totalGrand = d3.sum(children, function (c) { return (c.children || []).length; });
    var showGrand = totalGrand > 0 && totalGrand <= 130;
    var showGrandLabels = totalGrand > 0 && totalGrand <= 30;

    var spanDeg = Math.max(70, Math.min(158, children.length * 7 + 48));
    var span = (spanDeg * Math.PI) / 180;
    var startAngle = -span / 2;
    var acc = 0;
    // Les codes de branche sont dessinés en dernier, au-dessus des rameaux.
    var branchLabels = [];

    /* Couches explicites : le picking SVG suit l'ordre du DOM, donc les
       cibles du niveau que l'utilisateur est censé choisir (nœuds et codes
       des enfants directs) passent au-dessus des zones de clic des branches
       et des rameaux. Sans cela, deux hitbox voisines se recouvrent et la
       dernière dessinée capte tous les clics (c'est ce qui rendait U et P
       presque insélectionnables). */
    var layerBranches = g.append("g");
    var layerTwigs = g.append("g");
    var layerBranchHits = g.append("g");
    var layerTwigHits = g.append("g");
    var layerNodeHits = g.append("g");
    var layerLabels = g.append("g");

    function selectNode(node) {
      hideTooltip();
      setSelection(node, focusFor(node));
    }

    /* Retour visuel au survol d'une cible : la branche s'épaissit, sans
       jamais bouger (la géométrie reste stable sous le pointeur). */
    function bindHover(selection, branch, baseWidth, node) {
      selection
        .on("mouseenter", function () {
          branch.attr("stroke-width", baseWidth + 2.5);
        })
        .on("mouseleave", function () {
          branch.attr("stroke-width", baseWidth);
        });
      if (HOVER_FINE.matches) {
        selection.datum(node).on("mousemove", moved);
        selection.on("mouseleave.tip", left);
      }
    }

    // Part uniforme garantie dans l'ouverture angulaire : une section à
    // 3 sous-classes (U) restait collée à ses voisines quand le slot était
    // purement proportionnel. 55 % au poids, 45 % réparti également.
    var uniformSlot = span / children.length;

    children.forEach(function (child, i) {
      var slot = 0.55 * span * (child.value / totalValue) + 0.45 * uniformSlot;
      var a = startAngle + acc + slot / 2; // 0 = vertical, vers le haut
      acc += slot;

      var rx = width * 0.44 * (0.86 + 0.18 * wobble(i));
      var ry = (trunkTopY - 26) * (0.84 + 0.2 * wobble(i, 7));
      var tipX = baseX + rx * Math.sin(a);
      var tipY = trunkTopY - ry * Math.cos(a);
      var dx = tipX - baseX;

      var d = "M" + baseX + " " + trunkTopY +
        " C " + (baseX + 0.06 * dx) + " " + (trunkTopY - 0.45 * (trunkTopY - tipY)) +
        ", " + (baseX + 0.55 * dx) + " " + (tipY + 0.28 * (trunkTopY - tipY)) +
        ", " + tipX + " " + tipY;

      var sw = 3.5 + 12 * (child.value / maxValue);
      var color = fillOf(child);
      var active = !hasSelection || onPath(child);

      var baseWidth = onPath(child) && hasSelection ? sw + 2 : sw;
      var branch = layerBranches.append("path")
        .attr("d", d)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", baseWidth)
        .attr("stroke-linecap", "round")
        .attr("opacity", active ? 1 : 0.35)
        .attr("data-code", child.data.code)
        .attr("class", "naf-viz-branch");

      if (animate) {
        var len = branch.node().getTotalLength();
        branch
          .attr("stroke-dasharray", len + " " + len)
          .attr("stroke-dashoffset", len)
          .transition().duration(duration()).ease(d3.easeCubicOut)
          .attr("stroke-dashoffset", 0)
          .on("end", function () { branch.attr("stroke-dasharray", null); });
      }

      /* Nœud marqué au bout de la branche : ancre visuelle du clic. */
      layerTwigs.append("circle")
        .attr("cx", tipX).attr("cy", tipY)
        .attr("r", 4 + 2.5 * (child.value / maxValue))
        .attr("fill", color)
        .attr("stroke", "#fff")
        .attr("stroke-width", 1.4)
        .attr("opacity", active ? 1 : 0.4)
        .attr("pointer-events", "none");

      /* Zone de clic élargie le long de la branche (au doigt, la branche
         fine resterait ratable). */
      var hit = layerBranchHits.append("path")
        .attr("d", d)
        .attr("fill", "none")
        .attr("stroke", "transparent")
        .attr("stroke-width", Math.max(sw, 26))
        .style("cursor", "pointer")
        .attr("data-code", child.data.code)
        .datum(child)
        .on("click", function (event, node) { selectNode(node); });
      bindHover(hit, branch, baseWidth, child);

      /* Cible prioritaire : le nœud du bout de branche, au-dessus de tout
         (les enfants directs sont le niveau que l'on est censé choisir). */
      var nodeHit = layerNodeHits.append("circle")
        .attr("cx", tipX).attr("cy", tipY)
        .attr("r", focus.depth === 0 ? 26 : 20)
        .attr("fill", "transparent")
        .style("cursor", "pointer")
        .attr("data-code", child.data.code)
        .datum(child)
        .on("click", function (event, node) { selectNode(node); });
      bindHover(nodeHit, branch, baseWidth, child);

      branchLabels.push({
        x: tipX + 17 * Math.sin(a),
        y: tipY - 17 * Math.cos(a) + 4,
        anchor: Math.sin(a) > 0.25 ? "start" : Math.sin(a) < -0.25 ? "end" : "middle",
        opacity: active ? 1 : 0.4,
        text: child.data.code,
        node: child,
        branch: branch,
        baseWidth: baseWidth,
      });

      if (!showGrand || !child.children) return;

      var grand = child.children;
      var maxLeafValue = d3.max(grand, function (l) { return l.value || 1; }) || 1;
      var gspan = Math.min(Math.PI * 0.52, 0.22 + grand.length * 0.1);

      grand.forEach(function (leaf, j) {
        var ga = a + (grand.length === 1 ? 0.12 * wobble(i, j)
          : ((j / (grand.length - 1)) - 0.5) * gspan);
        var L = 30 + 40 * ((leaf.value || 1) / maxLeafValue) + 14 * wobble(i, j + 3);
        var ex = tipX + L * Math.sin(ga);
        var ey = tipY - L * Math.cos(ga);
        var leafColor = fillOf(leaf);
        var leafActive = !hasSelection || onPath(leaf);
        var isLeaf = leaf.data.level === "subclass";
        var isSelected = leaf === state.selected;

        var stem = layerTwigs.append("path")
          .attr("d", "M" + tipX + " " + tipY +
            " Q " + (tipX + 0.5 * (ex - tipX)) + " " + (tipY + 0.62 * (ey - tipY)) +
            ", " + ex + " " + ey)
          .attr("fill", "none")
          .attr("stroke", leafColor)
          .attr("stroke-width", isLeaf ? 2 : 2.5 + 2.5 * ((leaf.value || 1) / maxLeafValue))
          .attr("stroke-linecap", "round")
          .attr("opacity", leafActive ? 0.95 : 0.3);
        if (animate) stem.attr("opacity", 0)
          .transition().delay(duration() * 0.5).duration(duration() * 0.7)
          .attr("opacity", leafActive ? 0.95 : 0.3);

        var mark;
        if (isLeaf) {
          // Feuilles plus généreuses quand elles sont peu nombreuses.
          var lrx = grand.length <= 12 ? 13 : 9;
          mark = layerTwigs.append("ellipse")
            .attr("class", "naf-viz-leaf")
            .attr("cx", ex).attr("cy", ey)
            .attr("rx", lrx).attr("ry", lrx / 2)
            .attr("transform", "rotate(" + ((ga * 180) / Math.PI + 90) + " " + ex + " " + ey + ")")
            .attr("fill", leafColor)
            .attr("stroke", isSelected ? "#14181d" : "none")
            .attr("stroke-width", isSelected ? 2 : 0)
            .attr("opacity", leafActive ? 1 : 0.35);
        } else {
          mark = layerTwigs.append("circle")
            .attr("cx", ex).attr("cy", ey).attr("r", 3.2)
            .attr("fill", leafColor)
            .attr("opacity", leafActive ? 1 : 0.35);
        }
        mark
          .attr("data-code", leaf.data.code)
          .style("cursor", "pointer")
          .datum(leaf)
          .on("click", function (event, node) { selectNode(node); });
        if (HOVER_FINE.matches) mark.on("mousemove", moved).on("mouseleave", left);
        if (animate) mark.attr("opacity", 0)
          .transition().delay(duration() * 0.7).duration(duration() * 0.6)
          .attr("opacity", leafActive ? 1 : 0.35);

        /* Cible tactile invisible autour du rameau — sous les nœuds et
           labels des enfants directs, prioritaires. */
        layerTwigHits.append("circle")
          .attr("cx", ex).attr("cy", ey).attr("r", 15)
          .attr("fill", "transparent")
          .style("cursor", "pointer")
          .attr("data-code", leaf.data.code)
          .datum(leaf)
          .on("click", function (event, node) { selectNode(node); });

        if (showGrandLabels) {
          var lanchor = Math.sin(ga) > 0.2 ? "start" : Math.sin(ga) < -0.2 ? "end" : "middle";
          layerTwigs.append("text")
            .attr("class", "naf-viz-tree-leafcode")
            .attr("x", ex + 14 * Math.sin(ga))
            .attr("y", ey - 14 * Math.cos(ga) + 3)
            .attr("text-anchor", lanchor)
            .attr("opacity", leafActive ? 1 : 0.4)
            .text(leaf.data.code);
        }
      });
    });

    /* Les codes sont eux-mêmes des cibles : cliquer « U » sélectionne U. */
    branchLabels.forEach(function (label) {
      var text = layerLabels.append("text")
        .attr("class", "naf-viz-tree-code")
        .attr("x", label.x)
        .attr("y", label.y)
        .attr("text-anchor", label.anchor)
        .attr("opacity", label.opacity)
        .attr("data-code", label.text)
        .style("cursor", "pointer")
        .datum(label.node)
        .text(label.text)
        .on("click", function (event, node) { selectNode(node); });
      bindHover(text, label.branch, label.baseWidth, label.node);
    });

    dom.chart.appendChild(svgT.node());
    // Caméra : pan/zoom libres, puis cadrage automatique sur tout l'arbre —
    // aucune branche (U comprise) ne doit rester hors d'atteinte.
    installTreeCamera(svgT, g, height);
    fitTree(false);
    renderTreeNote();
  }

  function goUpTree() {
    hideTooltip();
    if (state.focus === state.root) return;
    var up = state.focus.parent || state.root;
    setSelection(up === state.root ? null : up, up);
  }

  function renderTreeNote() {
    var note = dom.treenote;
    if (!note) return;
    if (state.view !== "arbre") { note.hidden = true; return; }
    var depth = state.focus.depth;
    if (depth === 0) {
      note.textContent = "« choisissez une grande branche »";
    } else if (depth >= 3) {
      note.textContent = "« chaque feuille = une sous-classe »";
    } else {
      note.textContent = "« la branche se précise »";
    }
    note.hidden = false;
  }

  /* ─────────────────────────────────────────────────────────────────────
     Bascule Structure / Arbre
  ───────────────────────────────────────────────────────────────────── */

  function applyViewChrome() {
    dom.app.dataset.viewmode = state.view;
    Array.prototype.forEach.call(dom.viewButtons, function (button) {
      var isCurrent = button.dataset.view === state.view;
      button.classList.toggle("is-current", isCurrent);
      button.setAttribute("aria-checked", isCurrent ? "true" : "false");
    });
    Array.prototype.forEach.call(dom.introModes, function (mode) {
      mode.hidden = mode.dataset.mode !== state.view;
    });
    if (state.view !== "arbre" && dom.treenote) dom.treenote.hidden = true;
    if (dom.zoomctrl) dom.zoomctrl.hidden = state.view !== "arbre";
    if (dom.pannote) dom.pannote.hidden = state.view !== "arbre" || panNoteDismissed;
    if (dom.gotoWrap) dom.gotoWrap.hidden = state.view !== "arbre";
  }

  /* Filet de sécurité clavier et accessibilité : toutes les sections
     restent joignables même sans toucher l'arbre. */
  function renderGotoOptions() {
    if (!dom.goto || !state.root) return;
    clear(dom.goto);
    var placeholder = el("option", null, "Aller à une section…");
    placeholder.value = "";
    dom.goto.appendChild(placeholder);
    state.root.children.forEach(function (section) {
      var label = section.data.label || "";
      if (label.length > 44) label = label.slice(0, 43) + "…";
      var option = el("option", null, section.data.code + " — " + label);
      option.value = section.data.code;
      dom.goto.appendChild(option);
    });
  }

  function setView(view) {
    if (view === state.view) return;
    state.view = view;
    applyViewChrome();
    hideTooltip();
    if (!state.nomenclature) return;
    // L'état (focus + sélection) est partagé : la nouvelle vue reprend
    // exactement là où l'autre s'était arrêtée.
    if (view === "structure") renderChart();
    setSelection(state.selected, state.focus, { animate: view === "arbre" });
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
    if (state.view === "arbre") params.set("view", "arbre");
    if (state.selected) params.set("code", state.selected.data.code);
    // Préserver l'état d'un parcours guidé actif (naf-parcours.js).
    var current = new URLSearchParams(window.location.search);
    ["parcours", "etape"].forEach(function (key) {
      if (current.has(key)) params.set(key, current.get(key));
    });
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
      renderGotoOptions();
      if (state.view === "structure") renderChart();

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
    if (state.view === "structure") renderChart();
    var selected = selectedKey ? state.byKey.get(selectedKey) : null;
    var focusNode = focusKey ? state.byKey.get(focusKey) : state.root;
    setSelection(selected, focusNode || state.root,
      { animate: false, updateUrl: false });
  }, 200));

  window.addEventListener("popstate", applyUrl);

  Array.prototype.forEach.call(dom.viewButtons, function (button) {
    button.addEventListener("click", function () {
      setView(button.dataset.view === "arbre" ? "arbre" : "structure");
    });
  });

  if (dom.goto) dom.goto.addEventListener("change", function () {
    var code = dom.goto.value;
    dom.goto.value = "";
    if (!code || !state.byKey) return;
    var section = state.byKey.get("section:" + code);
    if (section) {
      hideTooltip();
      setSelection(section, focusFor(section));
    }
  });

  if (dom.zoomIn) dom.zoomIn.addEventListener("click", function () { cameraZoomBy(1.45); });
  if (dom.zoomOut) dom.zoomOut.addEventListener("click", function () { cameraZoomBy(1 / 1.45); });
  if (dom.zoomFit) dom.zoomFit.addEventListener("click", function () { fitTree(true); });

  function applyUrl() {
    var params = new URLSearchParams(window.location.search);
    var versionId = params.get("v") === "2008" ? "2008" : "2025";
    var code = params.get("code");
    var query = params.get("q");
    state.view = params.get("view") === "arbre" ? "arbre" : "structure";
    applyViewChrome();
    if (query) dom.search.value = query;
    loadVersion(versionId, code).then(function () {
      if (query) runSearch(query);
    });
  }

  applyUrl();
})();
