/**
 * naf-constellation.js
 * « Constellation Défense » : les activités NAF dont le lien avec la Défense
 * est documenté, placées à distance du centre selon leur niveau de proximité
 * analytique. La couche de données reste data/defense_qualification.csv —
 * chaque nœud affiché doit pouvoir répondre à « pourquoi est-il ici ? ».
 *
 * Layout entièrement déterministe (anneaux + secteurs par famille) : pas de
 * simulation de forces, donc pas de positions instables ni de nœuds fuyants.
 * Pan/zoom D3 identiques à la vue Arbre, hitboxes larges, labels cliquables.
 */
(function () {
  "use strict";

  var NAF = window.NAF;
  var d3 = window.d3;
  var app = document.getElementById("naf-def");
  if (!app || !d3) return;

  var dom = {
    chart: document.getElementById("naf-def-chart"),
    counts: document.getElementById("naf-def-counts"),
    panel: document.getElementById("naf-def-panel"),
    list: document.getElementById("naf-def-list"),
    error: document.getElementById("naf-def-error"),
    tooltip: document.getElementById("naf-def-tooltip"),
    zoomIn: document.getElementById("naf-def-zoomin"),
    zoomOut: document.getElementById("naf-def-zoomout"),
    zoomFit: document.getElementById("naf-def-zoomfit"),
    versions: app.querySelectorAll(".naf-versions:not(.naf-def-filters) .naf-version"),
    filters: app.querySelectorAll(".naf-def-filters .naf-version"),
  };

  var el = NAF.el;
  var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)");
  var HOVER_FINE = window.matchMedia("(hover: hover) and (pointer: fine)");

  /* ── Modèle de la couche analytique ─────────────────────────────────── */

  var LEVELS = {
    explicite_industriel: { ring: 1, color: "#007096", label: "Défense explicite" },
    dual_officiel: { ring: 2, color: "#925019", label: "Activité duale documentée" },
    ecosysteme_observe: { ring: 3, color: "#69aa77", label: "Écosystème fournisseur observé" },
    administration_defense: { ring: 0, color: "#5f7185", label: "Administration de la Défense" },
  };

  var NATURE_LABELS = {
    libelle_officiel: "Le libellé officiel Insee mentionne l'usage militaire",
    scission_naf_2025: "La NAF 2025 sépare désormais les volets civil et militaire de ce périmètre",
    refd_observe: "Présence observée au répertoire REFD du ministère des Armées",
  };

  var CONFIDENCE = {
    "élevé": { dots: "●●●", label: "preuve forte" },
    "moyen": { dots: "●●○", label: "preuve intermédiaire" },
    "piste": { dots: "●○○", label: "piste" },
  };

  var FAMILY_LABELS = {
    aeronautique_spatial: "Aéronautique / spatial",
    naval: "Naval",
    terrestre: "Terrestre",
    armement: "Armement",
    maintenance: "Maintenance / réparation",
    administration: "Administration",
  };

  // Secteur angulaire par famille (degrés, 0 = vers le haut). Les secteurs
  // sont largement espacés : sur l'anneau explicite, chaque nœud doit rester
  // dégagé de ses voisins et du centre.
  var FAMILY_ANGLES = {
    maintenance: -128,
    aeronautique_spatial: -62,
    armement: -8,
    terrestre: 48,
    naval: 105,
    administration: 180,
  };

  var VERSION_CSV = { "2025": "NAF 2025", "2008": "NAF rév.2" };

  var state = {
    versionId: "2025",
    level: "all",
    rows: [],          // lignes du CSV pour la version courante
    selected: null,    // ligne sélectionnée
    nomenclatures: {}, // versionId → nomenclature naf-core
  };

  var camera = { svg: null, g: null, zoom: null, w: 0, h: 0 };

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function nodeFor(row) {
    var nomenclature = state.nomenclatures[state.versionId];
    return nomenclature ? NAF.findByCode(nomenclature, row.code) : null;
  }

  /* ── Tooltip ────────────────────────────────────────────────────────── */

  function moved(event, row) {
    var tip = dom.tooltip;
    clear(tip);
    tip.hidden = false;
    var level = LEVELS[row.niveau_defense] || {};
    var flat = nodeFor(row);

    tip.appendChild(el("p", "naf-viz-tip-code naf-mono", row.code));
    tip.appendChild(el("p", "naf-viz-tip-label", flat ? flat.label : ""));
    tip.appendChild(el("p", "naf-viz-tip-meta", level.label + " · " + row.naf_version));
    var why = el("p", "naf-viz-tip-parents");
    why.appendChild(el("strong", null, "Pourquoi ? "));
    var just = row.justification || "";
    if (just.length > 150) just = just.slice(0, 149) + "…";
    why.appendChild(document.createTextNode(just));
    tip.appendChild(why);
    var conf = CONFIDENCE[row.niveau_confiance];
    tip.appendChild(el("p", "naf-viz-tip-counts",
      (conf ? conf.dots + " " + conf.label + " · " : "") + (row.source_reference || "")));

    var pad = 14;
    var rect = app.getBoundingClientRect();
    var x = event.clientX - rect.left + pad;
    var y = event.clientY - rect.top + pad;
    var maxX = rect.width - tip.offsetWidth - 8;
    if (x > maxX) x = Math.max(8, event.clientX - rect.left - tip.offsetWidth - pad);
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }

  function hideTooltip() { dom.tooltip.hidden = true; }

  /* ── Panneau de détail ──────────────────────────────────────────────── */

  function explorerUrl(row) {
    var v = row.naf_version === "NAF rév.2" ? "2008" : "2025";
    return "../explorer/index.html?v=" + v + "&code=" + encodeURIComponent(row.code);
  }

  function treeUrl(row) {
    var v = row.naf_version === "NAF rév.2" ? "2008" : "2025";
    return "../explorer/visualisation.html?view=arbre&v=" + v +
      "&code=" + encodeURIComponent(row.code);
  }

  function renderPanel() {
    clear(dom.panel);
    var row = state.selected;
    dom.panel.appendChild(el("p", "naf-viz-panel-kicker", "Vous regardez"));

    if (!row) {
      dom.panel.appendChild(el("p", "naf-viz-panel-label", "La constellation Défense"));
      dom.panel.appendChild(el("p", "naf-viz-panel-help",
        "Chaque nœud est un code NAF dont le lien avec la Défense est documenté. " +
        "Cliquez un nœud pour lire pourquoi il est là, avec sa source."));
      var legend = el("ul", "naf-def-legend");
      Object.keys(LEVELS).forEach(function (key) {
        var item = el("li", "naf-def-legend-item");
        var dot = el("span", "naf-def-legend-dot");
        dot.dataset.level = key;
        item.appendChild(dot);
        item.appendChild(el("span", null, LEVELS[key].label));
        legend.appendChild(item);
      });
      dom.panel.appendChild(legend);
      var guide = el("ol", "naf-def-guide");
      ["Commencez au centre", "Regardez les activités explicitement militaires",
        "Éloignez-vous vers les activités duales",
        "Observez jusqu'où l'écosystème s'étend"].forEach(function (step) {
          guide.appendChild(el("li", null, step));
        });
      dom.panel.appendChild(guide);
      return;
    }

    var level = LEVELS[row.niveau_defense] || {};
    var flat = nodeFor(row);

    var code = el("p", "naf-viz-panel-code naf-mono", row.code);
    code.style.borderLeftColor = level.color || "#33475f";
    dom.panel.appendChild(code);
    dom.panel.appendChild(el("p", "naf-viz-panel-label", flat ? flat.label : ""));
    dom.panel.appendChild(el("p", "naf-viz-panel-meta",
      row.naf_version + " · " + (FAMILY_LABELS[row.famille] || row.famille)));

    var badge = el("p", "naf-def-lvlbadge", level.label);
    badge.dataset.level = row.niveau_defense;
    dom.panel.appendChild(badge);
    if (row.niveau_defense === "administration_defense") {
      var warn = el("p", "naf-callout");
      warn.appendChild(el("strong", null, "À ne pas confondre. "));
      warn.appendChild(document.createTextNode(
        "Ce code désigne l'administration publique de la défense, pas les " +
        "entreprises industrielles de Défense."));
      dom.panel.appendChild(warn);
    }

    dom.panel.appendChild(el("p", "naf-viz-panel-section", "Pourquoi ce nœud est-il ici ?"));
    dom.panel.appendChild(el("p", "naf-def-just", row.justification));

    dom.panel.appendChild(el("p", "naf-viz-panel-section", "Nature de la preuve"));
    dom.panel.appendChild(el("p", "naf-viz-panel-counts",
      NATURE_LABELS[row.nature_preuve] || row.nature_preuve));

    var conf = CONFIDENCE[row.niveau_confiance];
    if (conf) {
      dom.panel.appendChild(el("p", "naf-viz-panel-section", "Niveau de confiance"));
      var confP = el("p", "naf-viz-panel-counts");
      confP.appendChild(el("span", "naf-def-confdots", conf.dots + " "));
      confP.appendChild(document.createTextNode(conf.label));
      dom.panel.appendChild(confP);
    }

    if (flat) {
      var nomenclature = state.nomenclatures[state.versionId];
      var path = NAF.pathOf(NAF.findByCode(nomenclature, row.code));
      dom.panel.appendChild(el("p", "naf-viz-panel-section", "Dans la NAF"));
      dom.panel.appendChild(el("p", "naf-viz-panel-counts naf-mono",
        path.map(function (n) { return n.code; }).join(" › ")));
    }

    dom.panel.appendChild(el("p", "naf-viz-panel-section", "Source"));
    var src = el("p", "naf-viz-panel-counts");
    var link = el("a", "naf-link", (row.source_reference || "Fiche Insee") + " ↗");
    link.href = row.source_url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    src.appendChild(link);
    dom.panel.appendChild(src);

    var actions = el("p", "naf-def-actions");
    var explore = el("a", "naf-viz-panel-cta", "Voir dans l'Explorer →");
    explore.href = explorerUrl(row);
    actions.appendChild(explore);
    var tree = el("a", "naf-viz-panel-cta naf-def-cta-ghost", "Voir dans l'arbre →");
    tree.href = treeUrl(row);
    actions.appendChild(tree);
    dom.panel.appendChild(actions);
  }

  /* ── Constellation ──────────────────────────────────────────────────── */

  function rowsForVersion() {
    return state.rows.filter(function (r) {
      return r.naf_version === VERSION_CSV[state.versionId];
    });
  }

  function isDimmed(row) {
    return state.level !== "all" && row.niveau_defense !== state.level;
  }

  function selectRow(row) {
    hideTooltip();
    state.selected = row;
    renderPanel();
    if (camera.g) {
      camera.g.selectAll("[data-sel]")
        .attr("stroke", function (d) { return d === row ? "#14181d" : "none"; })
        .attr("stroke-width", function (d) { return d === row ? 2.5 : 0; });
    }
  }

  function renderChart() {
    clear(dom.chart);
    var w = dom.chart.clientWidth || 320;
    var isNarrow = w < 700;
    var h = isNarrow ? 520 : Math.max(540, Math.min(680, window.innerHeight - 240));
    camera.w = w; camera.h = h;

    var svg = d3.create("svg")
      .attr("viewBox", [0, 0, w, h])
      .attr("width", w).attr("height", h)
      .attr("role", "img")
      .attr("aria-label",
        "Constellation Défense : les activités NAF documentées sont placées " +
        "autour du centre « Défense », d'autant plus loin que leur lien est " +
        "moins explicite. Le détail de chaque nœud est lisible dans le " +
        "panneau et dans la liste alternative.");
    var g = svg.append("g");
    camera.svg = svg; camera.g = g;

    var cx = w / 2, cy = h / 2;
    var base = Math.min(w, h) / 2 - (isNarrow ? 30 : 48);
    var R = { 1: base * 0.48, 2: base * 0.73, 3: base * 0.98 };

    /* Anneaux suggérés + labels de niveau (décoratifs) */
    var deco = g.append("g").attr("pointer-events", "none");
    [1, 2, 3].forEach(function (ring) {
      deco.append("circle")
        .attr("cx", cx).attr("cy", cy).attr("r", R[ring])
        .attr("fill", "none")
        .attr("stroke", "#dce1e7")
        .attr("stroke-width", 1.2)
        .attr("stroke-dasharray", "3 6");
    });
    var ringNames = { 1: "DÉFENSE EXPLICITE", 2: "ACTIVITÉS DUALES", 3: "ÉCOSYSTÈME FOURNISSEUR OBSERVÉ" };
    [1, 2, 3].forEach(function (ring) {
      deco.append("text")
        .attr("class", "naf-def-ringlabel")
        .attr("x", cx).attr("y", cy - R[ring] - 7)
        .attr("text-anchor", "middle")
        .text(ringNames[ring]);
    });

    /* Annotations Excalifont */
    deco.append("text").attr("class", "naf-def-handsvg")
      .attr("x", cx + R[1] * 0.55).attr("y", cy + R[1] + 18)
      .text("« ici, le lien est explicite »");
    var far1 = deco.append("text").attr("class", "naf-def-handsvg")
      .attr("x", cx - R[3] * 1.05).attr("y", cy + R[3] * 1.02);
    far1.append("tspan").attr("x", cx - R[3] * 1.05).text("« plus on s'éloigne,");
    far1.append("tspan").attr("x", cx - R[3] * 1.05).attr("dy", 20)
      .text("moins la NAF suffit à elle seule »");
    deco.append("text").attr("class", "naf-def-handsvg naf-def-handsvg-soft")
      .attr("x", cx + R[3] * 0.42).attr("y", cy - R[3] * 0.62)
      .text("anneau en cours de documentation (REFD)");
    if (state.versionId === "2025") {
      deco.append("text").attr("class", "naf-def-handsvg naf-def-handsvg-soft")
        .attr("x", cx + R[2] * 0.35).attr("y", cy + R[2] * 0.86)
        .text("la NAF 2025 sépare désormais civil et militaire");
    }

    /* Centre */
    deco.append("circle").attr("cx", cx).attr("cy", cy).attr("r", 34)
      .attr("fill", "#33475f");
    deco.append("text").attr("class", "naf-def-center")
      .attr("x", cx).attr("y", cy + 1).attr("text-anchor", "middle")
      .text("DÉFENSE");
    deco.append("text").attr("class", "naf-def-centersub")
      .attr("x", cx).attr("y", cy + 16).attr("text-anchor", "middle")
      .text(NAF.VERSIONS[state.versionId].shortLabel);

    /* Nœuds : positions déterministes par famille, puis index. */
    var rows = rowsForVersion();
    var byFamilyLevel = {};
    rows.forEach(function (row) {
      var key = row.famille + "|" + row.niveau_defense;
      (byFamilyLevel[key] = byFamilyLevel[key] || []).push(row);
    });

    var layerNodes = g.append("g");
    var layerHits = g.append("g");
    var layerLabels = g.append("g");

    rows.forEach(function (row) {
      var level = LEVELS[row.niveau_defense];
      if (!level) return;
      var isAdmin = row.niveau_defense === "administration_defense";
      // L'administration a sa propre orbite basse, à l'écart de l'échelle
      // industrielle — ni près du centre, ni confondue avec les anneaux.
      var ringR = isAdmin ? R[2] : R[level.ring];
      var group = byFamilyLevel[row.famille + "|" + row.niveau_defense];
      var index = group.indexOf(row);
      var baseAngle = FAMILY_ANGLES[row.famille] != null ? FAMILY_ANGLES[row.famille] : 140;
      var spread = group.length > 1 ? (index - (group.length - 1) / 2) * 24 : 0;
      var a = ((baseAngle + spread) * Math.PI) / 180;
      var x = cx + ringR * Math.sin(a);
      var y = cy - ringR * Math.cos(a);
      var dimmed = isDimmed(row);
      var flat = nodeFor(row);

      var mark;
      if (isAdmin) {
        // Forme distincte, pas seulement une couleur : l'administration
        // publique n'est pas sur l'échelle industrielle.
        mark = layerNodes.append("rect")
          .attr("x", x - 10).attr("y", y - 10)
          .attr("width", 20).attr("height", 20).attr("rx", 4)
          .attr("stroke-dasharray", "3 3");
      } else {
        mark = layerNodes.append("circle")
          .attr("cx", x).attr("cy", y).attr("r", 11);
      }
      mark
        .attr("fill", level.color)
        .attr("data-code", row.code)
        .attr("data-sel", "")
        .datum(row)
        .attr("opacity", dimmed ? 0.15 : 1)
        .attr("stroke", state.selected === row ? "#14181d" : "none")
        .attr("stroke-width", state.selected === row ? 2.5 : 0);
      if (isAdmin) {
        mark.attr("fill", "#eef0f3").attr("stroke", level.color)
          .attr("stroke-width", 1.8).attr("data-sel", null);
        // contour sélection séparé pour ne pas écraser le pointillé
        layerNodes.append("rect")
          .attr("x", x - 13).attr("y", y - 13)
          .attr("width", 26).attr("height", 26).attr("rx", 6)
          .attr("fill", "none").datum(row).attr("data-sel", "")
          .attr("stroke", state.selected === row ? "#14181d" : "none")
          .attr("stroke-width", state.selected === row ? 2.5 : 0);
      }

      var codeLabel = layerLabels.append("text")
        .attr("class", "naf-def-nodecode")
        .attr("x", x).attr("y", y + 26)
        .attr("text-anchor", "middle")
        .attr("data-code", row.code)
        .datum(row)
        .attr("opacity", dimmed ? 0.25 : 1)
        .text(row.code);
      var short = flat ? flat.label : "";
      if (short.length > 30) short = short.slice(0, 29) + "…";
      layerLabels.append("text")
        .attr("class", "naf-def-nodelbl")
        .attr("x", x).attr("y", y + 40)
        .attr("text-anchor", "middle")
        .attr("pointer-events", "none")
        .attr("opacity", dimmed ? 0.25 : 1)
        .text(short);

      var hit = layerHits.append("circle")
        .attr("cx", x).attr("cy", y).attr("r", 30)
        .attr("fill", "transparent")
        .attr("data-code", row.code)
        .datum(row);

      [mark, codeLabel, hit].forEach(function (target) {
        target.style("cursor", dimmed ? "default" : "pointer")
          .style("pointer-events", dimmed ? "none" : "auto")
          .on("click", function (event, r) { selectRow(r); });
        if (HOVER_FINE.matches) {
          target.on("mousemove", moved).on("mouseleave", hideTooltip);
        }
      });
    });

    dom.chart.appendChild(svg.node());
    installCamera();
    fitCamera(false);
  }

  /* ── Caméra (pan/zoom, mêmes conventions que la vue Arbre) ──────────── */

  function installCamera() {
    camera.zoom = d3.zoom()
      .scaleExtent([0.6, 4])
      .filter(function (event) {
        if (event.type === "touchstart" || event.type === "touchmove") {
          return event.touches.length > 1;
        }
        return !event.button;
      })
      .on("zoom", function (event) {
        camera.g.attr("transform", event.transform);
      });
    camera.svg.call(camera.zoom).on("dblclick.zoom", null);
    camera.svg.style("touch-action", "pan-y");
  }

  function fitCamera(animate) {
    var bbox = camera.g.node().getBBox();
    if (!bbox.width) return;
    var pad = camera.w < 700 ? 24 : 40;
    var scale = Math.min(1.6, 0.98 * Math.min(
      camera.w / (bbox.width + pad * 2), camera.h / (bbox.height + pad * 2)));
    var t = d3.zoomIdentity
      .translate(camera.w / 2, camera.h / 2)
      .scale(scale)
      .translate(-(bbox.x + bbox.width / 2), -(bbox.y + bbox.height / 2));
    var target = animate && !REDUCED.matches
      ? camera.svg.transition().duration(400) : camera.svg;
    target.call(camera.zoom.transform, t);
  }

  /* ── Compteurs + liste alternative ──────────────────────────────────── */

  function renderCounts() {
    var rows = rowsForVersion();
    var counts = {};
    rows.forEach(function (r) { counts[r.niveau_defense] = (counts[r.niveau_defense] || 0) + 1; });
    var parts = [];
    if (counts.explicite_industriel) parts.push(counts.explicite_industriel + " activités explicitement militaires");
    if (counts.dual_officiel) parts.push(counts.dual_officiel + " duales documentées");
    if (counts.ecosysteme_observe) parts.push(counts.ecosysteme_observe + " observées dans l'écosystème");
    if (counts.administration_defense) parts.push(counts.administration_defense + " administration");
    dom.counts.textContent = NAF.VERSIONS[state.versionId].shortLabel + " · " +
      parts.join(" · ") + " — le reste de la nomenclature : non évalué.";
  }

  function renderList() {
    clear(dom.list);
    rowsForVersion().forEach(function (row) {
      var level = LEVELS[row.niveau_defense] || {};
      var flat = nodeFor(row);
      var item = el("p", "naf-def-listitem");
      var button = el("button", "naf-def-listbtn");
      button.type = "button";
      button.appendChild(el("span", "naf-mono", row.code));
      button.appendChild(el("span", null, (flat ? flat.label : "") + " — " + level.label));
      button.addEventListener("click", function () { selectRow(row); });
      item.appendChild(button);
      dom.list.appendChild(item);
    });
  }

  /* ── État ───────────────────────────────────────────────────────────── */

  function refresh() {
    renderCounts();
    renderChart();
    renderPanel();
    renderList();
  }

  Array.prototype.forEach.call(dom.versions, function (button) {
    button.addEventListener("click", function () {
      if (button.dataset.version === state.versionId) return;
      state.versionId = button.dataset.version;
      state.selected = null;
      Array.prototype.forEach.call(dom.versions, function (b) {
        var current = b === button;
        b.classList.toggle("is-current", current);
        b.setAttribute("aria-checked", current ? "true" : "false");
      });
      refresh();
    });
  });

  Array.prototype.forEach.call(dom.filters, function (button) {
    button.addEventListener("click", function () {
      state.level = button.dataset.level;
      Array.prototype.forEach.call(dom.filters, function (b) {
        var current = b === button;
        b.classList.toggle("is-current", current);
        b.setAttribute("aria-checked", current ? "true" : "false");
      });
      renderChart();
    });
  });

  if (dom.zoomIn) dom.zoomIn.addEventListener("click", function () {
    camera.svg.transition().duration(200).call(camera.zoom.scaleBy, 1.4);
  });
  if (dom.zoomOut) dom.zoomOut.addEventListener("click", function () {
    camera.svg.transition().duration(200).call(camera.zoom.scaleBy, 1 / 1.4);
  });
  if (dom.zoomFit) dom.zoomFit.addEventListener("click", function () { fitCamera(true); });

  window.addEventListener("resize", NAF.debounce(function () {
    if (state.rows.length) renderChart();
  }, 200));

  /* ── Chargement ─────────────────────────────────────────────────────── */

  Promise.all([
    NAF.loadDefense(),
    NAF.loadNomenclature("2025"),
    NAF.loadNomenclature("2008"),
  ]).then(function (results) {
    state.rows = results[0].filter(function (r) { return r.code && r.niveau_defense; });
    state.nomenclatures["2025"] = results[1];
    state.nomenclatures["2008"] = results[2];
    refresh();
  }).catch(function (error) {
    dom.counts.textContent = "";
    dom.error.hidden = false;
    dom.error.textContent =
      "Impossible de charger la couche analytique (" + error.message + "). " +
      "Rechargez la page ; si le problème persiste, les fichiers de données " +
      "ne sont pas accessibles.";
  });
})();
