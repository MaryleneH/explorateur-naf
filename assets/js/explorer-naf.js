/**
 * explorer-naf.js
 * Logique JavaScript de l'Explorateur NAF.
 * Tous les chemins de données sont calculés relativement au document courant
 * pour fonctionner sous GitHub Pages dans un sous-répertoire.
 */
(function () {
  "use strict";

  /* ── Niveaux et libellés ───────────────────────────────────────────── */
  const LEVELS = ["section", "division", "group", "class", "subclass"];
  const LEVEL_LABELS = {
    section: "Section",
    division: "Division",
    group: "Groupe",
    class: "Classe",
    subclass: "Sous-classe",
  };

  /* ── État global ───────────────────────────────────────────────────── */
  let tree = [];
  let corresp = [];
  let defenseData = [];
  let selected = {};
  let searchNodes = [];
  let currentVersion = "2025";
  let defenseMode = false;
  let currentMobileLevel = "section";

  /* ── Références DOM ────────────────────────────────────────────────── */
  let dom = {};

  /* ═══════════════════════════════════════════════════════════════════
     UTILITAIRES CSV
  ═══════════════════════════════════════════════════════════════════ */

  function splitCsvLine(line, delim) {
    const out = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"' && inQ && line[i + 1] === '"') { cur += '"'; i++; continue; }
      if (c === '"') { inQ = !inQ; continue; }
      if (c === delim && !inQ) { out.push(cur); cur = ""; continue; }
      cur += c;
    }
    out.push(cur);
    return out;
  }

  function parseCsv(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const lines = text.split(/\r?\n/).filter(function(l) { return l.trim() !== ""; });
    if (lines.length < 2) return [];
    const delim = lines[0].includes(";") ? ";" : ",";
    const headers = splitCsvLine(lines[0], delim).map(function(h) { return h.trim(); });
    return lines.slice(1).map(function(line) {
      const cols = splitCsvLine(line, delim);
      const row = {};
      headers.forEach(function(h, i) { row[h] = (cols[i] || "").trim(); });
      return row;
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     URL DES DONNÉES (chemins relatifs au document courant)
  ═══════════════════════════════════════════════════════════════════ */

  function dataUrl(file) {
    return new URL("../data/" + file, window.location.href).href;
  }

  /* ═══════════════════════════════════════════════════════════════════
     CONSTRUCTION DE L'ARBRE
  ═══════════════════════════════════════════════════════════════════ */

  function buildTree(rows) {
    const root = [];
    const maps = {
      section: new Map(),
      division: new Map(),
      group: new Map(),
      class: new Map(),
    };

    rows.forEach(function(row) {
      const sc = row.section_code, sl = row.section_label;
      const dc = row.division_code, dl = row.division_label;
      const gc = row.group_code,    gl = row.group_label;
      const cc = row.class_code,    cl = row.class_label;
      const uc = row.subclass_code, ul = row.subclass_label;
      if (!sc || !uc) return;

      if (!maps.section.has(sc)) {
        const node = { code: sc, label: sl, level: "section", children: [] };
        maps.section.set(sc, node);
        root.push(node);
      }
      const sNode = maps.section.get(sc);

      if (!maps.division.has(dc)) {
        const node = { code: dc, label: dl, level: "division", children: [] };
        maps.division.set(dc, node);
        sNode.children.push(node);
      }
      const dNode = maps.division.get(dc);

      if (!maps.group.has(gc)) {
        const node = { code: gc, label: gl, level: "group", children: [] };
        maps.group.set(gc, node);
        dNode.children.push(node);
      }
      const gNode = maps.group.get(gc);

      if (!maps.class.has(cc)) {
        const node = { code: cc, label: cl, level: "class", children: [] };
        maps.class.set(cc, node);
        gNode.children.push(node);
      }
      const cNode = maps.class.get(cc);

      if (!cNode.children.find(function(n) { return n.code === uc; })) {
        cNode.children.push({ code: uc, label: ul, level: "subclass", children: [], row: row });
      }
    });

    return root;
  }

  /* ═══════════════════════════════════════════════════════════════════
     INDEXATION POUR LA RECHERCHE
  ═══════════════════════════════════════════════════════════════════ */

  function normalize(str) {
    return str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/['\u2019]/g, " ");
  }

  function indexNodes(nodes, path, out) {
    nodes.forEach(function(node) {
      const p = path.concat([node]);
      out.push({ node: node, path: p, searchText: normalize(node.code + " " + node.label) });
      if (node.children.length) indexNodes(node.children, p, out);
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     MARQUEURS DÉFENSE
  ═══════════════════════════════════════════════════════════════════ */

  const DEFENSE_MARKERS = {
    explicite_industriel:   { symbol: "■", title: "Défense explicite (industrie)" },
    dual_officiel:          { symbol: "◐", title: "Activité duale (civile & militaire)" },
    administration_defense: { symbol: "◇", title: "Administration Défense" },
  };

  function defenseEntryFor(code) {
    return defenseData.find(function(d) { return d.code === code; }) || null;
  }

  function countDefenseChildren(node) {
    const codes = new Set(defenseData.map(function(d) { return d.code; }));
    let n = 0;
    function walk(nd) {
      if (codes.has(nd.code)) n++;
      nd.children.forEach(walk);
    }
    node.children.forEach(walk);
    return n;
  }

  /* ═══════════════════════════════════════════════════════════════════
     RENDU DES PANNEAUX
  ═══════════════════════════════════════════════════════════════════ */

  function createItem(node, level) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "naf-item";
    if (selected[level] && selected[level].code === node.code) btn.classList.add("active");

    const inner = document.createElement("span");
    inner.className = "item-inner";

    const codeSpan = document.createElement("span");
    codeSpan.className = "code";
    codeSpan.textContent = node.code;

    const labelSpan = document.createElement("span");
    labelSpan.className = "label";
    labelSpan.textContent = node.label;

    inner.append(codeSpan, labelSpan);
    btn.appendChild(inner);

    if (defenseMode && defenseData.length) {
      const entry = defenseEntryFor(node.code);
      if (entry) {
        const mk = DEFENSE_MARKERS[entry.niveau_defense];
        if (mk) {
          const span = document.createElement("span");
          span.className = "defense-marker def-" + entry.niveau_defense;
          span.title = mk.title;
          span.setAttribute("aria-label", mk.title);
          span.textContent = mk.symbol;
          btn.appendChild(span);
        }
      } else {
        const cnt = countDefenseChildren(node);
        if (cnt > 0) {
          const badge = document.createElement("span");
          badge.className = "defense-badge";
          badge.title = cnt + " activité(s) repérée(s)";
          badge.textContent = cnt.toString();
          btn.appendChild(badge);
        }
      }
    }

    if (node.children && node.children.length > 0) {
      const chev = document.createElement("span");
      chev.className = "chevron";
      chev.setAttribute("aria-hidden", "true");
      chev.textContent = "›";
      btn.appendChild(chev);
    }

    btn.addEventListener("click", function() { onSelect(level, node); });
    li.appendChild(btn);
    return li;
  }

  function renderLevel(level, nodes) {
    const list = dom.lists[level];
    const countEl = dom.counts[level];
    if (!list) return;
    list.innerHTML = "";
    if (!nodes || nodes.length === 0) {
      const li = document.createElement("li");
      li.className = "naf-empty";
      li.textContent = level === "section" ? "Aucune donnée" : "—";
      list.appendChild(li);
      if (countEl) countEl.textContent = "";
      return;
    }
    if (countEl) countEl.textContent = nodes.length.toString();
    nodes.forEach(function(node) { list.appendChild(createItem(node, level)); });
  }

  function getNodesForLevel(level) {
    if (level === "section") return tree;
    const parentLevel = LEVELS[LEVELS.indexOf(level) - 1];
    const parent = selected[parentLevel];
    return parent ? parent.children : [];
  }

  function updatePanels() {
    LEVELS.forEach(function(level) { renderLevel(level, getNodesForLevel(level)); });
    updateBreadcrumb();
    updateActivity();
    updateMobileView();
    updateDefenseLegend();
  }

  /* ═══════════════════════════════════════════════════════════════════
     FIL D'ARIANE
  ═══════════════════════════════════════════════════════════════════ */

  function updateBreadcrumb() {
    dom.breadcrumb.innerHTML = "";
    let hasAny = false;

    LEVELS.forEach(function(level) {
      const node = selected[level];
      if (!node) return;
      hasAny = true;

      if (dom.breadcrumb.children.length > 0) {
        const sep = document.createElement("li");
        sep.className = "bc-sep";
        sep.setAttribute("aria-hidden", "true");
        sep.textContent = "›";
        dom.breadcrumb.appendChild(sep);
      }

      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bc-btn";
      const codeSpan = document.createElement("span");
      codeSpan.className = "bc-code";
      codeSpan.textContent = node.code;
      const lblSpan = document.createElement("span");
      lblSpan.className = "bc-label";
      lblSpan.textContent = node.label;
      btn.append(codeSpan, lblSpan);
      btn.addEventListener("click", (function(lv) {
        return function() {
          const idx = LEVELS.indexOf(lv);
          for (let i = idx + 1; i < LEVELS.length; i++) delete selected[LEVELS[i]];
          currentMobileLevel = lv;
          updatePanels();
        };
      })(level));
      li.appendChild(btn);
      dom.breadcrumb.appendChild(li);
    });

    if (!hasAny) {
      const li = document.createElement("li");
      li.className = "bc-placeholder";
      li.textContent = "Sélectionnez une section";
      dom.breadcrumb.appendChild(li);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     FICHE ACTIVITÉ
  ═══════════════════════════════════════════════════════════════════ */

  function updateActivity() {
    const deepest = LEVELS.slice().reverse().find(function(l) { return !!selected[l]; });
    const node = deepest ? selected[deepest] : null;

    if (!node) {
      if (dom.actCode) dom.actCode.textContent = "";
      if (dom.actLabel) dom.actLabel.textContent = "Sélectionnez une activité pour afficher sa fiche.";
      if (dom.actMeta) dom.actMeta.textContent = "";
      if (dom.actSourceLink) dom.actSourceLink.hidden = true;
      if (dom.actTabs) dom.actTabs.hidden = true;
      return;
    }

    if (dom.actCode) dom.actCode.textContent = node.code;
    if (dom.actLabel) dom.actLabel.textContent = node.label;
    if (dom.actMeta) dom.actMeta.textContent = "Version : NAF " + (currentVersion === "2025" ? "2025" : "rév.2 (2008)");
    if (dom.actTabs) dom.actTabs.hidden = false;

    const row = node.row || {};
    const srcUrl = row.source_url || "";
    if (dom.actSourceLink) {
      if (srcUrl) { dom.actSourceLink.href = srcUrl; dom.actSourceLink.hidden = false; }
      else dom.actSourceLink.hidden = true;
    }

    const detLevel = document.getElementById("detail-level");
    const detCode = document.getElementById("detail-code");
    const detLabel = document.getElementById("detail-label");
    const detVersion = document.getElementById("detail-version");
    const detPath = document.getElementById("detail-path");
    if (detLevel) detLevel.textContent = LEVEL_LABELS[node.level] || node.level;
    if (detCode) detCode.textContent = node.code;
    if (detLabel) detLabel.textContent = node.label;
    if (detVersion) detVersion.textContent = currentVersion === "2025" ? "NAF 2025" : "NAF rév.2 (2008)";
    if (detPath) detPath.textContent = LEVELS.map(function(l) { return selected[l]; })
      .filter(Boolean).map(function(n) { return n.code + " " + n.label; }).join(" › ");

    const incEl = document.getElementById("tab-include-content");
    const excEl = document.getElementById("tab-exclude-content");
    const srcNote = srcUrl
      ? ' la <a href="' + srcUrl + '" target="_blank" rel="noopener noreferrer">fiche officielle Insee ↗</a>.'
      : " la fiche officielle Insee.";
    if (incEl) {
      if (row.notes_include) incEl.textContent = row.notes_include;
      else incEl.innerHTML = "Notes explicatives détaillées disponibles sur" + srcNote;
    }
    if (excEl) {
      if (row.notes_exclude) excEl.textContent = row.notes_exclude;
      else excEl.innerHTML = "Notes explicatives détaillées disponibles sur" + srcNote;
    }

    updateCorrespondances(node.code);
    updateDefenseTab(node.code);

    const srcUrlCell = document.getElementById("source-url-cell");
    const srcRefCell = document.getElementById("source-ref-cell");
    if (srcUrlCell) srcUrlCell.innerHTML = srcUrl ? '<a href="' + srcUrl + '" target="_blank" rel="noopener noreferrer">' + srcUrl + "</a>" : "—";
    if (srcRefCell) srcRefCell.textContent = row.source_reference || "—";
  }

  function updateCorrespondances(code) {
    const el = document.getElementById("tab-corresp-content");
    if (!el) return;
    if (!corresp.length) { el.innerHTML = '<p class="tab-note">Données de correspondance non chargées.</p>'; return; }

    const pairs = currentVersion === "2025"
      ? corresp.filter(function(r) { return r.code_2025 === code; })
      : corresp.filter(function(r) { return r.code_2008 === code; });

    if (!pairs.length) { el.innerHTML = '<p class="tab-note">Aucune correspondance directe trouvée.</p>'; return; }

    const intro = currentVersion === "2025" ? "Codes NAF rév.2 correspondants :" : "Codes NAF 2025 correspondants :";
    const srcF = currentVersion === "2025" ? "code_2008" : "code_2025";
    const lblF = currentVersion === "2025" ? "libelle_2008" : "libelle_2025";
    const items = pairs.map(function(p) {
      return '<li><span class="corr-code mono">' + p[srcF] + '</span> — ' + p[lblF] +
        (p.type_correspondance ? ' <span class="corr-type">' + p.type_correspondance + '</span>' : '') + '</li>';
    }).join("");
    el.innerHTML = '<p class="tab-note-sm">' + intro + '</p><ul class="corr-list">' + items + '</ul>';
  }

  function updateDefenseTab(code) {
    const el = document.getElementById("tab-defense-content");
    if (!el) return;
    const entry = defenseEntryFor(code);
    if (!entry) {
      el.innerHTML = '<p class="tab-note">Ce code n\'a pas encore été évalué au regard de la Défense (<strong>non évalué</strong> ≠ non Défense).</p>';
      return;
    }
    const labels = {
      explicite_industriel: "■ Défense explicite (industrie)",
      dual_officiel: "◐ Activité duale (civile & militaire)",
      administration_defense: "◇ Administration Défense (secteur public)",
    };
    const warning = entry.niveau_defense === "administration_defense"
      ? '<div class="defense-warning"><strong>⚠ Avertissement :</strong> Ce code désigne l\'administration publique de la défense, pas les entreprises industrielles. Il ne doit pas être présenté comme « le code NAF de l\'industrie de Défense ».</div>'
      : "";
    el.innerHTML = '<dl class="activity-details">' +
      '<dt>Qualification</dt><dd><strong>' + (labels[entry.niveau_defense] || entry.niveau_defense) + '</strong></dd>' +
      '<dt>Justification</dt><dd>' + (entry.justification || "—") + '</dd>' +
      '<dt>Nature de la preuve</dt><dd>' + (entry.nature_preuve || "—") + '</dd>' +
      '<dt>Niveau de confiance</dt><dd>' + (entry.niveau_confiance || "—") + '</dd>' +
      '<dt>Source</dt><dd><a href="' + entry.source_url + '" target="_blank" rel="noopener noreferrer">' + entry.source_reference + '</a></dd>' +
      '</dl>' + warning +
      (entry.commentaire ? '<p class="tab-note">' + entry.commentaire + '</p>' : "");
  }

  /* ═══════════════════════════════════════════════════════════════════
     LÉGENDE DÉFENSE
  ═══════════════════════════════════════════════════════════════════ */

  function updateDefenseLegend() {
    let legend = document.getElementById("defense-legend");
    if (defenseMode && defenseData.length) {
      if (!legend) {
        legend = document.createElement("div");
        legend.id = "defense-legend";
        legend.className = "defense-legend";
        legend.innerHTML =
          '<span class="legend-title">Lecture Défense active</span>' +
          '<span class="legend-item"><span class="def-sym">■</span> Défense explicite</span>' +
          '<span class="legend-item"><span class="def-sym">◐</span> Activité duale</span>' +
          '<span class="legend-item"><span class="def-sym">◇</span> Administration Défense</span>';
        dom.browser.after(legend);
      }
    } else if (legend) {
      legend.remove();
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     NAVIGATION MOBILE
  ═══════════════════════════════════════════════════════════════════ */

  function updateMobileView() {
    const isMobile = window.matchMedia("(max-width: 768px)").matches;
    document.querySelectorAll(".naf-panel").forEach(function(p) { p.classList.remove("mobile-visible"); });
    if (!isMobile) return;
    const panel = document.querySelector('.naf-panel[data-level="' + currentMobileLevel + '"]');
    if (panel) panel.classList.add("mobile-visible");
    if (dom.mobileLevelLabel) dom.mobileLevelLabel.textContent = LEVEL_LABELS[currentMobileLevel] || "";
    if (dom.mobileBack) dom.mobileBack.disabled = LEVELS.indexOf(currentMobileLevel) === 0;
  }

  /* ═══════════════════════════════════════════════════════════════════
     SÉLECTION D'UN ÉLÉMENT
  ═══════════════════════════════════════════════════════════════════ */

  function onSelect(level, node) {
    selected[level] = node;
    const idx = LEVELS.indexOf(level);
    for (let i = idx + 1; i < LEVELS.length; i++) delete selected[LEVELS[i]];
    const nextLevel = LEVELS[idx + 1];
    if (nextLevel) currentMobileLevel = nextLevel;
    updatePanels();
  }

  /* ═══════════════════════════════════════════════════════════════════
     RECHERCHE
  ═══════════════════════════════════════════════════════════════════ */

  function debounce(fn, ms) {
    let t;
    return function() {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(function() { fn.apply(null, args); }, ms);
    };
  }

  function applySearch() {
    const raw = dom.search ? dom.search.value.trim() : "";
    const term = normalize(raw);
    const panel = dom.searchResults;
    if (!panel) return;

    if (!term) { panel.hidden = true; panel.innerHTML = ""; return; }

    const matches = searchNodes.filter(function(e) { return e.searchText.includes(term); }).slice(0, 12);
    panel.innerHTML = "";

    if (!matches.length) {
      const p = document.createElement("p");
      p.className = "sr-empty";
      p.textContent = "Aucun résultat.";
      panel.appendChild(p);
      panel.hidden = false;
      return;
    }

    matches.forEach(function(entry) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sr-item";
      const pathStr = entry.path.map(function(n) { return n.code; }).join(" › ");
      const codeSpan = document.createElement("span");
      codeSpan.className = "sr-code mono";
      codeSpan.textContent = entry.node.code;
      const lblSpan = document.createElement("span");
      lblSpan.className = "sr-label";
      lblSpan.textContent = entry.node.label;
      const metaSpan = document.createElement("span");
      metaSpan.className = "sr-meta";
      metaSpan.textContent = (LEVEL_LABELS[entry.node.level] || entry.node.level) + " · " + pathStr;
      btn.append(codeSpan, lblSpan, metaSpan);
      btn.addEventListener("click", (function(e) {
        return function() {
          selected = {};
          e.path.forEach(function(n) { selected[n.level] = n; });
          currentMobileLevel = LEVELS[Math.min(e.path.length - 1, LEVELS.length - 1)];
          if (dom.search) dom.search.value = "";
          panel.hidden = true;
          panel.innerHTML = "";
          updatePanels();
        };
      })(entry));
      panel.appendChild(btn);
    });

    panel.hidden = false;
  }

  /* ═══════════════════════════════════════════════════════════════════
     CHARGEMENT DES DONNÉES
  ═══════════════════════════════════════════════════════════════════ */

  function setStatus(msg) {
    if (dom.status) dom.status.textContent = msg;
  }

  function loadCsv(file) {
    const url = dataUrl(file);
    return fetch(url).then(function(resp) {
      if (!resp.ok) throw new Error("HTTP " + resp.status + " pour " + url);
      return resp.text();
    }).then(function(text) { return parseCsv(text); });
  }

  function loadAuxData() {
    const p1 = loadCsv("correspondances_2008_2025.csv").then(function(d) { corresp = d; })
      .catch(function(e) { console.warn("Correspondances non chargées :", e.message); corresp = []; });
    const p2 = loadCsv("defense_qualification.csv").then(function(d) { defenseData = d; })
      .catch(function(e) { console.warn("Données Défense non chargées :", e.message); defenseData = []; });
    return Promise.all([p1, p2]);
  }

  function loadVersion(version) {
    currentVersion = version;
    selected = {};
    currentMobileLevel = "section";
    tree = [];
    searchNodes = [];
    setStatus("Chargement…");

    return loadCsv("naf" + version + ".csv").then(function(rows) {
      tree = buildTree(rows);
      const out = [];
      indexNodes(tree, [], out);
      searchNodes = out;
      setStatus(out.length + " entrée(s) indexée(s).");
      updatePanels();
    }).catch(function(e) {
      console.error("Impossible de charger la nomenclature :", e);
      setStatus("Impossible de charger la nomenclature.");
      updatePanels();
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     ONGLETS DE LA FICHE ACTIVITÉ
  ═══════════════════════════════════════════════════════════════════ */

  function initTabs() {
    const tabNav = document.querySelector(".tab-nav");
    if (!tabNav) return;
    tabNav.addEventListener("click", function(e) {
      const btn = e.target.closest(".tab-btn");
      if (!btn) return;
      const tabId = btn.dataset.tab;
      tabNav.querySelectorAll(".tab-btn").forEach(function(b) {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", (b === btn).toString());
      });
      document.querySelectorAll(".tab-panel").forEach(function(p) {
        const isTarget = p.id === "tab-" + tabId;
        p.classList.toggle("active", isTarget);
        p.hidden = !isTarget;
      });
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     INITIALISATION
  ═══════════════════════════════════════════════════════════════════ */

  function init() {
    dom.browser = document.getElementById("naf-browser");
    if (!dom.browser) return;

    dom.lists = {};
    dom.counts = {};
    LEVELS.forEach(function(l) {
      dom.lists[l] = document.getElementById("list-" + l);
      dom.counts[l] = document.getElementById("panel-count-" + l);
    });
    dom.search = document.getElementById("naf-search");
    dom.searchResults = document.getElementById("naf-search-results");
    dom.breadcrumb = document.getElementById("naf-breadcrumb");
    dom.status = document.getElementById("explorer-status");
    dom.mobileBack = document.getElementById("mobile-back");
    dom.mobileLevelLabel = document.getElementById("mobile-level-label");
    dom.defenseModeBtn = document.getElementById("defense-mode");
    dom.actCode = document.getElementById("activity-code");
    dom.actLabel = document.getElementById("activity-label");
    dom.actMeta = document.getElementById("activity-meta");
    dom.actSourceLink = document.getElementById("activity-source-link");
    dom.actTabs = document.getElementById("activity-tabs");

    if (dom.search) {
      dom.search.addEventListener("input", debounce(applySearch, 150));
      document.addEventListener("click", function(e) {
        if (dom.searchResults && !dom.search.contains(e.target) && !dom.searchResults.contains(e.target)) {
          dom.searchResults.hidden = true;
        }
      });
    }

    document.querySelectorAll('input[name="naf-version"]').forEach(function(radio) {
      radio.addEventListener("change", function(e) { loadVersion(e.target.value); });
    });

    if (dom.defenseModeBtn) {
      dom.defenseModeBtn.addEventListener("click", function() {
        defenseMode = !defenseMode;
        dom.defenseModeBtn.setAttribute("aria-pressed", defenseMode.toString());
        dom.defenseModeBtn.classList.toggle("active", defenseMode);
        updatePanels();
      });
    }

    if (dom.mobileBack) {
      dom.mobileBack.addEventListener("click", function() {
        const idx = LEVELS.indexOf(currentMobileLevel);
        if (idx > 0) currentMobileLevel = LEVELS[idx - 1];
        updateMobileView();
      });
    }

    window.addEventListener("resize", debounce(updateMobileView, 150));
    initTabs();

    loadAuxData().then(function() { loadVersion("2025"); });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
