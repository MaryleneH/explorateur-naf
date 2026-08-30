/**
 * naf-sources.js
 * État des sources (rubrique Boîte à outils) : l'observatoire pédagogique des sources.
 *
 * Deux fichiers, deux rôles, assemblés ici :
 *   data/etudes/sources.csv         identité, grain, fréquence, accès,
 *                                   limites (source de vérité méthodologique)
 *   data/quality/source_status.json dernier état technique enregistré par
 *                                   le contrôle automatisé (un nouvel état
 *                                   n'est archivé que si un statut change)
 *
 * Le statut technique n'écrase jamais la méthodologie : chaque fiche
 * montre d'abord ce que la source observe, à quel rythme, avec quelles
 * limites — la disponibilité de l'URL n'est qu'une petite partie de la
 * qualité d'une source.
 */
(function () {
  "use strict";

  var NAF = window.NAF;
  var root = document.getElementById("naf-src");
  if (!root || !NAF) return;

  var dom = {
    summary: document.getElementById("naf-src-summary"),
    filters: document.getElementById("naf-src-filters"),
    list: document.getElementById("naf-src-list"),
    rythme: document.getElementById("naf-src-rythme"),
  };

  /* ── Référentiels d'affichage ────────────────────────────────────── */

  var STATUS = {
    AVAILABLE: { symbol: "✓", label: "Disponible", cls: "ok",
      help: "Le point d'entrée officiel a répondu normalement lors du " +
            "dernier contrôle automatisé." },
    WARNING: { symbol: "⚠", label: "À surveiller", cls: "warn",
      help: "Le site officiel n'a pas répondu normalement lors du dernier " +
            "contrôle automatisé. Cela peut être temporaire et ne signifie " +
            "pas que la source est supprimée." },
    ACCESS_SPECIFIC: { symbol: "↗", label: "Accès spécifique", cls: "auth",
      help: "L'accès demande un compte, une clé ou des droits " +
            "statistiques. Ce n'est pas une erreur : c'est une " +
            "caractéristique de la source." },
    UNAVAILABLE: { symbol: "✕", label: "Lien à corriger", cls: "fail",
      help: "Le dernier contrôle automatique n'a pas réussi à joindre " +
            "cette source (lien cassé ou déplacé)." },
    MANUAL: { symbol: "?", label: "Contrôle manuel", cls: "manual",
      help: "Cette source ne peut pas être contrôlée automatiquement." },
    UNCHECKED: { symbol: "?", label: "Non contrôlé", cls: "manual",
      help: "Aucune information de contrôle n'est encore disponible pour " +
            "cette source." },
  };

  var FAMILLES = [
    ["identifier", "Identifier · localiser · population statistique"],
    ["commande_publique", "Commande publique"],
    ["vie_entreprise", "Vie de l'entreprise"],
    ["commerce_exterieur", "Commerce extérieur"],
    ["innovation", "Innovation"],
    ["defense", "Défense"],
    ["nomenclature", "Nomenclature"],
  ];

  var TOOLBOX = {
    sirene_stock: "stock-sirene", sirene_api: "trouver-entreprise",
    sirene_geo: "stock-sirene",
    boamp: "boamp", decp: "decp", bodacc: "bodacc",
    douanes: "douanes", inpi_brevets: "inpi",
  };

  var ISSUE_URL = "https://github.com/MaryleneH/explorateur-naf/issues/new" +
    "?template=site-feedback.yml";

  var MOIS = ["janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

  var el = NAF.el;

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.getDate() + " " + MOIS[d.getMonth()] + " " + d.getFullYear();
  }

  function daysAgo(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  }

  /** Classe une fréquence du manifeste dans une bande de rythme. */
  function rythmeBand(frequence) {
    var f = (frequence || "").toLowerCase();
    if (/quotid|temps réel|continue|parutions par semaine|hebdomadaire/.test(f)) {
      return 0;
    }
    if (/mensuel/.test(f)) return 1;
    return 2; // annuelle, millésimes, à la révision…
  }

  /* ── Rendu ───────────────────────────────────────────────────────── */

  var state = { filter: "toutes", sources: [], status: null };

  function statusOf(source) {
    if (!state.status) return "UNCHECKED";
    var entry = state.status.bySource[source.source_id];
    return entry ? entry.status : "UNCHECKED";
  }

  function matchesFilter(source) {
    var status = statusOf(source);
    switch (state.filter) {
      case "toutes": return true;
      case "disponibles": return status === "AVAILABLE";
      case "surveiller": return status === "WARNING" ||
        status === "UNAVAILABLE";
      case "acces": return status === "ACCESS_SPECIFIC";
      case "opendata": return /open data/i.test(source.acces || "");
      case "defense": return source.categorie === "defense";
      default: return true;
    }
  }

  function renderSummary() {
    clear(dom.summary);
    var counts = { AVAILABLE: 0, WARNING: 0, ACCESS_SPECIFIC: 0,
      UNAVAILABLE: 0, MANUAL: 0, UNCHECKED: 0 };
    state.sources.forEach(function (source) {
      counts[statusOf(source)]++;
    });

    function tile(value, label, cls) {
      var box = el("div", "naf-src-tile" + (cls ? " naf-src-tile-" + cls : ""));
      box.appendChild(el("span", "naf-src-tile-num", String(value)));
      box.appendChild(el("span", "naf-src-tile-label", label));
      return box;
    }

    dom.summary.appendChild(tile(state.sources.length, "sources suivies"));
    dom.summary.appendChild(tile(counts.AVAILABLE, "disponibles", "ok"));
    if (counts.WARNING) {
      dom.summary.appendChild(tile(counts.WARNING, "à surveiller", "warn"));
    }
    dom.summary.appendChild(
      tile(counts.ACCESS_SPECIFIC, "accès spécifique", "auth"));
    if (counts.UNAVAILABLE) {
      dom.summary.appendChild(
        tile(counts.UNAVAILABLE, "liens à corriger", "fail"));
    }
    if (counts.MANUAL + counts.UNCHECKED) {
      dom.summary.appendChild(
        tile(counts.MANUAL + counts.UNCHECKED, "contrôle manuel", "manual"));
    }

    var meta = el("div", "naf-src-lastcheck");
    if (state.status) {
      var since = daysAgo(state.status.generated_at);
      var line = el("p", null);
      line.appendChild(el("strong", null, "État stable depuis le " +
        formatDate(state.status.generated_at)));
      if (since !== null && since > 21) {
        line.appendChild(el("span", "naf-src-old",
          " · état enregistré il y a plus de trois semaines"));
      }
      meta.appendChild(line);
      var note = el("p", "naf-src-lastcheck-note");
      note.appendChild(document.createTextNode(
        "Dernier contrôle automatisé hebdomadaire ; un nouvel état n'est " +
        "archivé que lorsqu'un statut change. "));
      var link = el("a", "naf-link", "Voir le dernier contrôle GitHub ↗");
      link.href = "https://github.com/MaryleneH/explorateur-naf/actions/" +
        "workflows/check-sources.yml";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      note.appendChild(link);
      meta.appendChild(note);
    } else {
      meta.appendChild(el("p", "naf-src-lastcheck-note",
        "Aucun état de contrôle n'a pu être chargé : les statuts sont " +
        "affichés comme non contrôlés."));
    }
    dom.summary.appendChild(meta);
  }

  function buildFiche(source) {
    var status = statusOf(source);
    var meta = STATUS[status];
    var techEntry = state.status &&
      state.status.bySource[source.source_id];

    var fiche = el("details", "naf-src-fiche");
    fiche.id = "source-" + source.source_id;
    fiche.dataset.status = status;

    var summary = el("summary");
    summary.appendChild(el("span", "naf-src-name", source.nom.split("—")[0]
      .split("(")[0].trim()));
    summary.appendChild(el("span", "naf-src-tag", source.unite));
    var chip = el("span", "naf-src-chip naf-src-chip-" + meta.cls);
    chip.appendChild(el("span", "naf-src-chip-symbol", meta.symbol));
    chip.appendChild(el("span", null, meta.label));
    chip.title = meta.help;
    summary.appendChild(chip);
    fiche.appendChild(summary);

    var body = el("div", "naf-src-body");

    var list = el("dl", "naf-deflist");
    function add(term, value) {
      if (!value) return;
      list.appendChild(el("dt", null, term));
      var dd = el("dd");
      if (typeof value === "string") dd.textContent = value;
      else dd.appendChild(value);
      list.appendChild(dd);
    }
    add("Producteur", source.producteur);
    add("Ce que j'observe", source.unite);
    add("Rythme", source.frequence);
    add("Accès", source.acces);
    add("Dernière période connue", (source.date_reference_max || "").trim()
      || "À vérifier dans la source");
    var statusValue = el("span");
    statusValue.appendChild(el("strong", null,
      meta.symbol + " " + meta.label));
    if (techEntry && techEntry.message) {
      statusValue.appendChild(document.createTextNode(
        " — " + techEntry.message));
    }
    add("Dernier état technique", statusValue);
    if (state.status) {
      add("État enregistré le", formatDate(state.status.generated_at));
    }
    body.appendChild(list);

    var warn = el("p", "naf-callout");
    warn.appendChild(el("strong", null, "Attention. "));
    warn.appendChild(document.createTextNode(source.limitations));
    body.appendChild(warn);

    body.appendChild(el("p", "naf-src-help", meta.help +
      " Un point d'entrée qui répond ne prouve ni que les données sont " +
      "récentes, ni que le schéma n'a pas changé, ni que la source " +
      "convient à votre question."));

    var actions = el("p", "naf-comp-ctas");
    var official = el("a", "naf-chg-cta", "Source officielle ↗");
    official.href = source.url;
    official.target = "_blank";
    official.rel = "noopener noreferrer";
    actions.appendChild(official);
    if (TOOLBOX[source.source_id]) {
      var toolbox = el("a", "naf-chg-cta", "Récupérer cette source →");
      toolbox.href = "../comprendre/boite-outils.html#" +
        TOOLBOX[source.source_id];
      actions.appendChild(toolbox);
    }
    if (status === "UNAVAILABLE") {
      var report = el("a", "naf-chg-cta", "Un problème ? Signaler →");
      report.href = ISSUE_URL;
      report.target = "_blank";
      report.rel = "noopener noreferrer";
      actions.appendChild(report);
    }
    body.appendChild(actions);

    fiche.appendChild(body);
    return fiche;
  }

  function renderList() {
    clear(dom.list);
    var shown = 0;
    FAMILLES.forEach(function (famille) {
      var sources = state.sources.filter(function (source) {
        return source.categorie === famille[0] && matchesFilter(source);
      });
      if (!sources.length) return;
      var section = el("section", "naf-src-famille");
      var heading = el("h3", "naf-src-famille-title", famille[1]);
      section.appendChild(heading);
      sources.forEach(function (source) {
        section.appendChild(buildFiche(source));
        shown++;
      });
      dom.list.appendChild(section);
    });
    if (!shown) {
      dom.list.appendChild(el("p", "naf-results-empty",
        "Aucune source ne correspond à ce filtre."));
    }
    var note = el("p", "naf-src-famillenote",
      "Les familles sont des repères de lecture, pas un ordre d'analyse : " +
      "aucune source n'est « meilleure » qu'une autre, elles répondent à " +
      "des questions différentes.");
    dom.list.appendChild(note);
  }

  function renderRythme() {
    clear(dom.rythme);
    var bands = [
      el("div", "naf-src-band"),
      el("div", "naf-src-band"),
      el("div", "naf-src-band"),
    ];
    var labels = ["très fréquent", "mensuel",
      "annuel · millésimé · à la révision"];
    state.sources.forEach(function (source) {
      var chipEl = el("a", "naf-src-rchip", source.nom.split("—")[0]
        .split("(")[0].trim());
      chipEl.href = "#source-" + source.source_id;
      chipEl.title = source.frequence;
      bands[rythmeBand(source.frequence)].appendChild(chipEl);
    });
    bands.forEach(function (band, i) {
      var block = el("div", "naf-src-rband");
      block.appendChild(el("p", "naf-src-rband-label", labels[i]));
      block.appendChild(band);
      dom.rythme.appendChild(block);
    });
  }

  /* ── Filtres ─────────────────────────────────────────────────────── */

  dom.filters.addEventListener("click", function (event) {
    var button = event.target.closest(".naf-version");
    if (!button) return;
    state.filter = button.dataset.filter;
    Array.prototype.forEach.call(
      dom.filters.querySelectorAll(".naf-version"), function (b) {
        var current = b === button;
        b.classList.toggle("is-current", current);
        b.setAttribute("aria-checked", current ? "true" : "false");
      });
    renderList();
  });

  // Une ancre #source-<id> ouvre la fiche correspondante.
  function applyHash() {
    var id = window.location.hash.replace("#", "");
    var target = document.getElementById(id);
    if (target && target.classList.contains("naf-src-fiche")) {
      target.open = true;
      target.scrollIntoView({ block: "start" });
    }
  }
  window.addEventListener("hashchange", applyHash);

  /* ── Chargement ──────────────────────────────────────────────────── */

  Promise.all([
    NAF.loadCsv("etudes/sources.csv"),
    fetch(NAF.dataUrl("quality/source_status.json")).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).catch(function () { return null; }),
  ]).then(function (loaded) {
    state.sources = loaded[0];
    if (loaded[1]) {
      var bySource = {};
      (loaded[1].sources || []).forEach(function (s) {
        bySource[s.source_id] = s;
      });
      state.status = { generated_at: loaded[1].generated_at,
        bySource: bySource };
    }
    renderSummary();
    renderList();
    renderRythme();
    applyHash();
  }).catch(function (error) {
    clear(dom.list);
    dom.list.appendChild(el("p", "naf-error",
      "Impossible de charger le manifeste des sources (" + error.message +
      ")."));
  });
})();
