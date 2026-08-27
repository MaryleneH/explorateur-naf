/**
 * naf-changements.js
 * « Explorer les changements » : parcours de la table de correspondance
 * NAF rév.2 → NAF 2025 sans avoir à taper le moindre code.
 *
 * Principes :
 *   - tout compteur affiché est CALCULÉ depuis les CSV, jamais saisi ici ;
 *   - l'unité de lecture n'est pas la ligne de la table mais le GROUPE de
 *     transformation : la fermeture transitive des relations (une scission
 *     1→n est un groupe, une recomposition n↔n aussi). C'est la seule façon
 *     de compter « une transformation = un événement » sans double compte ;
 *   - la table locale est un extrait partiel, intra-classe : la couverture
 *     réelle est affichée et la table officielle Insee citée en référence.
 */
(function () {
  "use strict";

  var NAF = window.NAF;
  var root = document.getElementById("naf-chg");
  if (!root) return;

  var el = NAF.el;

  var dom = {
    stats: document.getElementById("naf-chg-stats"),
    cover: document.getElementById("naf-chg-cover"),
    filters: document.getElementById("naf-chg-filters"),
    section: document.getElementById("naf-chg-section"),
    form: document.getElementById("naf-chg-form"),
    input: document.getElementById("naf-chg-q"),
    clear: document.getElementById("naf-chg-clear"),
    count: document.getElementById("naf-chg-count"),
    list: document.getElementById("naf-chg-list"),
    pager: document.getElementById("naf-chg-pager"),
  };

  var OFFICIAL_URL = "https://www.insee.fr/fr/information/8201411";
  var PAGE_SIZE = 20;

  /* Typologie calculée sur les cardinalités réelles du groupe. */
  var TYPES = {
    identique: {
      id: "identique",
      badge: "1→1",
      label: "Reprises à l'identique",
      one: "reprise à l'identique",
      explain: function () {
        return "Le contenu de la sous-classe ne change pas : seul le code change. " +
          "Les entreprises concernées ne changent pas d'activité.";
      },
    },
    scission: {
      id: "scission",
      badge: "1→n",
      label: "Scissions",
      one: "scission",
      explain: function (g) {
        return "Une sous-classe 2008 est découpée en " + g.codes25.length +
          " sous-classes 2025 : le niveau de détail augmente, le périmètre " +
          "global reste le même.";
      },
    },
    regroupement: {
      id: "regroupement",
      badge: "n→1",
      label: "Regroupements",
      one: "regroupement",
      explain: function (g) {
        return g.codes08.length + " sous-classes 2008 sont réunies en une seule : " +
          "le détail diminue, mais rien ne disparaît de l'économie réelle.";
      },
    },
    recomposition: {
      id: "recomposition",
      badge: "n↔n",
      label: "Recompositions",
      one: "recomposition",
      explain: function (g) {
        return "Le périmètre est redécoupé entre " + g.codes08.length +
          " sous-classes 2008 et " + g.codes25.length + " sous-classes 2025 : " +
          "les frontières bougent, sans correspondance simple ligne à ligne.";
      },
    },
  };
  var TYPE_ORDER = ["recomposition", "scission", "regroupement", "identique"];

  var state = {
    groups: [],
    bySection: null,     // Map lettre → nb de groupes
    type: "tous",
    section: "toutes",
    query: "",
    page: 0,
    openId: null,
    n08: null,
    n25: null,
  };

  /* ───────────────────────────────────────────────────────────────────
     Groupes de transformation (union-find sur les lignes de la table)
  ─────────────────────────────────────────────────────────────────── */

  function buildGroups(pairs, sec08) {
    var parent = new Map();
    function find(x) {
      var r = x;
      while (parent.get(r) !== r) r = parent.get(r);
      while (parent.get(x) !== r) { var n = parent.get(x); parent.set(x, r); x = n; }
      return r;
    }
    function union(a, b) {
      var ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    }

    pairs.forEach(function (p) {
      var a = "08:" + p.code_2008, b = "25:" + p.code_2025;
      if (!parent.has(a)) parent.set(a, a);
      if (!parent.has(b)) parent.set(b, b);
      union(a, b);
    });

    var byRoot = new Map();
    pairs.forEach(function (p) {
      var key = find("08:" + p.code_2008);
      var g = byRoot.get(key);
      if (!g) {
        g = { lines: [], m08: new Map(), m25: new Map() };
        byRoot.set(key, g);
      }
      g.lines.push(p);
      g.m08.set(p.code_2008, p.libelle_2008);
      g.m25.set(p.code_2025, p.libelle_2025);
    });

    var groups = [];
    byRoot.forEach(function (g) {
      var codes08 = Array.from(g.m08.keys()).sort();
      var codes25 = Array.from(g.m25.keys()).sort();
      var type = codes08.length === 1
        ? (codes25.length === 1 ? "identique" : "scission")
        : (codes25.length === 1 ? "regroupement" : "recomposition");
      var text = "";
      g.m08.forEach(function (label, code) { text += " " + code + " " + label; });
      g.m25.forEach(function (label, code) { text += " " + code + " " + label; });
      groups.push({
        id: codes08[0],
        codes08: codes08,
        codes25: codes25,
        labels08: g.m08,
        labels25: g.m25,
        lines: g.lines,
        type: type,
        section: sec08.get(codes08[0]) || "",
        normText: NAF.normalize(text),
        normCodes: (codes08.concat(codes25)).map(NAF.normalizeCode).join(" "),
      });
    });

    groups.sort(function (a, b) {
      var ta = a.type === "identique" ? 1 : 0;
      var tb = b.type === "identique" ? 1 : 0;
      if (ta !== tb) return ta - tb;              // transformations d'abord
      var sa = a.codes08.length + a.codes25.length;
      var sb = b.codes08.length + b.codes25.length;
      if (sa !== sb) return sb - sa;              // les plus amples d'abord
      return a.id.localeCompare(b.id);
    });

    return groups;
  }

  /* ───────────────────────────────────────────────────────────────────
     Bandeaux calculés : chiffres clés et couverture
  ─────────────────────────────────────────────────────────────────── */

  function renderStats() {
    var c08 = state.n08.counts.subclass;
    var c25 = state.n25.counts.subclass;
    var delta = c25 - c08;

    clearNode(dom.stats);

    var twin = el("div", "naf-chg-twin");
    twin.appendChild(statCard("NAF rév.2 — 2008", c08, "sous-classes"));
    var arrow = el("div", "naf-chg-twin-arrow", "→");
    arrow.setAttribute("aria-hidden", "true");
    twin.appendChild(arrow);
    twin.appendChild(statCard("NAF 2025", c25, "sous-classes"));
    dom.stats.appendChild(twin);

    var note = el("p", "naf-chg-delta");
    note.appendChild(el("strong", null, (delta >= 0 ? "+" : "") + delta + " sous-classes au total"));
    note.appendChild(document.createTextNode(
      " — ce n'est pas « " + Math.abs(delta) + " activités " +
      (delta >= 0 ? "nouvelles" : "disparues") + " » : l'essentiel du mouvement " +
      "est un redécoupage de sous-classes existantes."));
    dom.stats.appendChild(note);
  }

  function statCard(title, value, unit) {
    var card = el("div", "naf-chg-card");
    card.appendChild(el("span", "naf-chg-card-title", title));
    card.appendChild(el("span", "naf-chg-card-value", String(value)));
    card.appendChild(el("span", "naf-chg-card-unit", unit));
    return card;
  }

  function renderCoverage(pairs) {
    var cov08 = new Set(), cov25 = new Set();
    pairs.forEach(function (p) { cov08.add(p.code_2008); cov25.add(p.code_2025); });

    clearNode(dom.cover);
    var p1 = el("p", null);
    p1.appendChild(el("strong", null, "Extrait partiel de la table officielle. "));
    p1.appendChild(document.createTextNode(
      "La table chargée ici compte " + pairs.length + " relations, couvrant " +
      cov08.size + " des " + state.n08.counts.subclass + " sous-classes 2008 et " +
      cov25.size + " des " + state.n25.counts.subclass + " sous-classes 2025. " +
      "Elle ne contient que des relations restant dans la même classe (xx.xx) : " +
      "les correspondances qui changent de classe — comme 30.30Z vers " +
      "30.31Y/30.32Y — n'y figurent pas. Une absence ici ne signifie donc " +
      "jamais une absence de correspondance. "));
    var link = el("a", null, "La table officielle Insee fait foi");
    link.href = OFFICIAL_URL;
    link.target = "_blank";
    link.rel = "noopener";
    p1.appendChild(link);
    p1.appendChild(document.createTextNode("."));
    dom.cover.appendChild(p1);
  }

  /* ───────────────────────────────────────────────────────────────────
     Filtres
  ─────────────────────────────────────────────────────────────────── */

  function renderFilters() {
    clearNode(dom.filters);

    var counts = { tous: state.groups.length };
    TYPE_ORDER.forEach(function (t) { counts[t] = 0; });
    state.groups.forEach(function (g) { counts[g.type]++; });

    filterButton("tous", "Toutes", counts.tous);
    ["identique", "scission", "regroupement", "recomposition"].forEach(function (t) {
      filterButton(t, TYPES[t].label + " " + TYPES[t].badge, counts[t]);
    });
  }

  function filterButton(id, label, count) {
    var btn = el("button", "naf-chg-filter");
    btn.type = "button";
    btn.dataset.type = id;
    btn.appendChild(el("span", null, label));
    btn.appendChild(el("span", "naf-chg-filter-count", String(count)));
    btn.setAttribute("aria-pressed", state.type === id ? "true" : "false");
    btn.addEventListener("click", function () {
      state.type = id;
      state.page = 0;
      syncFilterButtons();
      renderList();
    });
    dom.filters.appendChild(btn);
  }

  function syncFilterButtons() {
    Array.prototype.forEach.call(dom.filters.children, function (btn) {
      btn.setAttribute("aria-pressed", btn.dataset.type === state.type ? "true" : "false");
    });
  }

  function renderSectionSelect() {
    state.bySection = new Map();
    state.groups.forEach(function (g) {
      state.bySection.set(g.section, (state.bySection.get(g.section) || 0) + 1);
    });

    clearNode(dom.section);
    var all = el("option", null, "Toutes les sections");
    all.value = "toutes";
    dom.section.appendChild(all);

    Array.from(state.bySection.keys()).sort().forEach(function (letter) {
      var node = state.n08.byCode.get("section:" + letter);
      var label = node ? node.label : "";
      var opt = el("option", null,
        letter + " — " + truncate(label, 44) + " (" + state.bySection.get(letter) + ")");
      opt.value = letter;
      dom.section.appendChild(opt);
    });

    dom.section.addEventListener("change", function () {
      state.section = dom.section.value;
      state.page = 0;
      renderList();
    });
  }

  /* ───────────────────────────────────────────────────────────────────
     Liste paginée
  ─────────────────────────────────────────────────────────────────── */

  function visibleGroups() {
    var q = NAF.normalize(state.query);
    var qCode = NAF.normalizeCode(state.query);
    return state.groups.filter(function (g) {
      if (state.type !== "tous" && g.type !== state.type) return false;
      if (state.section !== "toutes" && g.section !== state.section) return false;
      if (q) {
        var inCodes = qCode && g.normCodes.indexOf(qCode) !== -1;
        var inText = q.length >= 3 && g.normText.indexOf(q) !== -1;
        if (!inCodes && !inText) return false;
      }
      return true;
    });
  }

  function renderList() {
    var visible = visibleGroups();
    var pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
    if (state.page >= pages) state.page = pages - 1;
    var slice = visible.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);

    dom.count.textContent = visible.length === 0
      ? "Aucune transformation ne correspond à ces critères."
      : visible.length + (visible.length === 1 ? " transformation" : " transformations") +
        " — les plus amples d'abord, les reprises à l'identique ensuite.";

    clearNode(dom.list);
    slice.forEach(function (g) {
      dom.list.appendChild(renderGroup(g));
    });

    renderPager(visible.length, pages);
  }

  function renderPager(total, pages) {
    clearNode(dom.pager);
    if (total === 0) return;

    var prev = el("button", "naf-chg-page-btn", "‹ Précédent");
    prev.type = "button";
    prev.disabled = state.page === 0;
    prev.addEventListener("click", function () {
      state.page--; renderList(); dom.list.scrollIntoView({ block: "start", behavior: "auto" });
    });

    var next = el("button", "naf-chg-page-btn", "Suivant ›");
    next.type = "button";
    next.disabled = state.page >= pages - 1;
    next.addEventListener("click", function () {
      state.page++; renderList(); dom.list.scrollIntoView({ block: "start", behavior: "auto" });
    });

    dom.pager.appendChild(prev);
    dom.pager.appendChild(el("span", "naf-chg-page-status",
      "Page " + (state.page + 1) + " / " + pages));
    dom.pager.appendChild(next);
  }

  /* ───────────────────────────────────────────────────────────────────
     Rendu d'un groupe : en-tête cliquable + fiche dépliable
  ─────────────────────────────────────────────────────────────────── */

  function renderGroup(g) {
    var item = el("li", "naf-chg-item naf-chg-item-" + g.type);
    item.id = "chg-" + g.id.replace(/\./g, "");

    var head = el("button", "naf-chg-head");
    head.type = "button";
    head.setAttribute("aria-expanded", state.openId === g.id ? "true" : "false");

    var badge = el("span", "naf-chg-badge naf-chg-badge-" + g.type, TYPES[g.type].badge);
    badge.title = TYPES[g.type].one;
    head.appendChild(badge);

    var codes = el("span", "naf-chg-codes");
    codes.appendChild(el("span", "naf-chg-codes-08", g.codes08.join(" + ")));
    var arr = el("span", "naf-chg-codes-arrow", "→");
    arr.setAttribute("aria-hidden", "true");
    codes.appendChild(arr);
    codes.appendChild(el("span", "naf-chg-codes-25", g.codes25.join(" + ")));
    head.appendChild(codes);

    head.appendChild(el("span", "naf-chg-hint",
      truncate(g.labels08.get(g.codes08[0]) || "", 66)));

    head.addEventListener("click", function () {
      state.openId = state.openId === g.id ? null : g.id;
      renderList();
    });

    item.appendChild(head);

    if (state.openId === g.id) {
      item.appendChild(renderDetail(g));
    }
    return item;
  }

  function renderDetail(g) {
    var detail = el("div", "naf-chg-detail");

    var cols = el("div", "naf-chg-detail-cols");
    cols.appendChild(detailColumn("Avant — NAF rév.2 (2008)", "2008", g.codes08, g.labels08));
    cols.appendChild(detailColumn("Après — NAF 2025", "2025", g.codes25, g.labels25));
    detail.appendChild(cols);

    var typeP = el("p", "naf-chg-detail-type");
    typeP.appendChild(el("strong", null,
      TYPES[g.type].badge + " · " + capitalize(TYPES[g.type].one) + ". "));
    typeP.appendChild(document.createTextNode(TYPES[g.type].explain(g)));
    detail.appendChild(typeP);

    var first = g.lines[0];
    if (first && (first.source_reference || first.source_url)) {
      var src = el("p", "naf-chg-detail-source");
      src.appendChild(document.createTextNode("Source : "));
      if (first.source_url) {
        var a = el("a", null, first.source_reference || first.source_url);
        a.href = first.source_url;
        a.target = "_blank";
        a.rel = "noopener";
        src.appendChild(a);
      } else {
        src.appendChild(document.createTextNode(first.source_reference));
      }
      detail.appendChild(src);
    }

    var actions = el("p", "naf-chg-detail-actions");
    var flux = el("a", "naf-chg-cta", "Voir cette transformation dans les flux");
    flux.href = "flux.html?code=" + encodeURIComponent(g.codes08[0]);
    actions.appendChild(flux);
    detail.appendChild(actions);

    return detail;
  }

  function detailColumn(title, versionId, codes, labels) {
    var col = el("div", "naf-chg-detail-col");
    col.appendChild(el("h4", null, title));
    var ul = el("ul", null);
    codes.forEach(function (code) {
      var li = el("li", null);
      var a = el("a", "naf-chg-code", code);
      a.href = "../explorer/?v=" + versionId + "&code=" + encodeURIComponent(code);
      a.title = "Ouvrir " + code + " dans l'Explorateur (" +
        NAF.VERSIONS[versionId].shortLabel + ")";
      li.appendChild(a);
      li.appendChild(document.createTextNode(" " + (labels.get(code) || "")));
      ul.appendChild(li);
    });
    col.appendChild(ul);
    return col;
  }

  /* ───────────────────────────────────────────────────────────────────
     Ouverture directe d'un groupe (exemples éditoriaux, liens profonds)
  ─────────────────────────────────────────────────────────────────── */

  function openGroupByCode(code) {
    var wanted = NAF.normalizeCode(code);
    var group = null;
    for (var i = 0; i < state.groups.length; i++) {
      var g = state.groups[i];
      var all = g.codes08.concat(g.codes25);
      for (var j = 0; j < all.length; j++) {
        if (NAF.normalizeCode(all[j]) === wanted) { group = g; break; }
      }
      if (group) break;
    }
    if (!group) return false;

    state.type = "tous";
    state.section = "toutes";
    state.query = "";
    dom.input.value = "";
    dom.section.value = "toutes";
    syncFilterButtons();

    var visible = visibleGroups();
    var index = visible.indexOf(group);
    state.page = index >= 0 ? Math.floor(index / PAGE_SIZE) : 0;
    state.openId = group.id;
    renderList();

    var target = document.getElementById("chg-" + group.id.replace(/\./g, ""));
    if (target) target.scrollIntoView({ block: "center", behavior: "auto" });
    return true;
  }

  function bindFeatured() {
    Array.prototype.forEach.call(
      document.querySelectorAll("[data-chg-open]"),
      function (btn) {
        btn.addEventListener("click", function () {
          openGroupByCode(btn.getAttribute("data-chg-open"));
        });
      });
  }

  function applyUrl() {
    var params = new URLSearchParams(window.location.search);
    var code = params.get("code");
    if (code && openGroupByCode(code)) return;

    var type = params.get("type");
    if (type && (type === "tous" || TYPES[type])) {
      state.type = type;
      syncFilterButtons();
    }
    var section = params.get("section");
    if (section && state.bySection.has(section)) {
      state.section = section;
      dom.section.value = section;
    }
    renderList();
  }

  /* ───────────────────────────────────────────────────────────────────
     Divers
  ─────────────────────────────────────────────────────────────────── */

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function truncate(str, max) {
    return str.length > max ? str.slice(0, max - 1).trimEnd() + "…" : str;
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /* ───────────────────────────────────────────────────────────────────
     Démarrage
  ─────────────────────────────────────────────────────────────────── */

  Promise.all([
    NAF.loadCorrespondances(),
    NAF.loadNomenclature("2008"),
    NAF.loadNomenclature("2025"),
  ]).then(function (results) {
    var pairs = results[0];
    state.n08 = results[1];
    state.n25 = results[2];

    var sec08 = new Map();
    state.n08.rows.forEach(function (row) {
      sec08.set(row.subclass_code, row.section_code);
    });

    state.groups = buildGroups(pairs, sec08);

    renderStats();
    renderCoverage(pairs);
    renderFilters();
    renderSectionSelect();
    renderList();
    bindFeatured();
    applyUrl();
  }).catch(function (error) {
    dom.count.textContent =
      "Impossible de charger les données (" + error.message + ").";
  });

  dom.form.addEventListener("submit", function (event) { event.preventDefault(); });

  dom.input.addEventListener("input", NAF.debounce(function () {
    state.query = dom.input.value.trim();
    state.page = 0;
    dom.clear.hidden = !state.query;
    renderList();
  }, 150));

  dom.clear.addEventListener("click", function () {
    dom.input.value = "";
    state.query = "";
    state.page = 0;
    dom.clear.hidden = true;
    renderList();
    dom.input.focus();
  });
})();
