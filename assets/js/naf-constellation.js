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
    zoomCtrl: app.querySelector(".naf-viz-zoomctrl"),
    versions: app.querySelectorAll(".naf-def-versions .naf-version"),
    views: app.querySelectorAll(".naf-def-views .naf-version"),
    filters: app.querySelectorAll(".naf-def-filters .naf-version"),
    filtersGroup: app.querySelector(".naf-def-filters"),
    says: app.querySelector(".naf-def-says"),
    dualCounts: document.getElementById("naf-def-dualcounts"),
    dualSort: document.getElementById("naf-def-dualsort"),
    dualList: document.getElementById("naf-def-duallist"),
    pistes: document.getElementById("naf-def-pistes"),
  };

  var el = NAF.el;
  var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)");
  var HOVER_FINE = window.matchMedia("(hover: hover) and (pointer: fine)");

  /* ── Modèle de la couche analytique ─────────────────────────────────── */

  var LEVELS = {
    explicite_industriel: { ring: 1, color: "#007096", label: "Défense explicite" },
    dualite_demontree: { ring: 2, color: "#925019", label: "Dualité NAF démontrée" },
    relation_intermediaire: { ring: 3, color: "#69aa77", label: "Technologies dual-use / écosystème observé (preuve intermédiaire)" },
    administration_defense: { ring: 0, color: "#5f7185", label: "Administration de la Défense" },
  };

  var NATURE_LABELS = {
    libelle_officiel: "Le libellé officiel Insee mentionne l'usage militaire",
    note_officielle_insee: "Les notes officielles Insee de la sous-classe couvrent des usages civils et militaires",
    nomenclature_produits_cpf: "La nomenclature de produits officielle (CPF) rattache à cette activité des produits civils et militaires",
    structure_naf_2025: "La structure de la NAF 2025 (libellés officiels) atteste des deux volets de ce métier",
    enquete_ssm_refd: "Secteur observé parmi les entreprises de défense (enquête EDIS du SSM, adossée au REFD)",
    reglement_ue_bdu: "Le règlement (UE) 2021/821 classe certains biens de ce domaine en biens à double usage",
    dispositif_ministeriel: "Un dispositif officiel du ministère des Armées documente des projets duals dans ce domaine",
  };

  /* Natures de dualité (non exclusives) — voir la méthodologie de la page. */
  var DUALITE_LABELS = {
    dual_naf_directe: { tiny: "NAF directe", label: "Dualité visible directement dans la nomenclature (fiche, note ou produits officiels)" },
    dual_naf_crossref: { tiny: "NAF renvoi", label: "Dualité établie par renvois officiels entre nomenclatures ou structures" },
    technologie_dual_use: { tiny: "Biens dual-use", label: "Certains biens de l'activité sont classés à double usage (règlement UE) — pas toute la sous-classe" },
    ecosysteme_defense_observe: { tiny: "EDIS/REFD", label: "Entreprises du secteur observées parmi les fournisseurs de la Défense — pas toute la sous-classe" },
    projets_duaux_documentes: { tiny: "Projets duals", label: "Projets civils/militaires documentés dans le domaine (ex. RAPID) — pas toute la sous-classe" },
    dual_a_confirmer: { tiny: "À confirmer", label: "Piste : preuve encore insuffisante" },
  };

  function dualitesOf(row) {
    return (row.nature_dualite || "").split(";").filter(Boolean);
  }

  function isNafDual(row) {
    var d = dualitesOf(row);
    return d.indexOf("dual_naf_directe") !== -1 || d.indexOf("dual_naf_crossref") !== -1;
  }

  var CONFIDENCE = {
    "élevé": { dots: "●●●", label: "preuve forte" },
    "moyen": { dots: "●●○", label: "preuve intermédiaire" },
    "piste": { dots: "●○○", label: "piste" },
  };

  var FAMILY_LABELS = {
    aeronautique_spatial: "Aéronautique / spatial",
    naval: "Naval",
    terrestre: "Terrestre",
    armement: "Armement & matériaux énergétiques",
    maintenance: "Maintenance / réparation",
    administration: "Administration",
    electronique: "Électronique & informatique",
    optique_instruments: "Optique & instruments",
    recherche: "Recherche & innovation",
    ingenierie: "Ingénierie & essais",
    numerique: "Numérique & logiciels",
    machines_equipements: "Machines & équipements",
  };

  // Secteur angulaire par famille (degrés, 0 = vers le haut). Les secteurs
  // sont largement espacés : sur l'anneau des duales, jusqu'à douze nœuds
  // doivent rester dégagés les uns des autres et des labels.
  var FAMILY_ANGLES = {
    optique_instruments: -140,
    maintenance: -100,
    aeronautique_spatial: -58,
    recherche: -35,
    armement: -30,
    terrestre: 38,
    machines_equipements: 72,
    electronique: 100,
    naval: 145,
    administration: 168,
  };

  // Écartement angulaire entre nœuds d'une même famille (défaut : 20°).
  var FAMILY_SPREAD = {
    armement: 36,
  };

  var VERSION_CSV = { "2025": "NAF 2025", "2008": "NAF rév.2" };

  var state = {
    versionId: "2025",
    view: "constellation", // "constellation" | "duales"
    level: "all",
    rows: [],          // lignes validées du CSV
    pistes: [],        // lignes « dual_a_confirmer », jamais dans la vue validée
    corr: null,        // Set des codes présents dans la table de correspondance
    dualSort: "code",  // tri de la liste des duales : code | famille | preuve
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
      var duales = state.view === "duales";
      var pourquoi = state.view === "pourquoi";
      dom.panel.appendChild(el("p", "naf-viz-panel-label",
        pourquoi ? "Pourquoi ce code est-il ici ?"
          : (duales ? "Le pont civil ↔ Défense" : "La constellation Défense")));
      dom.panel.appendChild(el("p", "naf-viz-panel-help",
        pourquoi
          ? "Choisissez un code : le graphe montre d'où vient la preuve, ce " +
            "qu'on peut en conclure, et ce qu'il ne faut pas en déduire. " +
            "Aucun score : la preuve est qualitative."
          : (duales
            ? "Chaque activité documentée est reliée à la fois aux usages " +
              "civils et aux usages Défense, en deux strates selon le niveau " +
              "de preuve. Cliquez une activité pour lire pourquoi elle est " +
              "là, avec ses sources."
            : "Chaque nœud est un code NAF dont le lien avec la Défense est documenté. " +
              "Cliquez un nœud pour lire pourquoi il est là, avec sa source.")));
      if (duales) {
        var dlegend = el("ul", "naf-def-legend");
        Object.keys(DUALITE_LABELS).forEach(function (key) {
          if (key === "dual_a_confirmer") return; // jamais dans la vue validée
          var item = el("li", "naf-def-legend-item");
          var tag = el("span", "naf-def-dualtag", DUALITE_LABELS[key].tiny);
          tag.dataset.dualite = key;
          item.appendChild(tag);
          item.appendChild(el("span", null, DUALITE_LABELS[key].label));
          dlegend.appendChild(item);
        });
        dom.panel.appendChild(dlegend);
        return;
      }
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

    var isDual = isNafDual(row);
    dom.panel.appendChild(el("p", "naf-viz-panel-section",
      isDual ? "Pourquoi cette activité est-elle considérée comme duale ?"
        : "Pourquoi ce nœud est-il ici ?"));
    dom.panel.appendChild(el("p", "naf-def-just", row.justification));

    dom.panel.appendChild(el("p", "naf-viz-panel-section", "Nature de la preuve"));
    var nature = el("p", "naf-viz-panel-counts");
    dualitesOf(row).forEach(function (d) {
      if (!DUALITE_LABELS[d]) return;
      var tag = el("span", "naf-def-dualtag", DUALITE_LABELS[d].tiny);
      tag.dataset.dualite = d;
      tag.title = DUALITE_LABELS[d].label;
      nature.appendChild(tag);
      nature.appendChild(document.createTextNode(" "));
    });
    nature.appendChild(document.createTextNode(
      NATURE_LABELS[row.nature_preuve] || row.nature_preuve));
    dom.panel.appendChild(nature);

    if (row.usages_civils) {
      dom.panel.appendChild(el("p", "naf-viz-panel-section", "Usages civils documentés"));
      dom.panel.appendChild(el("p", "naf-viz-panel-counts", row.usages_civils));
    }
    if (row.usages_defense) {
      dom.panel.appendChild(el("p", "naf-viz-panel-section", "Usages Défense documentés"));
      dom.panel.appendChild(el("p", "naf-viz-panel-counts", row.usages_defense));
    }
    if (row.source_repere) {
      dom.panel.appendChild(el("p", "naf-viz-panel-section", "Repère dans la source"));
      dom.panel.appendChild(el("p", "naf-viz-panel-counts naf-def-repere",
        "Chercher : " + row.source_repere));
    }
    if (row.limite_interpretation) {
      dom.panel.appendChild(el("p", "naf-viz-panel-section", "Ce qu'il ne faut pas en déduire"));
      dom.panel.appendChild(el("p", "naf-def-limite", row.limite_interpretation));
    }

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

    dom.panel.appendChild(el("p", "naf-viz-panel-section",
      row.source_secondaire_url ? "Sources" : "Source"));
    var src = el("p", "naf-viz-panel-counts");
    var link = el("a", "naf-link", (row.source_reference || "Fiche Insee") + " ↗");
    link.href = row.source_url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    src.appendChild(link);
    dom.panel.appendChild(src);
    if (row.source_secondaire_url) {
      var src2 = el("p", "naf-viz-panel-counts");
      var link2 = el("a", "naf-link", (row.source_secondaire_reference || "Source complémentaire") + " ↗");
      link2.href = row.source_secondaire_url;
      link2.target = "_blank";
      link2.rel = "noopener noreferrer";
      src2.appendChild(link2);
      dom.panel.appendChild(src2);
    }

    var actions = el("p", "naf-def-actions");
    var explore = el("a", "naf-viz-panel-cta", "Voir dans l'Explorer →");
    explore.href = explorerUrl(row);
    actions.appendChild(explore);
    var tree = el("a", "naf-viz-panel-cta naf-def-cta-ghost", "Voir dans l'arbre →");
    tree.href = treeUrl(row);
    actions.appendChild(tree);
    // Passerelle vers la rubrique 2008 ↔ 2025, seulement quand l'extrait de
    // table de correspondance couvre réellement ce code.
    if (state.corr && state.corr.has(row.code)) {
      var compare = el("a", "naf-viz-panel-cta naf-def-cta-ghost",
        "Ce qui change entre 2008 et 2025 →");
      compare.href = "../comparer/index.html?code=" + encodeURIComponent(row.code);
      actions.appendChild(compare);
    }
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
    if (state.view === "pourquoi" && row) renderWhyChart();
    d3.select(dom.chart).selectAll("[data-sel]")
      .attr("stroke", function (d) { return d === row ? "#14181d" : "none"; })
      .attr("stroke-width", function (d) { return d === row ? 2.5 : 0; });
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
    var ringNames = {
      1: "DÉFENSE EXPLICITE",
      2: "DUALITÉ NAF DÉMONTRÉE",
      3: "DUAL-USE / ÉCOSYSTÈME OBSERVÉ — PREUVE INTERMÉDIAIRE",
    };
    [1, 2, 3].forEach(function (ring) {
      deco.append("text")
        .attr("class", "naf-def-ringlabel")
        .attr("x", cx).attr("y", cy - R[ring] - 7)
        .attr("text-anchor", "middle")
        .text(ringNames[ring]);
    });

    /* Annotations Excalifont */
    deco.append("text").attr("class", "naf-def-handsvg")
      .attr("x", cx + 48).attr("y", cy + 4)
      .attr("text-anchor", "start")
      .text("« ici, le lien est explicite »");
    var far1 = deco.append("text").attr("class", "naf-def-handsvg")
      .attr("x", cx - R[3] * 1.05).attr("y", cy + R[3] * 1.02);
    far1.append("tspan").attr("x", cx - R[3] * 1.05).text("« plus on s'éloigne,");
    far1.append("tspan").attr("x", cx - R[3] * 1.05).attr("dy", 20)
      .text("moins la NAF suffit à elle seule »");
    deco.append("text").attr("class", "naf-def-handsvg naf-def-handsvg-soft")
      .attr("x", cx + R[3] * 0.42).attr("y", cy - R[3] * 0.62)
      .text("« la preuve compte autant que le code »");
    var distNote = deco.append("text")
      .attr("class", "naf-def-handsvg naf-def-handsvg-soft")
      .attr("x", cx + R[3] * 0.30).attr("y", cy + R[3] * 0.94);
    distNote.append("tspan").attr("x", cx + R[3] * 0.30)
      .text("« la distance indique un niveau de relation,");
    distNote.append("tspan").attr("x", cx + R[3] * 0.30).attr("dy", 18)
      .text("pas une mesure économique »");

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
    var labelSpecs = [];

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
      var step = FAMILY_SPREAD[row.famille] || 20;
      var spread = group.length > 1 ? (index - (group.length - 1) / 2) * step : 0;
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

      var short = flat ? flat.label : "";
      if (short.length > 30) short = short.slice(0, 29) + "…";
      labelSpecs.push({ x: x, y: y + 26, node: { x: x, y: y }, row: row, short: short, dimmed: dimmed });

      var hit = layerHits.append("circle")
        .attr("cx", x).attr("cy", y).attr("r", 30)
        .attr("fill", "transparent")
        .attr("data-code", row.code)
        .datum(row);

      [mark, hit].forEach(function (target) {
        target.style("cursor", dimmed ? "default" : "pointer")
          .style("pointer-events", dimmed ? "none" : "auto")
          .on("click", function (event, r) { selectRow(r); });
        if (HOVER_FINE.matches) {
          target.on("mousemove", moved).on("mouseleave", hideTooltip);
        }
      });
    });

    /* Résolution déterministe des collisions d'étiquettes, en deux temps :
       1. une étiquette qui recouvre un nœud voisin glisse juste sous lui
          (simple esquive, sans chaînage) ;
       2. deux blocs d'étiquettes (~150 × 30 px) qui se chevauchent voient
          le plus bas glisser vers le bas.
       Les nœuds eux-mêmes ne bougent jamais. */
    labelSpecs.sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    for (var pass = 0; pass < 2; pass++) {
      for (var i = 0; i < labelSpecs.length; i++) {
        for (var j = i + 1; j < labelSpecs.length; j++) {
          var A = labelSpecs[i], B = labelSpecs[j];
          if (Math.abs(A.x - B.x) < 148 && B.y - A.y < 30 && B.y - A.y > -30) {
            B.y = A.y + 30;
          }
        }
      }
    }
    labelSpecs.forEach(function (spec) {
      var codeLabel = layerLabels.append("text")
        .attr("class", "naf-def-nodecode")
        .attr("x", spec.x).attr("y", spec.y)
        .attr("text-anchor", "middle")
        .attr("data-code", spec.row.code)
        .datum(spec.row)
        .attr("opacity", spec.dimmed ? 0.25 : 1)
        .text(spec.row.code);
      layerLabels.append("text")
        .attr("class", "naf-def-nodelbl")
        .attr("x", spec.x).attr("y", spec.y + 14)
        .attr("text-anchor", "middle")
        .attr("pointer-events", "none")
        .attr("opacity", spec.dimmed ? 0.25 : 1)
        .text(spec.short);
      codeLabel.style("cursor", spec.dimmed ? "default" : "pointer")
        .style("pointer-events", spec.dimmed ? "none" : "auto")
        .on("click", function (event, r) { selectRow(r); });
      if (HOVER_FINE.matches) {
        codeLabel.on("mousemove", moved).on("mouseleave", hideTooltip);
      }
    });

    dom.chart.appendChild(svg.node());
    installCamera();
    fitCamera(false);
  }

  /* ── Vue « Activités duales » : le pont civil ↔ Défense ─────────────────
     Une même activité alimente deux mondes : chaque nœud est relié à la
     fois au pôle des usages civils et au pôle des usages Défense. La
     position est catégorielle (zone duale), jamais une mesure : il n'y a
     pas de « pourcentage de dualité ». Layout déterministe, vertical sur
     mobile (le pont se lit alors de haut en bas). ─────────────────────── */

  function bridgeDemontrees() {
    // Dualités NAF démontrées : nature directe ou par renvoi — y compris
    // sur des codes explicitement militaires (ex. armes : chasse et tir
    // sportif relèvent du même code).
    return rowsForVersion().filter(function (r) { return isNafDual(r); });
  }

  function bridgeIntermediaires() {
    return rowsForVersion().filter(function (r) {
      return r.niveau_defense === "relation_intermediaire";
    });
  }

  function groupByFamily(rows) {
    var families = [], byFamily = {};
    rows.forEach(function (row) {
      if (!byFamily[row.famille]) { byFamily[row.famille] = []; families.push(row.famille); }
      byFamily[row.famille].push(row);
    });
    families.sort(function (a, b) {
      return (FAMILY_LABELS[a] || a).localeCompare(FAMILY_LABELS[b] || b);
    });
    families.forEach(function (f) {
      byFamily[f].sort(function (a, b) { return a.code.localeCompare(b.code); });
    });
    return { families: families, byFamily: byFamily };
  }

  function renderDualChart() {
    clear(dom.chart);
    var w = dom.chart.clientWidth || 320;
    var horizontal = w >= 700;

    // Deux strates : la preuve n'est pas la même, la position non plus.
    var strata = [
      {
        key: "demontree",
        title: horizontal ? "DUALITÉ NAF DÉMONTRÉE" : "DUALITÉ DÉMONTRÉE",
        tag: "Insee",
        rows: bridgeDemontrees(),
      },
      {
        key: "intermediaire",
        title: horizontal
          ? "DUAL-USE / ÉCOSYSTÈME OBSERVÉ — PREUVE INTERMÉDIAIRE"
          : "PREUVE INTERMÉDIAIRE",
        tag: "preuve interm.",
        rows: bridgeIntermediaires(),
      },
    ].filter(function (st) { return st.rows.length; });

    var rowPitch = 92;
    var headH = 54;
    var strataH = 34; // bandeau de titre de strate
    var familyCount = 0;
    strata.forEach(function (st) {
      st.groups = groupByFamily(st.rows);
      familyCount += st.groups.families.length;
    });
    var h = horizontal
      ? Math.max(430, headH + familyCount * rowPitch + strata.length * strataH + 56)
      : 240 + familyCount * (rowPitch + 26) + strata.length * (strataH + 10) + 128;

    var svg = d3.create("svg")
      .attr("viewBox", [0, 0, w, h])
      .attr("width", w).attr("height", h)
      .attr("role", "img")
      .attr("aria-label",
        "Le pont civil-Défense : chaque activité documentée est reliée à la " +
        "fois aux usages civils et aux usages Défense, en deux strates " +
        "selon le niveau de preuve. Le détail est lisible dans le panneau " +
        "et dans la liste.");
    var g = svg.append("g");

    var pole = {};
    if (horizontal) {
      pole.bandLeft = w * 0.30;
      pole.bandRight = w * 0.70;
    }

    var deco = g.append("g").attr("pointer-events", "none");
    var layerLinks = g.append("g");
    var layerNodes = g.append("g");
    var layerHits = g.append("g");
    var layerLabels = g.append("g");

    function wash(x, y, width, height, kind, title, sub) {
      deco.append("rect")
        .attr("class", "naf-def-wash naf-def-wash-" + kind)
        .attr("x", x).attr("y", y)
        .attr("width", width).attr("height", height)
        .attr("rx", 14);
      deco.append("text")
        .attr("class", "naf-def-poletitle")
        .attr("x", x + width / 2).attr("y", y + (horizontal ? 30 : 28))
        .attr("text-anchor", "middle")
        .text(title);
      deco.append("text")
        .attr("class", "naf-def-polesub")
        .attr("x", x + width / 2).attr("y", y + (horizontal ? 48 : 46))
        .attr("text-anchor", "middle")
        .text(sub);
    }

    var civilAnchor, defAnchor;
    if (horizontal) {
      var washW = Math.max(150, w * 0.19);
      wash(8, headH, washW, h - headH - 46, "civil",
        "USAGES CIVILS", "marchés civils");
      wash(w - washW - 8, headH, washW, h - headH - 46, "defense",
        "USAGES DÉFENSE", "programmes militaires");
      civilAnchor = function (y) { return { x: 8 + washW, y: y }; };
      defAnchor = function (y) { return { x: w - washW - 8, y: y }; };
      deco.append("text").attr("class", "naf-def-handsvg")
        .attr("x", w / 2).attr("y", headH - 6)
        .attr("text-anchor", "middle")
        .text("« même destination, pas toujours même niveau de preuve »");
      deco.append("text").attr("class", "naf-def-handsvg naf-def-handsvg-soft")
        .attr("x", w - washW - 16).attr("y", h - 14)
        .attr("text-anchor", "end")
        .text("« la NAF voit l'activité… pas le client final »");
    } else {
      var washH = 78;
      wash(8, 8, w - 16, washH, "civil", "USAGES CIVILS", "marchés civils");
      wash(8, h - washH - 40, w - 16, washH, "defense",
        "USAGES DÉFENSE", "programmes militaires");
      civilAnchor = function (x) { return { x: x, y: 8 + washH }; };
      defAnchor = function (x) { return { x: x, y: h - washH - 40 }; };
      var handM = deco.append("text").attr("class", "naf-def-handsvg")
        .attr("x", w / 2).attr("y", 8 + washH + 24)
        .attr("text-anchor", "middle");
      handM.append("tspan").attr("x", w / 2).text("« même destination,");
      handM.append("tspan").attr("x", w / 2).attr("dy", 18)
        .text("pas toujours même niveau de preuve »");
      deco.append("text").attr("class", "naf-def-handsvg naf-def-handsvg-soft")
        .attr("x", w / 2).attr("y", h - 12)
        .attr("text-anchor", "middle")
        .text("« la NAF voit l'activité… pas le client final »");
    }

    function strand(from, to, kind, code) {
      var mx = (from.x + to.x) / 2;
      var my = (from.y + to.y) / 2;
      var d = horizontal
        ? "M" + from.x + "," + from.y + "C" + mx + "," + from.y + " " +
          mx + "," + to.y + " " + to.x + "," + to.y
        : "M" + from.x + "," + from.y + "C" + from.x + "," + my + " " +
          to.x + "," + my + " " + to.x + "," + to.y;
      layerLinks.append("path")
        .attr("class", "naf-def-strand naf-def-strand-" + kind)
        .attr("data-code", code)
        .attr("d", d);
    }

    var cursorY = headH + (horizontal ? 10 : 88);
    strata.forEach(function (st) {
      // Bandeau de strate : le niveau de preuve est écrit, pas seulement codé.
      var bandX = horizontal ? (pole.bandLeft + pole.bandRight) / 2 : w / 2;
      deco.append("text")
        .attr("class", "naf-def-stratum naf-def-stratum-" + st.key)
        .attr("x", bandX).attr("y", cursorY + 16)
        .attr("text-anchor", "middle")
        .text(st.title);
      cursorY += strataH;

      st.groups.families.forEach(function (family) {
        var group = st.groups.byFamily[family];
        var rowY = cursorY, positions = [];
        if (horizontal) {
          var span = pole.bandRight - pole.bandLeft;
          group.forEach(function (row, i) {
            positions.push({
              x: pole.bandLeft + (span * (i + 1)) / (group.length + 1),
              y: rowY + 26,
            });
          });
          deco.append("text")
            .attr("class", "naf-def-dualfam")
            .attr("x", pole.bandLeft).attr("y", rowY)
            .attr("text-anchor", "start")
            .text(FAMILY_LABELS[family] || family);
          cursorY += rowPitch;
        } else {
          group.forEach(function (row, i) {
            positions.push({
              x: (w * (i + 1)) / (group.length + 1),
              y: rowY + 30,
            });
          });
          deco.append("text")
            .attr("class", "naf-def-dualfam")
            .attr("x", 16).attr("y", rowY)
            .attr("text-anchor", "start")
            .text(FAMILY_LABELS[family] || family);
          cursorY += rowPitch + 26;
        }

        group.forEach(function (row, i) {
          var p = positions[i];
          var key = horizontal ? p.y : p.x;
          strand(civilAnchor(key), p, "civil", row.code);
          strand(p, defAnchor(key), "defense", row.code);

          var intermediate = st.key === "intermediaire";
          var mark = layerNodes.append("circle")
            .attr("cx", p.x).attr("cy", p.y).attr("r", 11)
            .attr("fill", intermediate ? LEVELS.relation_intermediaire.color
              : LEVELS.dualite_demontree.color)
            .attr("data-code", row.code)
            .attr("data-sel", "")
            .datum(row)
            .attr("stroke", state.selected === row ? "#14181d" : "none")
            .attr("stroke-width", state.selected === row ? 2.5 : 0);
          if (intermediate) {
            // Forme distincte, pas seulement une couleur : anneau pointillé.
            layerNodes.append("circle")
              .attr("cx", p.x).attr("cy", p.y).attr("r", 15)
              .attr("fill", "none")
              .attr("stroke", LEVELS.relation_intermediaire.color)
              .attr("stroke-width", 1.6)
              .attr("stroke-dasharray", "3 3")
              .attr("pointer-events", "none");
          }

          var codeLabel = layerLabels.append("text")
            .attr("class", "naf-def-nodecode")
            .attr("x", p.x).attr("y", p.y + 28)
            .attr("text-anchor", "middle")
            .attr("data-code", row.code)
            .datum(row)
            .text(row.code);
          layerLabels.append("text")
            .attr("class", "naf-def-dualproof")
            .attr("x", p.x).attr("y", p.y + 42)
            .attr("text-anchor", "middle")
            .attr("pointer-events", "none")
            .text(st.tag);

          var hit = layerHits.append("circle")
            .attr("cx", p.x).attr("cy", p.y).attr("r", 30)
            .attr("fill", "transparent")
            .attr("data-code", row.code)
            .datum(row);

          [mark, codeLabel, hit].forEach(function (target) {
            target.style("cursor", "pointer")
              .on("click", function (event, r) { selectRow(r); highlightStrands(r.code); });
            if (HOVER_FINE.matches) {
              target.on("mousemove", function (event, r) {
                highlightStrands(r.code);
                moved(event, r);
              }).on("mouseleave", function () {
                highlightStrands(state.selected ? state.selected.code : null);
                hideTooltip();
              });
            }
          });
        });
      });
    });

    function highlightStrands(code) {
      g.selectAll(".naf-def-strand").classed("is-hot", function () {
        return code !== null &&
          d3.select(this).attr("data-code") === code;
      });
    }

    dom.chart.appendChild(svg.node());
    camera.svg = null; camera.g = null; // pas de caméra : la vue tient en page
    if (state.selected) highlightStrands(state.selected.code);
  }

  /* ── Vue « Pourquoi ce code ? » : le graphe de preuves d'un code ─────
     Lecture méthodologique : pour un code choisi, montrer d'où vient la
     preuve, ce qu'on peut en conclure, et ce qu'il ne faut pas en
     déduire. Qualitatif : aucun score, aucun pourcentage. ─────────────── */

  function whyRows() {
    return rowsForVersion().filter(function (r) {
      return dualitesOf(r).length || r.niveau_defense === "explicite_industriel" ||
        r.niveau_defense === "administration_defense";
    });
  }

  function renderWhyChart() {
    clear(dom.chart);
    var rows = whyRows();
    if (!rows.length) return;
    var row = state.selected && rows.indexOf(state.selected) !== -1
      ? state.selected
      : rows.filter(function (r) {
          return isNafDual(r) && r.niveau_defense === "dualite_demontree" &&
            r.niveau_confiance === "élevé";
        })[0] || rows.filter(isNafDual)[0] || rows[0];

    var wrap = el("div", "naf-def-why");

    // Sélecteur : deux exemples types + liste complète.
    var picker = el("div", "naf-def-why-picker");
    var strong = rows.filter(function (r) {
      return isNafDual(r) && r.niveau_confiance === "élevé" &&
        r.niveau_defense === "dualite_demontree";
    })[0];
    var inter = rows.filter(function (r) {
      return r.niveau_defense === "relation_intermediaire";
    })[0];
    [[strong, "Exemple preuve forte"], [inter, "Exemple preuve intermédiaire"]]
      .forEach(function (pair) {
        if (!pair[0]) return;
        var btn = el("button", "naf-def-why-chip", pair[1] + " : " + pair[0].code);
        btn.type = "button";
        btn.addEventListener("click", function () { selectRow(pair[0]); renderWhyChart(); });
        picker.appendChild(btn);
      });
    var select = el("select", "naf-chg-secselect naf-def-why-select");
    var selLabel = el("label", "naf-visually-hidden", "Choisir un code");
    rows.forEach(function (r) {
      var flat = nodeFor(r);
      var opt = el("option", null, r.code + " — " + (flat ? flat.label.slice(0, 52) : ""));
      opt.value = r.code;
      if (r === row) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener("change", function () {
      var chosen = rows.filter(function (r) { return r.code === select.value; })[0];
      if (chosen) { selectRow(chosen); renderWhyChart(); }
    });
    selLabel.appendChild(select);
    picker.appendChild(selLabel);
    wrap.appendChild(picker);

    // Colonne des preuves → code → conclusion.
    var level = LEVELS[row.niveau_defense] || {};
    var flat = nodeFor(row);
    var diagram = el("div", "naf-def-why-diagram");

    var sources = el("div", "naf-def-why-sources");
    sources.appendChild(el("p", "naf-def-why-coltitle", "Les preuves"));
    function evidenceCard(reference, url, repere, natureKey) {
      var card = el("div", "naf-def-why-card");
      card.appendChild(el("p", "naf-def-why-cardkind",
        NATURE_LABELS[natureKey] ? NATURE_LABELS[natureKey] : "Source"));
      var a = el("a", "naf-link", reference + " ↗");
      a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
      card.appendChild(a);
      if (repere) {
        card.appendChild(el("p", "naf-def-repere", "Chercher : " + repere));
      }
      return card;
    }
    sources.appendChild(evidenceCard(
      row.source_reference || "Fiche Insee", row.source_url,
      row.source_repere, row.nature_preuve));
    if (row.source_secondaire_url) {
      sources.appendChild(evidenceCard(
        row.source_secondaire_reference || "Source complémentaire",
        row.source_secondaire_url, "", null));
    }
    diagram.appendChild(sources);

    var arrow1 = el("div", "naf-def-why-arrow");
    arrow1.setAttribute("aria-hidden", "true");
    arrow1.textContent = "→";
    diagram.appendChild(arrow1);

    var codeCard = el("div", "naf-def-why-code");
    codeCard.style.borderColor = level.color || "#33475f";
    codeCard.appendChild(el("p", "naf-mono naf-def-why-codecode", row.code));
    codeCard.appendChild(el("p", "naf-def-why-codelbl", flat ? flat.label : ""));
    var tags = el("p", "naf-def-why-tags");
    dualitesOf(row).forEach(function (d) {
      if (!DUALITE_LABELS[d]) return;
      var tag = el("span", "naf-def-dualtag", DUALITE_LABELS[d].tiny);
      tag.dataset.dualite = d;
      tags.appendChild(tag);
      tags.appendChild(document.createTextNode(" "));
    });
    codeCard.appendChild(tags);
    diagram.appendChild(codeCard);

    var arrow2 = el("div", "naf-def-why-arrow");
    arrow2.setAttribute("aria-hidden", "true");
    arrow2.textContent = "→";
    diagram.appendChild(arrow2);

    var verdict = el("div", "naf-def-why-verdict");
    verdict.appendChild(el("p", "naf-def-why-coltitle", "Ce qu'on peut en conclure"));
    var badge = el("p", "naf-def-lvlbadge", level.label || "");
    badge.dataset.level = row.niveau_defense;
    verdict.appendChild(badge);
    var conf = CONFIDENCE[row.niveau_confiance];
    if (conf) {
      var confP = el("p", "naf-viz-panel-counts");
      confP.appendChild(el("span", "naf-def-confdots", conf.dots + " "));
      confP.appendChild(document.createTextNode(conf.label));
      verdict.appendChild(confP);
    }
    verdict.appendChild(el("p", "naf-def-why-just", row.justification));
    diagram.appendChild(verdict);

    wrap.appendChild(diagram);

    if (row.limite_interpretation) {
      var lim = el("div", "naf-def-why-limit");
      lim.appendChild(el("p", "naf-def-why-coltitle", "Ce qu'il ne faut pas en déduire"));
      lim.appendChild(el("p", null, row.limite_interpretation));
      wrap.appendChild(lim);
    }
    var hand = el("p", "naf-hand naf-def-why-hand", "« la preuve compte autant que le code »");
    hand.setAttribute("aria-hidden", "true");
    wrap.appendChild(hand);

    dom.chart.appendChild(wrap);
    camera.svg = null; camera.g = null;
  }

  function renderActiveChart() {
    if (state.view === "duales") renderDualChart();
    else if (state.view === "pourquoi") renderWhyChart();
    else renderChart();
    applyViewChrome();
  }

  function applyViewChrome() {
    var constellation = state.view === "constellation";
    if (dom.zoomCtrl) dom.zoomCtrl.hidden = !constellation;
    if (dom.filtersGroup) dom.filtersGroup.hidden = !constellation;
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
    if (!camera.g) return;
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
    if (counts.dualite_demontree) parts.push(counts.dualite_demontree + " dualités NAF démontrées");
    if (counts.relation_intermediaire) parts.push(counts.relation_intermediaire + " en preuve intermédiaire (dual-use / écosystème)");
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

  /* ── Liste des activités duales documentées ─────────────────────────── */

  var STATUT_ORDER = { dualite_demontree: 0, explicite_industriel: 1, relation_intermediaire: 2 };

  function statutLabel(row) {
    if (row.niveau_defense === "explicite_industriel") {
      return "Défense explicite — dualité NAF démontrée";
    }
    return (LEVELS[row.niveau_defense] || {}).label || row.niveau_defense;
  }

  var DUAL_SORTS = {
    code: function (a, b) { return a.code.localeCompare(b.code); },
    famille: function (a, b) {
      var fa = FAMILY_LABELS[a.famille] || a.famille;
      var fb = FAMILY_LABELS[b.famille] || b.famille;
      return fa === fb ? a.code.localeCompare(b.code) : fa.localeCompare(fb);
    },
    preuve: function (a, b) {
      var na = STATUT_ORDER[a.niveau_defense] != null ? STATUT_ORDER[a.niveau_defense] : 9;
      var nb = STATUT_ORDER[b.niveau_defense] != null ? STATUT_ORDER[b.niveau_defense] : 9;
      return na === nb ? a.code.localeCompare(b.code) : na - nb;
    },
  };

  function documentedRows() {
    // La liste couvre tout ce qui porte une nature de dualité documentée :
    // dualités NAF démontrées (y compris sur des codes explicites) et
    // relations intermédiaires. Jamais les pistes.
    return rowsForVersion().filter(function (r) { return dualitesOf(r).length; });
  }

  function renderDualCounts() {
    if (!dom.dualCounts) return;
    var rows = documentedRows();
    var demontrees = rows.filter(isNafDual);
    var byNature = {};
    rows.forEach(function (r) {
      dualitesOf(r).forEach(function (d) {
        byNature[d] = (byNature[d] || 0) + 1;
      });
    });
    var parts = [];
    parts.push(demontrees.length + " dualités NAF documentées (" +
      (byNature.dual_naf_directe || 0) + " directes, " +
      (byNature.dual_naf_crossref || 0) + " par renvoi)");
    var inter = [];
    if (byNature.technologie_dual_use) inter.push(byNature.technologie_dual_use + " technologies dual-use");
    if (byNature.ecosysteme_defense_observe) inter.push(byNature.ecosysteme_defense_observe + " observées dans l'écosystème (EDIS/REFD)");
    if (byNature.projets_duaux_documentes) inter.push(byNature.projets_duaux_documentes + " avec projets duals documentés");
    if (inter.length) parts.push(inter.join(", ") + " — catégories non exclusives");
    var pistes = state.pistes.filter(function (r) {
      return r.naf_version === VERSION_CSV[state.versionId];
    });
    if (pistes.length) parts.push(pistes.length + " pistes non validées, hors compteurs");
    dom.dualCounts.textContent = NAF.VERSIONS[state.versionId].shortLabel + " · " + parts.join(" · ") + ".";
  }

  function renderDualList() {
    if (!dom.dualList) return;
    clear(dom.dualList);
    var rows = documentedRows().slice().sort(DUAL_SORTS[state.dualSort] || DUAL_SORTS.code);

    rows.forEach(function (row) {
      var flat = nodeFor(row);
      var conf = CONFIDENCE[row.niveau_confiance];
      var item = el("li", "naf-def-dualitem");

      var head = el("button", "naf-def-dualhead");
      head.type = "button";
      head.setAttribute("aria-expanded",
        state.selected === row ? "true" : "false");
      head.appendChild(el("span", "naf-mono naf-def-dualcode", row.code));
      var body = el("span", "naf-def-dualbody");
      body.appendChild(el("span", "naf-def-duallbl", flat ? flat.label : ""));
      var meta = el("span", "naf-def-dualmeta");
      var statut = el("span", "naf-def-statut", statutLabel(row));
      statut.dataset.level = row.niveau_defense;
      meta.appendChild(statut);
      meta.appendChild(el("span", "naf-def-dualfamtag",
        FAMILY_LABELS[row.famille] || row.famille));
      dualitesOf(row).forEach(function (d) {
        if (!DUALITE_LABELS[d]) return;
        var proof = el("span", "naf-def-dualtag", DUALITE_LABELS[d].tiny);
        proof.dataset.dualite = d;
        proof.title = DUALITE_LABELS[d].label;
        meta.appendChild(proof);
      });
      if (conf) meta.appendChild(el("span", "naf-def-confdots", conf.dots + " " + conf.label));
      body.appendChild(meta);
      head.appendChild(body);
      head.addEventListener("click", function () {
        selectRow(state.selected === row ? null : row);
        renderDualList();
      });
      item.appendChild(head);

      if (state.selected === row) {
        var detail = el("div", "naf-def-dualdetail");
        detail.appendChild(el("p", "naf-def-dualwhy-title",
          isNafDual(row)
            ? "Pourquoi cette activité est-elle considérée comme duale ?"
            : "Pourquoi cette activité est-elle présente ?"));
        detail.appendChild(el("p", null, row.justification));
        if (row.usages_civils) {
          var uc = el("p", null);
          uc.appendChild(el("strong", null, "Usages civils documentés. "));
          uc.appendChild(document.createTextNode(row.usages_civils));
          detail.appendChild(uc);
        }
        if (row.usages_defense) {
          var ud = el("p", null);
          ud.appendChild(el("strong", null, "Usages Défense documentés. "));
          ud.appendChild(document.createTextNode(row.usages_defense));
          detail.appendChild(ud);
        }
        var srcs = el("p", "naf-def-dualsrc");
        srcs.appendChild(document.createTextNode("Sources : "));
        var a1 = el("a", "naf-link", row.source_reference || "Fiche Insee");
        a1.href = row.source_url; a1.target = "_blank"; a1.rel = "noopener noreferrer";
        srcs.appendChild(a1);
        if (row.source_secondaire_url) {
          srcs.appendChild(document.createTextNode(" · "));
          var a2 = el("a", "naf-link", row.source_secondaire_reference || "Source complémentaire");
          a2.href = row.source_secondaire_url; a2.target = "_blank"; a2.rel = "noopener noreferrer";
          srcs.appendChild(a2);
        }
        detail.appendChild(srcs);
        if (row.source_repere) {
          detail.appendChild(el("p", "naf-def-repere",
            "Repère dans la source — chercher : " + row.source_repere));
        }
        if (row.limite_interpretation) {
          var lim = el("p", "naf-def-limite");
          lim.appendChild(el("strong", null, "Ce qu'il ne faut pas en déduire. "));
          lim.appendChild(document.createTextNode(row.limite_interpretation));
          detail.appendChild(lim);
        }
        if (row.commentaire) {
          detail.appendChild(el("p", "naf-def-dualnote", row.commentaire));
        }
        item.appendChild(detail);
      }
      dom.dualList.appendChild(item);
    });
  }

  /* ── Documenté vs estimé ────────────────────────────────────────────── */

  function renderEstimate() {
    var node = document.getElementById("naf-def-est-doc");
    if (!node) return;
    // Le bloc porte sur la NAF 2025, indépendamment de la version affichée :
    // l'estimation analytique (≈ 35, fourchette 30–45) est écrite dans la
    // page ; seul le nombre documenté est calculé, jamais saisi.
    var n = state.rows.filter(function (r) {
      return r.naf_version === "NAF 2025" && isNafDual(r);
    }).length;
    node.textContent = String(n);
  }

  /* ── Pistes non validées, repliées et hors compteurs ────────────────── */

  function renderPistes() {
    if (!dom.pistes) return;
    clear(dom.pistes);
    var rows = state.pistes.filter(function (r) {
      return r.naf_version === VERSION_CSV[state.versionId];
    });
    if (!rows.length) {
      dom.pistes.appendChild(el("p", null,
        "Aucune piste en cours pour cette version de la nomenclature."));
      return;
    }
    dom.pistes.appendChild(el("p", null,
      "Ces activités semblent susceptibles d'être duales, mais la preuve " +
      "publique réunie à ce stade est insuffisante : elles ne sont ni " +
      "affichées dans la visualisation, ni comptées comme duales."));
    var ul = el("ul", "naf-def-pistelist");
    rows.forEach(function (row) {
      var flat = nodeFor(row);
      var li = el("li", null);
      li.appendChild(el("span", "naf-mono", row.code + " "));
      li.appendChild(el("span", null,
        (flat ? flat.label : "") + " — " + row.justification));
      ul.appendChild(li);
    });
    dom.pistes.appendChild(ul);
  }

  /* ── État ───────────────────────────────────────────────────────────── */

  function refresh() {
    renderCounts();
    renderActiveChart();
    renderPanel();
    renderList();
    renderDualCounts();
    renderDualList();
    renderEstimate();
    renderPistes();
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

  Array.prototype.forEach.call(dom.views, function (button) {
    button.addEventListener("click", function () {
      if (button.dataset.view === state.view) return;
      state.view = button.dataset.view;
      Array.prototype.forEach.call(dom.views, function (b) {
        var current = b === button;
        b.classList.toggle("is-current", current);
        b.setAttribute("aria-checked", current ? "true" : "false");
      });
      renderActiveChart();
      renderPanel();
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
      renderActiveChart();
    });
  });

  if (dom.dualSort) dom.dualSort.addEventListener("change", function () {
    state.dualSort = dom.dualSort.value;
    renderDualList();
  });

  if (dom.zoomIn) dom.zoomIn.addEventListener("click", function () {
    if (camera.svg) camera.svg.transition().duration(200).call(camera.zoom.scaleBy, 1.4);
  });
  if (dom.zoomOut) dom.zoomOut.addEventListener("click", function () {
    if (camera.svg) camera.svg.transition().duration(200).call(camera.zoom.scaleBy, 1 / 1.4);
  });
  if (dom.zoomFit) dom.zoomFit.addEventListener("click", function () { fitCamera(true); });

  window.addEventListener("resize", NAF.debounce(function () {
    if (state.rows.length) renderActiveChart();
  }, 200));

  /* ── Chargement ─────────────────────────────────────────────────────── */

  function applyUrl() {
    var params = new URLSearchParams(window.location.search);
    var wanted = params.get("view");
    if (wanted === "duales" || wanted === "pourquoi") {
      state.view = wanted;
      Array.prototype.forEach.call(dom.views, function (b) {
        var current = b.dataset.view === wanted;
        b.classList.toggle("is-current", current);
        b.setAttribute("aria-checked", current ? "true" : "false");
      });
    }
  }

  Promise.all([
    NAF.loadDefense(),
    NAF.loadNomenclature("2025"),
    NAF.loadNomenclature("2008"),
    NAF.loadCorrespondances(),
  ]).then(function (results) {
    var all = results[0].filter(function (r) { return r.code && r.niveau_defense; });
    // Les pistes « à confirmer » ne rejoignent jamais la couche validée :
    // elles vivent uniquement dans le bloc replié qui leur est dédié.
    state.rows = all.filter(function (r) { return r.niveau_defense !== "piste_dualite"; });
    state.pistes = all.filter(function (r) { return r.niveau_defense === "piste_dualite"; });
    state.nomenclatures["2025"] = results[1];
    state.nomenclatures["2008"] = results[2];
    state.corr = new Set();
    results[3].forEach(function (p) {
      state.corr.add(p.code_2008);
      state.corr.add(p.code_2025);
    });
    applyUrl();
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
