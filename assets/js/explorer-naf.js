(function () {
  const levels = ["section", "division", "group", "class", "subclass"];
  const labelsByLevel = {
    section: "Section",
    division: "Division",
    group: "Groupe",
    class: "Classe",
    subclass: "Sous-classe"
  };

  function splitCsvLine(line, delimiter) {
    const out = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      const next = line[i + 1];

      if (char === "\"" && inQuotes && next === "\"") {
        current += "\"";
        i += 1;
        continue;
      }

      if (char === "\"") {
        inQuotes = !inQuotes;
        continue;
      }

      if (char === delimiter && !inQuotes) {
        out.push(current.trim());
        current = "";
        continue;
      }

      current += char;
    }

    out.push(current.trim());
    return out;
  }

  function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
    if (lines.length < 2) return [];

    const delimiter = lines[0].includes(";") ? ";" : ",";
    const headers = splitCsvLine(lines[0], delimiter).map((h) => h.trim());
    return lines.slice(1).map((line) => {
      const cols = splitCsvLine(line, delimiter);
      const row = {};
      headers.forEach((h, i) => {
        row[h] = (cols[i] || "").trim();
      });
      return row;
    });
  }

  function buildTree(rows) {
    const root = [];
    const sectionMap = new Map();

    rows.forEach((row) => {
      const sectionCode = row.section_code;
      const sectionLabel = row.section_label;
      if (!sectionCode || !sectionLabel) return;

      if (!sectionMap.has(sectionCode)) {
        sectionMap.set(sectionCode, {
          code: sectionCode,
          label: sectionLabel,
          level: "section",
          children: []
        });
        root.push(sectionMap.get(sectionCode));
      }

      const section = sectionMap.get(sectionCode);
      const division = getOrCreateChild(section, "division", row.division_code, row.division_label);
      const group = getOrCreateChild(division, "group", row.group_code, row.group_label);
      const clazz = getOrCreateChild(group, "class", row.class_code, row.class_label);
      getOrCreateChild(clazz, "subclass", row.subclass_code, row.subclass_label);
    });

    return root;
  }

  function getOrCreateChild(parent, level, code, label) {
    if (!parent || !code || !label) return parent;
    let found = parent.children.find((c) => c.code === code);
    if (!found) {
      found = { code, label, level, children: [] };
      parent.children.push(found);
    }
    return found;
  }

  function textForNode(node) {
    return node ? `${node.code} ${node.label}` : "";
  }

  function debounce(fn, wait = 120) {
    let timer = null;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function initExplorer() {
    const browser = document.getElementById("naf-browser");
    if (!browser) return;

    const lists = Object.fromEntries(levels.map((level) => [level, document.getElementById(`list-${level}`)]));
    const searchInput = document.getElementById("naf-search");
    const breadcrumb = document.getElementById("naf-breadcrumb");
    const status = document.getElementById("explorer-status");
    const mobileBack = document.getElementById("mobile-back");
    const mobileLevelLabel = document.getElementById("mobile-level-label");
    const defenseModeBtn = document.getElementById("defense-mode");
    const activityCode = document.getElementById("activity-code");
    const activityLabel = document.getElementById("activity-label");
    const activityMeta = document.getElementById("activity-meta");
    const activityPath = document.getElementById("activity-path");

    let tree = [];
    let selected = {};
    let searchableNodes = [];
    let currentMobileLevel = "section";

    function setStatus(message) {
      status.textContent = message;
    }

    function createItem(node, level, isPlaceholder) {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "naf-item";
      if (isPlaceholder) button.disabled = true;

      const content = document.createElement("span");
      content.innerHTML = isPlaceholder
        ? `<span class="label">${node.label}</span>`
        : `<span class="code">${node.code}</span><span class="label">${node.label}</span>`;

      const trail = document.createElement("span");
      trail.textContent = isPlaceholder ? "" : node.children.length > 0 ? "›" : "";
      trail.setAttribute("aria-hidden", "true");

      button.append(content, trail);
      if (!isPlaceholder) {
        button.addEventListener("click", () => onSelect(level, node));
        button.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(level, node);
          }
        });
      }
      li.appendChild(button);
      return li;
    }

    function renderLevel(level, nodes) {
      const list = lists[level];
      if (!list) return;
      list.innerHTML = "";

      if (!nodes || nodes.length === 0) {
        list.appendChild(createItem({ label: "Données à intégrer" }, level, true));
        return;
      }

      nodes.forEach((node) => {
        const item = createItem(node, level, false);
        const btn = item.querySelector("button");
        if (selected[level] && selected[level].code === node.code) {
          btn.classList.add("active");
        }
        list.appendChild(item);
      });
    }

    function clearChildren(fromLevelIndex) {
      for (let i = fromLevelIndex; i < levels.length; i += 1) {
        delete selected[levels[i]];
      }
    }

    function getNodesForLevel(level) {
      if (level === "section") return tree;
      const parentLevel = levels[levels.indexOf(level) - 1];
      const parent = selected[parentLevel];
      return parent ? parent.children : [];
    }

    function updatePanels() {
      levels.forEach((level) => renderLevel(level, getNodesForLevel(level)));
      updateBreadcrumb();
      updateActivity();
      updateMobileView();
    }

    function updateBreadcrumb() {
      breadcrumb.innerHTML = "";
      levels.forEach((level) => {
        const node = selected[level];
        if (!node) return;

        const li = document.createElement("li");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = textForNode(node);
        btn.addEventListener("click", () => {
          clearChildren(levels.indexOf(level) + 1);
          currentMobileLevel = level;
          updatePanels();
        });
        li.appendChild(btn);
        breadcrumb.appendChild(li);
      });

      if (!breadcrumb.children.length) {
        const li = document.createElement("li");
        li.textContent = "Sélectionnez une section";
        breadcrumb.appendChild(li);
      }
    }

    function updateActivity() {
      const deepest = [...levels].reverse().find((level) => selected[level]);
      const node = deepest ? selected[deepest] : null;
      const version = document.querySelector('input[name="naf-version"]:checked')?.value || "2025";

      activityMeta.textContent = `Version: NAF ${version}`;

      if (!node) {
        activityCode.textContent = "Aucune activité sélectionnée";
        activityLabel.textContent = "Sélectionnez un niveau pour afficher sa fiche structurée.";
        activityPath.textContent = "—";
        return;
      }

      activityCode.textContent = node.code;
      activityLabel.textContent = node.label;
      activityPath.textContent = levels
        .map((level) => selected[level])
        .filter(Boolean)
        .map((n) => textForNode(n))
        .join(" › ");
    }

    function updateMobileView() {
      const isMobile = window.matchMedia("(max-width: 768px)").matches;
      document.querySelectorAll(".naf-panel").forEach((panel) => panel.classList.remove("mobile-visible"));

      if (!isMobile) return;

      const panel = document.querySelector(`.naf-panel[data-level="${currentMobileLevel}"]`);
      if (panel) panel.classList.add("mobile-visible");
      mobileLevelLabel.textContent = labelsByLevel[currentMobileLevel] || "Section";
      mobileBack.disabled = levels.indexOf(currentMobileLevel) === 0;
    }

    function onSelect(level, node) {
      selected[level] = node;
      clearChildren(levels.indexOf(level) + 1);

      const nextLevel = levels[levels.indexOf(level) + 1];
      if (nextLevel) {
        currentMobileLevel = nextLevel;
      }

      updatePanels();
    }

    function applySearch() {
      const term = searchInput.value.trim().toLowerCase();
      if (!term) {
        setStatus(tree.length ? `${searchableNodes.length} entrée(s) indexée(s).` : "Données à intégrer.");
        updatePanels();
        return;
      }

      const matches = searchableNodes.filter((entry) => entry.searchText.includes(term));
      if (!matches.length) {
        setStatus("Aucun résultat.");
        return;
      }

      const match = matches[0];
      selected = {};
      match.path.forEach((node) => {
        selected[node.level] = node;
      });
      currentMobileLevel = levels[Math.min(match.path.length - 1, levels.length - 1)];
      setStatus(
        `${matches.length} résultat(s). Affichage du premier: ${textForNode(match.node)} (${labelsByLevel[match.node.level]}).`
      );
      updatePanels();
    }

    function indexNodes(nodes, path = [], out = []) {
      nodes.forEach((node) => {
        const currentPath = [...path, node];
        out.push({
          node,
          path: currentPath,
          searchText: `${node.code} ${node.label}`.toLowerCase()
        });
        if (node.children.length) indexNodes(node.children, currentPath, out);
      });
      return out;
    }

    async function loadVersion(version) {
      selected = {};
      currentMobileLevel = "section";
      setStatus("Chargement des données…");

      try {
        const dataUrl = new URL(`../data/naf${version}.csv`, window.location.href);
        const response = await fetch(dataUrl);
        if (!response.ok) {
          tree = [];
          setStatus("Données à intégrer.");
          updatePanels();
          return;
        }

        const rows = parseCsv(await response.text());
        tree = buildTree(rows);

        searchableNodes = indexNodes(tree);

        if (!rows.length) {
          setStatus("Données à intégrer.");
        } else {
          setStatus(`${searchableNodes.length} entrée(s) indexée(s).`);
        }

        updatePanels();
      } catch (_e) {
        tree = [];
        setStatus("Chargement impossible pour le moment.");
        updatePanels();
      }
    }

    document.querySelectorAll('input[name="naf-version"]').forEach((radio) => {
      radio.addEventListener("change", (e) => loadVersion(e.target.value));
    });

    defenseModeBtn.addEventListener("click", () => {
      const current = defenseModeBtn.getAttribute("aria-pressed") === "true";
      defenseModeBtn.setAttribute("aria-pressed", (!current).toString());
    });

    mobileBack.addEventListener("click", () => {
      const index = levels.indexOf(currentMobileLevel);
      if (index > 0) {
        currentMobileLevel = levels[index - 1];
      }
      updateMobileView();
    });

    searchInput.addEventListener("input", applySearch);
    window.addEventListener("resize", debounce(updateMobileView, 150));

    loadVersion("2025");
  }

  document.addEventListener("DOMContentLoaded", initExplorer);
})();
