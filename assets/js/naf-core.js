/**
 * naf-core.js
 * Couche de données partagée par toutes les pages de l'Explorateur NAF.
 *
 * Responsabilités :
 *   - localiser les CSV quelle que soit la profondeur de la page (GitHub Pages
 *     sert le site depuis /explorateur-naf/, pas depuis la racine du domaine) ;
 *   - parser le CSV de façon conforme (guillemets, virgules et retours à la
 *     ligne dans les champs) ;
 *   - construire l'arbre hiérarchique et l'index de recherche ;
 *   - exposer le tout via window.NAF.
 *
 * Aucune manipulation d'interface ici.
 */
(function (global) {
  "use strict";

  /* ─────────────────────────────────────────────────────────────────────
     Localisation des données

     Le chemin est déduit de l'URL de ce script, pas de celle de la page.
     assets/js/naf-core.js → ../../data/ → <racine du site>/data/
     C'est le seul calcul qui fonctionne aussi bien depuis /, /explorer/
     que depuis un sous-répertoire de déploiement.
  ───────────────────────────────────────────────────────────────────── */

  var scriptEl = document.currentScript;
  var DATA_ROOT = new URL("../../data/", scriptEl.src).href;

  function dataUrl(file) {
    return DATA_ROOT + file;
  }

  /* ─────────────────────────────────────────────────────────────────────
     Parseur CSV

     Automate à deux états. Gère les guillemets doublés ("" à l'intérieur
     d'un champ cité), les virgules et les retours à la ligne encadrés par
     des guillemets, et les fins de ligne CRLF comme LF.
  ───────────────────────────────────────────────────────────────────── */

  function parseCsv(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

    var rows = [];
    var row = [];
    var field = "";
    var inQuotes = false;
    var i = 0;
    var len = text.length;

    function endField() {
      row.push(field);
      field = "";
    }

    function endRow() {
      endField();
      // Ignorer les lignes vides produites par une fin de fichier.
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    }

    while (i < len) {
      var c = text[i];

      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        field += c;
        i++;
        continue;
      }

      if (c === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (c === ",") {
        endField();
        i++;
        continue;
      }
      if (c === "\r") {
        i++;
        continue;
      }
      if (c === "\n") {
        endRow();
        i++;
        continue;
      }
      field += c;
      i++;
    }

    if (field !== "" || row.length > 0) endRow();

    if (!rows.length) return [];

    var headers = rows[0].map(function (h) {
      return h.trim();
    });

    return rows.slice(1).map(function (cols) {
      var obj = {};
      for (var k = 0; k < headers.length; k++) {
        obj[headers[k]] = (cols[k] || "").trim();
      }
      return obj;
    });
  }

  /* ─────────────────────────────────────────────────────────────────────
     Normalisation pour la recherche

     Insensible à la casse, aux accents, aux apostrophes typographiques,
     aux espaces superflus. "aeronautique" doit trouver "aéronautique",
     "3032y" doit trouver "30.32Y".
  ───────────────────────────────────────────────────────────────────── */

  function normalize(str) {
    return String(str)
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")            // supprime les diacritiques
      .replace(/[’'`]/gu, " ") // apostrophes typographiques
      .replace(/\s+/g, " ")
      .trim();
  }

  // Variante utilisée pour comparer des codes : on retire aussi les points
  // et les espaces, pour que « 30 32 Y » et « 3032y » trouvent « 30.32Y ».
  function normalizeCode(str) {
    return normalize(str).replace(/[.\s]/g, "");
  }

  /* ─────────────────────────────────────────────────────────────────────
     Niveaux
  ───────────────────────────────────────────────────────────────────── */

  var LEVELS = ["section", "division", "group", "class", "subclass"];

  var LEVEL_LABELS = {
    section: "Section",
    division: "Division",
    group: "Groupe",
    class: "Classe",
    subclass: "Sous-classe",
  };

  var LEVEL_PLURALS = {
    section: "sections",
    division: "divisions",
    group: "groupes",
    class: "classes",
    subclass: "sous-classes",
  };

  var VERSIONS = {
    "2025": {
      id: "2025",
      file: "naf2025.csv",
      shortLabel: "NAF 2025",
      longLabel: "NAF 2025",
      csvVersion: "NAF 2025",
      inseeSegment: "naf2025",
    },
    "2008": {
      id: "2008",
      file: "naf2008.csv",
      shortLabel: "NAF 2008",
      longLabel: "NAF rév.2 (2008)",
      csvVersion: "NAF rév.2",
      inseeSegment: "nafr2",
    },
  };

  var INSEE_LEVEL_SEGMENT = {
    section: "section",
    division: "division",
    group: "groupe",
    class: "classe",
    subclass: "sousClasse",
  };

  /**
   * URL de la fiche officielle Insee.
   * Le segment de nomenclature dépend de la version : une fiche NAF 2025
   * servie depuis /nafr2/ décrit une autre activité. Ne jamais mélanger.
   */
  function inseeUrl(versionId, level, code) {
    var version = VERSIONS[versionId];
    var segment = INSEE_LEVEL_SEGMENT[level];
    if (!version || !segment || !code) return null;
    return (
      "https://www.insee.fr/fr/metadonnees/" +
      version.inseeSegment +
      "/" +
      segment +
      "/" +
      code
    );
  }

  /* ─────────────────────────────────────────────────────────────────────
     Construction de l'arbre
  ───────────────────────────────────────────────────────────────────── */

  function buildTree(rows) {
    var roots = [];
    var byCode = new Map();

    function ensure(code, label, level, parent, row) {
      var existing = byCode.get(level + ":" + code);
      if (existing) return existing;
      var node = {
        code: code,
        label: label,
        level: level,
        parent: parent,
        children: [],
        row: row || null,
      };
      byCode.set(level + ":" + code, node);
      if (parent) parent.children.push(node);
      else roots.push(node);
      return node;
    }

    rows.forEach(function (row) {
      if (!row.section_code || !row.subclass_code) return;
      var section = ensure(row.section_code, row.section_label, "section", null);
      var division = ensure(row.division_code, row.division_label, "division", section);
      var group = ensure(row.group_code, row.group_label, "group", division);
      var klass = ensure(row.class_code, row.class_label, "class", group);
      ensure(row.subclass_code, row.subclass_label, "subclass", klass, row);
    });

    return { roots: roots, byCode: byCode };
  }

  /* ─────────────────────────────────────────────────────────────────────
     Index de recherche
  ───────────────────────────────────────────────────────────────────── */

  function buildIndex(roots) {
    var entries = [];

    function walk(node, ancestors) {
      var path = ancestors.concat([node]);
      entries.push({
        node: node,
        path: path,
        code: node.code,
        normCode: normalizeCode(node.code),
        normLabel: normalize(node.label),
      });
      node.children.forEach(function (child) {
        walk(child, path);
      });
    }

    roots.forEach(function (root) {
      walk(root, []);
    });

    return entries;
  }

  function countByLevel(entries) {
    var counts = { section: 0, division: 0, group: 0, class: 0, subclass: 0 };
    entries.forEach(function (entry) {
      counts[entry.node.level]++;
    });
    return counts;
  }

  /* ─────────────────────────────────────────────────────────────────────
     Recherche

     Ordre de pertinence :
       1. code exact
       2. code commençant par la requête
       3. libellé commençant par la requête
       4. libellé contenant la requête
     Les sous-classes remontent avant leurs parents à pertinence égale :
     c'est le niveau que l'on cherche le plus souvent.
  ───────────────────────────────────────────────────────────────────── */

  var LEVEL_RANK = { subclass: 0, class: 1, group: 2, division: 3, section: 4 };

  function search(entries, query, limit) {
    var raw = normalize(query);
    if (!raw) return [];
    var asCode = normalizeCode(query);
    var results = [];

    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var score = -1;

      if (asCode && entry.normCode === asCode) score = 0;
      else if (asCode && entry.normCode.indexOf(asCode) === 0) score = 1;
      else if (entry.normLabel.indexOf(raw) === 0) score = 2;
      else if (entry.normLabel.indexOf(raw) !== -1) score = 3;
      else if (asCode.length >= 2 && entry.normCode.indexOf(asCode) !== -1) score = 4;

      if (score >= 0) results.push({ entry: entry, score: score });
    }

    results.sort(function (a, b) {
      if (a.score !== b.score) return a.score - b.score;
      var ra = LEVEL_RANK[a.entry.node.level];
      var rb = LEVEL_RANK[b.entry.node.level];
      if (ra !== rb) return ra - rb;
      return a.entry.code.localeCompare(b.entry.code);
    });

    return results.slice(0, limit || 25).map(function (r) {
      return r.entry;
    });
  }

  /* ─────────────────────────────────────────────────────────────────────
     Chargement

     Chaque fichier n'est téléchargé qu'une fois par session : les promesses
     sont mises en cache, pas seulement les résultats.
  ───────────────────────────────────────────────────────────────────── */

  var csvCache = {};

  function loadCsv(file) {
    if (!csvCache[file]) {
      csvCache[file] = fetch(dataUrl(file)).then(function (response) {
        if (!response.ok) {
          throw new Error("HTTP " + response.status + " sur " + dataUrl(file));
        }
        return response.text();
      }).then(parseCsv).catch(function (error) {
        // Ne pas mettre en cache un échec : un rechargement doit pouvoir réessayer.
        delete csvCache[file];
        throw error;
      });
    }
    return csvCache[file];
  }

  var nomenclatureCache = {};

  /**
   * Charge une nomenclature complète et retourne un objet prêt à l'emploi :
   * { id, version, roots, byCode, entries, counts, rows }
   */
  function loadNomenclature(versionId) {
    var version = VERSIONS[versionId];
    if (!version) return Promise.reject(new Error("Version inconnue : " + versionId));

    if (!nomenclatureCache[versionId]) {
      nomenclatureCache[versionId] = loadCsv(version.file).then(function (rows) {
        var tree = buildTree(rows);
        var entries = buildIndex(tree.roots);
        return {
          id: versionId,
          version: version,
          rows: rows,
          roots: tree.roots,
          byCode: tree.byCode,
          entries: entries,
          counts: countByLevel(entries),
        };
      }).catch(function (error) {
        delete nomenclatureCache[versionId];
        throw error;
      });
    }
    return nomenclatureCache[versionId];
  }

  function loadCorrespondances() {
    return loadCsv("correspondances_2008_2025.csv");
  }

  function loadDefense() {
    return loadCsv("defense_qualification.csv");
  }

  /* ─────────────────────────────────────────────────────────────────────
     Recherche d'un nœud par code
  ───────────────────────────────────────────────────────────────────── */

  /** Retrouve un nœud à partir de son seul code, quel que soit son niveau. */
  function findByCode(nomenclature, code) {
    if (!code) return null;
    var wanted = normalizeCode(code);
    for (var i = 0; i < nomenclature.entries.length; i++) {
      if (nomenclature.entries[i].normCode === wanted) return nomenclature.entries[i].node;
    }
    return null;
  }

  /** Chemin racine → nœud, sous forme de tableau de nœuds. */
  function pathOf(node) {
    var path = [];
    var current = node;
    while (current) {
      path.unshift(current);
      current = current.parent;
    }
    return path;
  }

  /* ─────────────────────────────────────────────────────────────────────
     Formatage
  ───────────────────────────────────────────────────────────────────── */

  function formatCounts(counts, compact) {
    if (compact) {
      return counts.section + " sections · " + counts.subclass + " sous-classes";
    }
    return LEVELS.map(function (level) {
      return counts[level] + " " + LEVEL_PLURALS[level];
    }).join(" · ");
  }

  /* ─────────────────────────────────────────────────────────────────────
     Utilitaires DOM partagés
  ───────────────────────────────────────────────────────────────────── */

  function debounce(fn, ms) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(self, args);
      }, ms);
    };
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /* ─────────────────────────────────────────────────────────────────────
     Export
  ───────────────────────────────────────────────────────────────────── */

  global.NAF = {
    LEVELS: LEVELS,
    LEVEL_LABELS: LEVEL_LABELS,
    LEVEL_PLURALS: LEVEL_PLURALS,
    VERSIONS: VERSIONS,
    dataUrl: dataUrl,
    parseCsv: parseCsv,
    normalize: normalize,
    normalizeCode: normalizeCode,
    inseeUrl: inseeUrl,
    loadCsv: loadCsv,
    loadNomenclature: loadNomenclature,
    loadCorrespondances: loadCorrespondances,
    loadDefense: loadDefense,
    search: search,
    findByCode: findByCode,
    pathOf: pathOf,
    formatCounts: formatCounts,
    debounce: debounce,
    el: el,
  };
})(window);
