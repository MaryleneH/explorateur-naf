/**
 * naf-flux.js
 * « Voyage 2008 → 2025 » : diagramme de flux progressif entre les deux
 * nomenclatures, construit sur l'extrait local de la table de correspondance.
 *
 * Parti pris :
 *   - JAMAIS les 736 relations d'un coup. La vue initiale agrège par section,
 *     puis chaque clic descend d'un niveau (divisions → groupes → classes →
 *     sous-classes) dans le périmètre cliqué. Chaque vue reste sous ~25 nœuds
 *     par colonne : pas besoin de pan/zoom, la page défile.
 *   - l'épaisseur d'un lien code UNE seule chose : le nombre de relations de
 *     sous-classes qu'il contient (solution « comptage », affichée en légende).
 *     Les liens très fins sont légèrement épaissis pour rester cliquables ;
 *     c'est dit explicitement.
 *   - la couleur d'un lien est celle de la section d'ORIGINE (2008).
 *   - mêmes règles de ciblage que l'arbre : couches explicites (liens →
 *     zones de clic transparentes → nœuds → libellés en dernier), libellés
 *     cliquables avec halo, zones de clic larges.
 */
(function () {
  "use strict";

  var NAF = window.NAF;
  var d3 = window.d3;
  var root = document.getElementById("naf-flux");
  if (!root || !d3) return;

  var el = NAF.el;
  var HOVER_FINE = window.matchMedia("(hover: hover) and (pointer: fine)");

  var dom = {
    crumb: document.getElementById("naf-flux-crumb"),
    filters: document.getElementById("naf-flux-filters"),
    simple: document.getElementById("naf-flux-simple"),
    counts: document.getElementById("naf-flux-counts"),
    chart: document.getElementById("naf-flux-chart"),
    hand: document.getElementById("naf-flux-hand"),
    panel: document.getElementById("naf-flux-panel"),
    list: document.getElementById("naf-flux-list"),
    tooltip: document.getElementById("naf-flux-tooltip"),
    error: document.getElementById("naf-flux-error"),
  };

  /* Même palette que les autres pages : une couleur par section, indexée
     par lettre (les sections sont contiguës de A à V). */
  var SECTION_COLORS = [
    "#2a7449", "#c08e43", "#2a669f", "#cc8553", "#017a5d", "#9c9e51",
    "#934c3a", "#43a6c3", "#46712b", "#d28063", "#006e9e", "#69aa77",
    "#925019", "#5aa0d0", "#676815", "#ca874e", "#007096", "#84a561",
    "#984742", "#38abb1", "#796006", "#d37d6f",
  ];
  function sectionColor(letter) {
    var i = letter.charCodeAt(0) - 65;
    return SECTION_COLORS[i % SECTION_COLORS.length] || "#33475f";
  }

  var TYPES = {
    identique: { badge: "1→1", one: "reprise à l'identique" },
    scission: { badge: "1→n", one: "scission" },
    regroupement: { badge: "n→1", one: "regroupement" },
    recomposition: { badge: "n↔n", one: "recomposition" },
  };

  /* Niveaux de lecture. Le niveau affiché = crumbs.length. */
  var LEVEL_NAMES = ["Sections", "Divisions", "Groupes", "Classes", "Sous-classes"];
  var LEVEL_OF = ["section", "division", "group", "class", "subclass"];
  var LEAF_LEVEL = 4;

  var state = {
    lines: [],          // lignes enrichies (type de groupe, clés par niveau)
    n08: null,
    n25: null,
    crumbs: [],         // [{side:'08'|'25', level, key, label}]
    type: "tous",
    hideSimple: false,
    selectedKey: null,  // clé de la relation sélectionnée (vue feuille)
  };

  /* ───────────────────────────────────────────────────────────────────
     Préparation des données
  ─────────────────────────────────────────────────────────────────── */

  function enrich(pairs, sec08, sec25) {
    // Union-find pour retrouver le type réel du groupe de chaque ligne.
    var parent = new Map();
    function find(x) {
      var r = x;
      while (parent.get(r) !== r) r = parent.get(r);
      while (parent.get(x) !== r) { var n = parent.get(x); parent.set(x, r); x = n; }
      return r;
    }
    pairs.forEach(function (p) {
      var a = "08:" + p.code_2008, b = "25:" + p.code_2025;
      if (!parent.has(a)) parent.set(a, a);
      if (!parent.has(b)) parent.set(b, b);
      var ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    });
    var members = new Map();
    pairs.forEach(function (p) {
      var key = find("08:" + p.code_2008);
      var m = members.get(key);
      if (!m) { m = { c08: new Set(), c25: new Set() }; members.set(key, m); }
      m.c08.add(p.code_2008);
      m.c25.add(p.code_2025);
    });

    return pairs.map(function (p) {
      var m = members.get(find("08:" + p.code_2008));
      var type = m.c08.size === 1
        ? (m.c25.size === 1 ? "identique" : "scission")
        : (m.c25.size === 1 ? "regroupement" : "recomposition");
      return {
        pair: p,
        type: type,
        key: p.code_2008 + "→" + p.code_2025,
        k08: [
          sec08.get(p.code_2008) || "?",
          p.code_2008.slice(0, 2),
          p.code_2008.slice(0, 4),
          p.code_2008.slice(0, 5),
          p.code_2008,
        ],
        k25: [
          sec25.get(p.code_2025) || "?",
          p.code_2025.slice(0, 2),
          p.code_2025.slice(0, 4),
          p.code_2025.slice(0, 5),
          p.code_2025,
        ],
      };
    });
  }

  function keyOf(line, level, side) {
    return side === "08" ? line.k08[level] : line.k25[level];
  }

  function labelFor(versionId, level, key) {
    var nom = versionId === "2008" ? state.n08 : state.n25;
    var node = nom.byCode.get(LEVEL_OF[level] + ":" + key);
    if (!node) return "";
    var label = node.label;
    // Les libellés de sections NAF 2025 sont en capitales dans le CSV :
    // on les ramène à la casse de phrase pour aligner les deux colonnes.
    if (label && label === label.toUpperCase() && label.length > 3) {
      label = label.charAt(0) + label.slice(1).toLowerCase();
    }
    return label;
  }

  /* ───────────────────────────────────────────────────────────────────
     Sélection des lignes visibles (filtres + périmètre)
  ─────────────────────────────────────────────────────────────────── */

  function activeLines() {
    return state.lines.filter(function (line) {
      if (state.type !== "tous" && line.type !== state.type) return false;
      if (state.hideSimple && line.type === "identique") return false;
      for (var i = 0; i < state.crumbs.length; i++) {
        var c = state.crumbs[i];
        if (keyOf(line, c.level, c.side) !== c.key) return false;
      }
      return true;
    });
  }

  /* ───────────────────────────────────────────────────────────────────
     Construction d'une vue : nœuds + liens agrégés au niveau courant
  ─────────────────────────────────────────────────────────────────── */

  function buildView() {
    var level = state.crumbs.length;
    var lines = activeLines();

    var left = new Map(), right = new Map(), links = new Map();
    lines.forEach(function (line) {
      var a = keyOf(line, level, "08");
      var b = keyOf(line, level, "25");
      var ln = left.get(a);
      if (!ln) { ln = { key: a, side: "08", value: 0, sections: new Map() }; left.set(a, ln); }
      ln.value++;
      countSection(ln, line);
      var rn = right.get(b);
      if (!rn) { rn = { key: b, side: "25", value: 0, sections: new Map() }; right.set(b, rn); }
      rn.value++;
      countSectionRight(rn, line);
      var lk = a + "→" + b;
      var link = links.get(lk);
      if (!link) {
        link = { a: a, b: b, value: 0, changed: 0, section: line.k08[0], lines: [] };
        links.set(lk, link);
      }
      link.value++;
      if (line.type !== "identique") link.changed++;
      link.lines.push(line);
    });

    function countSection(node, line) {
      node.sections.set(line.k08[0], (node.sections.get(line.k08[0]) || 0) + 1);
    }
    function countSectionRight(node, line) {
      // Un nœud de droite est coloré par la section d'origine dominante de
      // ce qui y arrive (au niveau sections : sa propre lettre 2025).
      node.sections.set(level === 0 ? line.k25[0] : line.k08[0],
        (node.sections.get(level === 0 ? line.k25[0] : line.k08[0]) || 0) + 1);
    }

    function finalize(map) {
      var nodes = Array.from(map.values());
      nodes.sort(function (x, y) { return x.key.localeCompare(y.key); });
      nodes.forEach(function (n) {
        var best = null;
        n.sections.forEach(function (v, k) {
          if (!best || v > best.v) best = { k: k, v: v };
        });
        n.section = best ? best.k : "?";
      });
      return nodes;
    }

    return {
      level: level,
      lines: lines,
      left: finalize(left),
      right: finalize(right),
      links: Array.from(links.values()).sort(function (x, y) {
        return x.a === y.a ? x.b.localeCompare(y.b) : x.a.localeCompare(y.a);
      }),
    };
  }

  /* ───────────────────────────────────────────────────────────────────
     Navigation : descendre, remonter, fil d'Ariane
  ─────────────────────────────────────────────────────────────────── */

  function crumbLabel(side, level, key) {
    var versionId = side === "08" ? "2008" : "2025";
    if (level === 0) {
      return "Section " + key + (side === "25" ? " (2025)" : " (2008)");
    }
    return LEVEL_NAMES[level].replace(/s$/, "") + " " + key;
  }

  function drill(side, key) {
    var level = state.crumbs.length;
    if (level >= LEAF_LEVEL) return;
    state.crumbs.push({ side: side, level: level, key: key, label: crumbLabel(side, level, key) });
    state.selectedKey = null;
    autoDescend();
    render();
  }

  /* Une vue triviale (1 nœud de chaque côté) n'apprend rien : on descend
     automatiquement jusqu'à la première vue qui montre quelque chose. */
  function autoDescend() {
    while (state.crumbs.length < LEAF_LEVEL) {
      var view = buildView();
      if (view.left.length !== 1 || view.right.length !== 1) return;
      var level = state.crumbs.length;
      var key = view.left[0].key;
      state.crumbs.push({ side: "08", level: level, key: key, label: crumbLabel("08", level, key) });
    }
  }

  function jumpTo(depth) {
    state.crumbs = state.crumbs.slice(0, depth);
    state.selectedKey = null;
    render();
  }

  function renderCrumb() {
    clearNode(dom.crumb);
    var home = el("button", "naf-flux-crumb-btn", "Toutes les sections");
    home.type = "button";
    home.disabled = state.crumbs.length === 0;
    home.addEventListener("click", function () { jumpTo(0); });
    dom.crumb.appendChild(home);

    state.crumbs.forEach(function (c, i) {
      var sep = el("span", "naf-flux-crumb-sep", "›");
      sep.setAttribute("aria-hidden", "true");
      dom.crumb.appendChild(sep);
      if (i === state.crumbs.length - 1) {
        dom.crumb.appendChild(el("span", "naf-flux-crumb-here", c.label));
      } else {
        var btn = el("button", "naf-flux-crumb-btn", c.label);
        btn.type = "button";
        btn.addEventListener("click", function () { jumpTo(i + 1); });
        dom.crumb.appendChild(btn);
      }
    });
  }

  /* ───────────────────────────────────────────────────────────────────
     Rendu du diagramme
  ─────────────────────────────────────────────────────────────────── */

  function render() {
    var view = buildView();
    renderCrumb();
    renderCounts(view);
    renderChart(view);
    renderAltList(view);
    renderHand(view);
    if (!leafSelectionStillVisible(view)) state.selectedKey = null;
    renderPanel(view);
  }

  function leafSelectionStillVisible(view) {
    if (!state.selectedKey) return false;
    if (view.level !== LEAF_LEVEL) return false;
    return view.lines.some(function (line) { return line.key === state.selectedKey; });
  }

  function renderCounts(view) {
    var total = view.lines.length;
    var changed = view.lines.filter(function (l) { return l.type !== "identique"; }).length;
    var scope = state.crumbs.length
      ? state.crumbs[state.crumbs.length - 1].label
      : "toutes les sections";
    dom.counts.textContent = total === 0
      ? "Aucune relation ne correspond à ces filtres dans ce périmètre."
      : LEVEL_NAMES[view.level] + " — " + scope + " : " + total +
        (total === 1 ? " relation" : " relations") + " de sous-classes, dont " +
        changed + " dans des transformations (scissions, regroupements, recompositions).";
  }

  function renderHand(view) {
    if (!dom.hand) return;
    dom.hand.textContent = view.level === 0
      ? "« suivez les chemins qui changent de section »"
      : (view.level === LEAF_LEVEL
        ? "« regardez où les chemins se séparent »"
        : "« descendez : c'est en bas que les chemins se séparent »");
  }

  function renderChart(view) {
    clearNode(dom.chart);

    if (!view.lines.length) {
      dom.chart.appendChild(el("p", "naf-results-empty",
        "Rien à afficher ici avec ces filtres. Élargissez les filtres ou remontez d'un niveau."));
      return;
    }

    var width = Math.max(dom.chart.clientWidth || 640, 320);
    var narrow = width < 620;
    var leaf = view.level === LEAF_LEVEL;

    var n = Math.max(view.left.length, view.right.length);
    var minH = narrow ? 22 : 16;
    var gap = narrow ? 10 : 8;
    var padTop = 8, padBottom = 8;
    var H = Math.max(narrow ? 400 : 440, n * (minH + gap) + 140);

    function layoutSide(nodes) {
      var total = 0;
      nodes.forEach(function (nd) { total += nd.value; });
      var avail = H - padTop - padBottom - (nodes.length - 1) * gap - nodes.length * minH;
      var scale = total > 0 && avail > 0 ? avail / total : 0;
      var y = padTop + (H - padTop - padBottom - totalHeight(nodes, scale)) / 2;
      nodes.forEach(function (nd) {
        nd.h = minH + nd.value * scale;
        nd.y0 = y;
        nd.y1 = y + nd.h;
        y = nd.y1 + gap;
      });
      return scale;
      function totalHeight(list, s) {
        var sum = (list.length - 1) * gap;
        list.forEach(function (nd) { sum += minH + nd.value * s; });
        return sum;
      }
    }

    var scaleL = layoutSide(view.left);
    var scaleR = layoutSide(view.right);

    var nodeW = 10;
    var labelPad = 6;
    var x0 = nodeW, x1 = width - nodeW;

    // Position des liens à l'intérieur de chaque nœud, au prorata du comptage.
    var offL = new Map(), offR = new Map();
    view.left.forEach(function (nd) { offL.set(nd.key, 0); });
    view.right.forEach(function (nd) { offR.set(nd.key, 0); });
    var byKeyL = new Map(), byKeyR = new Map();
    view.left.forEach(function (nd) { byKeyL.set(nd.key, nd); });
    view.right.forEach(function (nd) { byKeyR.set(nd.key, nd); });

    view.links.forEach(function (link) {
      var a = byKeyL.get(link.a), b = byKeyR.get(link.b);
      var shareA = (link.value / a.value) * a.h;
      var shareB = (link.value / b.value) * b.h;
      link.ya = a.y0 + offL.get(link.a) + shareA / 2;
      link.yb = b.y0 + offR.get(link.b) + shareB / 2;
      offL.set(link.a, offL.get(link.a) + shareA);
      offR.set(link.b, offR.get(link.b) + shareB);
      link.t = Math.max(1.4, Math.min(shareA, shareB));
    });

    var svg = d3.create("svg")
      .attr("class", "naf-flux-svg")
      .attr("viewBox", "0 0 " + width + " " + H)
      .attr("width", width)
      .attr("height", H)
      .attr("role", "img")
      .attr("aria-label", "Flux entre NAF 2008 (à gauche) et NAF 2025 (à droite), niveau : " +
        LEVEL_NAMES[view.level].toLowerCase());

    var gLinks = svg.append("g").attr("class", "naf-flux-links");
    var gLinkHits = svg.append("g").attr("class", "naf-flux-linkhits");
    var gNodes = svg.append("g").attr("class", "naf-flux-nodes");
    var gNodeHits = svg.append("g").attr("class", "naf-flux-nodehits");
    var gLabels = svg.append("g").attr("class", "naf-flux-labels");

    function linkPath(link) {
      var xa = x0 + 2, xb = x1 - 2;
      var mx = (xa + xb) / 2;
      return "M" + xa + "," + link.ya +
        "C" + mx + "," + link.ya + " " + mx + "," + link.yb + " " + xb + "," + link.yb;
    }

    view.links.forEach(function (link) {
      var selected = leaf && state.selectedKey &&
        link.lines.length === 1 && link.lines[0].key === state.selectedKey;
      gLinks.append("path")
        .attr("class", "naf-flux-link" + (selected ? " is-selected" : ""))
        .attr("d", linkPath(link))
        .attr("stroke", sectionColor(link.section))
        .attr("stroke-width", link.t)
        .attr("data-link", link.a + "→" + link.b);

      var hit = gLinkHits.append("path")
        .attr("class", "naf-flux-linkhit")
        .attr("d", linkPath(link))
        .attr("stroke-width", Math.max(link.t, narrow ? 20 : 14))
        .attr("data-link", link.a + "→" + link.b);

      hit.on("mousemove", function (event) {
        setHoverLink(link.a + "→" + link.b);
        showLinkTip(event, view, link);
      })
        .on("mouseleave", function () { setHoverLink(null); hideTip(); })
        .on("click", function () { clickLink(view, link); });
    });

    function nodeGroup(nodes, x, side) {
      nodes.forEach(function (nd) {
        gNodes.append("rect")
          .attr("class", "naf-flux-node")
          .attr("x", x - nodeW / 2)
          .attr("y", nd.y0)
          .attr("width", nodeW)
          .attr("height", Math.max(nd.h, 2))
          .attr("rx", 2)
          .attr("fill", sectionColor(nd.section))
          .attr("data-node", side + ":" + nd.key);

        var hitH = Math.max(nd.h, narrow ? 30 : 24);
        var hit = gNodeHits.append("rect")
          .attr("class", "naf-flux-nodehit")
          .attr("x", side === "08" ? 0 : width - nodeW * 2.4)
          .attr("y", nd.y0 - (hitH - nd.h) / 2)
          .attr("width", nodeW * 2.4)
          .attr("height", hitH)
          .attr("data-node", side + ":" + nd.key);

        hit.on("mousemove", function (event) { showNodeTip(event, view, nd); })
          .on("mouseleave", hideTip)
          .on("click", function () { clickNode(view, nd); });
      });
    }

    nodeGroup(view.left, x0 - nodeW / 2 + nodeW / 2, "08");
    // rects use x param directly:
    function labelText(nd) {
      if (narrow) return nd.key;
      var versionId = nd.side === "08" ? "2008" : "2025";
      var label = labelFor(versionId, view.level, nd.key);
      var maxChars = Math.floor((width / 2 - 60) / 6.6);
      var text = view.level === 0 ? nd.key + " — " + label : nd.key + " " + label;
      return text.length > maxChars ? text.slice(0, maxChars - 1).trimEnd() + "…" : text;
    }

    nodeGroup(view.right, x1, "25");

    view.left.forEach(function (nd) {
      var t = gLabels.append("text")
        .attr("class", "naf-flux-label")
        .attr("x", x0 + labelPad + 2)
        .attr("y", (nd.y0 + nd.y1) / 2)
        .attr("dy", "0.33em")
        .attr("text-anchor", "start")
        .attr("data-node", "08:" + nd.key)
        .text(labelText(nd));
      t.on("mousemove", function (event) { showNodeTip(event, view, nd); })
        .on("mouseleave", hideTip)
        .on("click", function () { clickNode(view, nd); });
    });
    view.right.forEach(function (nd) {
      var t = gLabels.append("text")
        .attr("class", "naf-flux-label")
        .attr("x", x1 - labelPad - 2)
        .attr("y", (nd.y0 + nd.y1) / 2)
        .attr("dy", "0.33em")
        .attr("text-anchor", "end")
        .attr("data-node", "25:" + nd.key)
        .text(labelText(nd));
      t.on("mousemove", function (event) { showNodeTip(event, view, nd); })
        .on("mouseleave", hideTip)
        .on("click", function () { clickNode(view, nd); });
    });

    // En-têtes de colonnes
    var head = svg.append("g").attr("class", "naf-flux-heads");
    head.append("text").attr("x", 0).attr("y", H - 2)
      .attr("text-anchor", "start").attr("class", "naf-flux-head")
      .text("NAF rév.2 — 2008");
    head.append("text").attr("x", width).attr("y", H - 2)
      .attr("text-anchor", "end").attr("class", "naf-flux-head")
      .text("NAF 2025");

    dom.chart.appendChild(svg.node());
  }

  /* ───────────────────────────────────────────────────────────────────
     Interactions
  ─────────────────────────────────────────────────────────────────── */

  function clickNode(view, nd) {
    hideTip();
    if (view.level < LEAF_LEVEL) {
      drill(nd.side, nd.key);
      return;
    }
    // Vue feuille : sélectionner la première relation du code.
    var line = view.lines.filter(function (l) {
      return keyOf(l, LEAF_LEVEL, nd.side) === nd.key;
    })[0];
    if (line) {
      state.selectedKey = line.key;
      render();
    }
  }

  function clickLink(view, link) {
    hideTip();
    if (view.level < LEAF_LEVEL) {
      drill("08", link.a);
      return;
    }
    var line = link.lines[0];
    if (line) {
      state.selectedKey = line.key;
      render();
    }
  }

  function showLinkTip(event, view, link) {
    if (!HOVER_FINE.matches) return;
    var name = LEVEL_NAMES[view.level].replace(/s$/, "");
    var text;
    if (view.level === LEAF_LEVEL) {
      var line = link.lines[0];
      text = link.a + " → " + link.b + " — " + TYPES[line.type].one +
        " (" + TYPES[line.type].badge + ")";
    } else {
      text = name + " " + link.a + " → " + name.toLowerCase() + " " + link.b + " — " +
        link.value + (link.value === 1 ? " relation" : " relations") +
        " de sous-classes" +
        (link.changed ? ", dont " + link.changed + " en transformation" : "");
    }
    moveTip(event, text);
  }

  function showNodeTip(event, view, nd) {
    if (!HOVER_FINE.matches) return;
    var versionId = nd.side === "08" ? "2008" : "2025";
    var name = LEVEL_NAMES[view.level].replace(/s$/, "");
    var label = labelFor(versionId, view.level, nd.key);
    var action = view.level < LEAF_LEVEL ? " — cliquer pour détailler" : "";
    moveTip(event, name + " " + nd.key + (label ? " — " + label : "") + " (" +
      NAF.VERSIONS[versionId].shortLabel + ") : " + nd.value +
      (nd.value === 1 ? " relation" : " relations") + action);
  }

  function moveTip(event, text) {
    dom.tooltip.textContent = text;
    dom.tooltip.hidden = false;
    var rect = dom.chart.getBoundingClientRect();
    var x = event.clientX - rect.left + 14;
    var y = event.clientY - rect.top + 16;
    var maxX = rect.width - dom.tooltip.offsetWidth - 8;
    dom.tooltip.style.left = Math.max(0, Math.min(x, maxX)) + "px";
    dom.tooltip.style.top = y + "px";
  }

  function hideTip() {
    dom.tooltip.hidden = true;
  }

  /* Épaissit visuellement le lien survolé sans toucher à sa géométrie :
     la zone de clic et le tracé visuel sont deux éléments distincts. */
  function setHoverLink(key) {
    Array.prototype.forEach.call(
      dom.chart.querySelectorAll(".naf-flux-link"),
      function (path) {
        path.classList.toggle("is-hover",
          key !== null && path.getAttribute("data-link") === key);
      });
  }

  /* ───────────────────────────────────────────────────────────────────
     Panneau de détail (vue feuille)
  ─────────────────────────────────────────────────────────────────── */

  function renderPanel(view) {
    clearNode(dom.panel);

    if (view.level !== LEAF_LEVEL || !state.selectedKey) {
      var empty = el("div", "naf-flux-panel-empty");
      empty.appendChild(el("p", "naf-flux-panel-hint", view.level === LEAF_LEVEL
        ? "Cliquez sur un lien ou une sous-classe pour lire la relation en détail."
        : "Cliquez sur un bloc pour descendre d'un niveau. Le détail d'une relation s'affiche au dernier niveau (sous-classes)."));
      dom.panel.appendChild(empty);
      return;
    }

    var line = view.lines.filter(function (l) { return l.key === state.selectedKey; })[0];
    if (!line) return;
    var p = line.pair;

    var badge = el("p", "naf-flux-panel-badge naf-chg-badge naf-chg-badge-" + line.type,
      TYPES[line.type].badge + " · " + TYPES[line.type].one);
    dom.panel.appendChild(badge);

    dom.panel.appendChild(sideBlock("NAF rév.2 (2008)", "2008", p.code_2008, p.libelle_2008));
    var arrow = el("p", "naf-flux-panel-arrow", "→");
    arrow.setAttribute("aria-hidden", "true");
    dom.panel.appendChild(arrow);
    dom.panel.appendChild(sideBlock("NAF 2025", "2025", p.code_2025, p.libelle_2025));

    if (line.type !== "identique") {
      dom.panel.appendChild(el("p", "naf-flux-panel-note",
        "Cette relation fait partie d'une " + TYPES[line.type].one +
        " : consultez la fiche complète pour voir toutes les sous-classes du groupe."));
    }

    if (p.source_url || p.source_reference) {
      var src = el("p", "naf-flux-panel-source");
      src.appendChild(document.createTextNode("Source : "));
      if (p.source_url) {
        var a = el("a", null, p.source_reference || p.source_url);
        a.href = p.source_url;
        a.target = "_blank";
        a.rel = "noopener";
        src.appendChild(a);
      } else {
        src.appendChild(document.createTextNode(p.source_reference));
      }
      dom.panel.appendChild(src);
    }

    var actions = el("div", "naf-flux-panel-actions");
    actions.appendChild(cta("Fiche complète de la transformation",
      "index.html?code=" + encodeURIComponent(p.code_2008)));
    actions.appendChild(cta("Ouvrir " + p.code_2025 + " dans l'Explorateur",
      "../explorer/?v=2025&code=" + encodeURIComponent(p.code_2025)));
    actions.appendChild(cta("Voir " + p.code_2025 + " dans l'arbre",
      "../explorer/visualisation.html?view=arbre&v=2025&code=" + encodeURIComponent(p.code_2025)));
    dom.panel.appendChild(actions);
  }

  function sideBlock(title, versionId, code, label) {
    var block = el("div", "naf-flux-panel-side");
    block.appendChild(el("p", "naf-flux-panel-ver", title));
    var codeEl = el("a", "naf-flux-panel-code naf-mono", code);
    codeEl.href = "../explorer/?v=" + versionId + "&code=" + encodeURIComponent(code);
    block.appendChild(codeEl);
    block.appendChild(el("p", "naf-flux-panel-lbl", label));
    return block;
  }

  function cta(text, href) {
    var a = el("a", "naf-chg-cta", text);
    a.href = href;
    return a;
  }

  /* ───────────────────────────────────────────────────────────────────
     Alternative accessible : la vue courante sous forme de liste
  ─────────────────────────────────────────────────────────────────── */

  function renderAltList(view) {
    if (!dom.list) return;
    clearNode(dom.list);
    var name = LEVEL_NAMES[view.level].replace(/s$/, "").toLowerCase();
    var ul = el("ul", null);
    view.links.forEach(function (link) {
      var li = el("li", null,
        (view.level === 0 ? "Section " : "") + link.a + " (2008) → " +
        (view.level === 0 ? "section " : name + " ") + link.b + " (2025) — " +
        link.value + (link.value === 1 ? " relation" : " relations") +
        " de sous-classes");
      ul.appendChild(li);
    });
    if (!view.links.length) {
      ul.appendChild(el("li", null, "Aucune relation avec ces filtres."));
    }
    dom.list.appendChild(ul);
  }

  /* ───────────────────────────────────────────────────────────────────
     Filtres
  ─────────────────────────────────────────────────────────────────── */

  function bindFilters() {
    Array.prototype.forEach.call(
      dom.filters.querySelectorAll("[data-type]"),
      function (btn) {
        btn.addEventListener("click", function () {
          state.type = btn.getAttribute("data-type");
          Array.prototype.forEach.call(
            dom.filters.querySelectorAll("[data-type]"),
            function (b) {
              var on = b.getAttribute("data-type") === state.type;
              b.classList.toggle("is-current", on);
              b.setAttribute("aria-checked", on ? "true" : "false");
            });
          // « Masquer les 1→1 » n'a pas de sens quand on ne montre qu'eux.
          if (state.type === "identique") {
            state.hideSimple = false;
            dom.simple.checked = false;
            dom.simple.disabled = true;
          } else {
            dom.simple.disabled = false;
          }
          render();
        });
      });

    dom.simple.addEventListener("change", function () {
      state.hideSimple = dom.simple.checked;
      render();
    });
  }

  /* ───────────────────────────────────────────────────────────────────
     Lien profond : ?code=10.13B → descendre jusqu'à sa classe
  ─────────────────────────────────────────────────────────────────── */

  function applyUrl() {
    var params = new URLSearchParams(window.location.search);
    var code = params.get("code");
    if (!code) return;
    var wanted = NAF.normalizeCode(code);
    var line = null, side = null;
    for (var i = 0; i < state.lines.length; i++) {
      if (NAF.normalizeCode(state.lines[i].pair.code_2008) === wanted) {
        line = state.lines[i]; side = "08"; break;
      }
      if (NAF.normalizeCode(state.lines[i].pair.code_2025) === wanted) {
        line = state.lines[i]; side = "25"; break;
      }
    }
    if (!line) return;
    state.crumbs = [];
    for (var level = 0; level < LEAF_LEVEL; level++) {
      var key = keyOf(line, level, side);
      state.crumbs.push({ side: side, level: level, key: key, label: crumbLabel(side, level, key) });
    }
    state.selectedKey = line.key;
  }

  /* ───────────────────────────────────────────────────────────────────
     Divers
  ─────────────────────────────────────────────────────────────────── */

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /* ───────────────────────────────────────────────────────────────────
     Démarrage
  ─────────────────────────────────────────────────────────────────── */

  Promise.all([
    NAF.loadCorrespondances(),
    NAF.loadNomenclature("2008"),
    NAF.loadNomenclature("2025"),
  ]).then(function (results) {
    state.n08 = results[1];
    state.n25 = results[2];

    var sec08 = new Map(), sec25 = new Map();
    state.n08.rows.forEach(function (r) { sec08.set(r.subclass_code, r.section_code); });
    state.n25.rows.forEach(function (r) { sec25.set(r.subclass_code, r.section_code); });

    state.lines = enrich(results[0], sec08, sec25);

    bindFilters();
    applyUrl();
    render();

    var relayout = NAF.debounce(function () { render(); }, 180);
    window.addEventListener("resize", relayout);
  }).catch(function (error) {
    if (dom.error) {
      dom.error.hidden = false;
      dom.error.textContent = "Impossible de charger les données (" + error.message + ").";
    }
  });
})();
