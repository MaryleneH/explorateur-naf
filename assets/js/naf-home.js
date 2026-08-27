/**
 * naf-home.js
 * Recherche de l'accueil.
 *
 * L'accueil doit être utile avant même que les données arrivent : le champ
 * est actif immédiatement, la nomenclature se charge en arrière-plan, et
 * tant qu'elle n'est pas là un envoi du formulaire délègue la recherche à
 * l'Explorer via ?q=. Aucun écran d'attente.
 */
(function () {
  "use strict";

  var NAF = window.NAF;
  var root = document.getElementById("naf-home");
  if (!root) return;

  var dom = {
    form: document.getElementById("naf-home-form"),
    input: document.getElementById("naf-home-q"),
    clear: document.getElementById("naf-home-clear"),
    results: document.getElementById("naf-home-results"),
    browse: document.getElementById("naf-home-browse"),
    cta: document.getElementById("naf-home-cta"),
    counts: document.getElementById("naf-home-counts"),
    versions: root.querySelectorAll(".naf-version"),
  };

  var state = {
    versionId: "2025",
    nomenclature: null,
    query: "",
  };

  function explorerUrl(params) {
    var search = new URLSearchParams(params);
    return "explorer/?" + search.toString();
  }

  function renderVersion() {
    Array.prototype.forEach.call(dom.versions, function (button) {
      var isCurrent = button.dataset.version === state.versionId;
      button.setAttribute("aria-checked", isCurrent ? "true" : "false");
      button.classList.toggle("is-current", isCurrent);
    });

    var version = NAF.VERSIONS[state.versionId];
    dom.cta.href = explorerUrl({ v: state.versionId });
    dom.cta.textContent = "Explorer la " + version.shortLabel + " ";
    var arrow = NAF.el("span", null, "→");
    arrow.setAttribute("aria-hidden", "true");
    dom.cta.appendChild(arrow);
  }

  function renderCounts() {
    if (!state.nomenclature) {
      dom.counts.textContent = "";
      return;
    }
    dom.counts.textContent = NAF.formatCounts(state.nomenclature.counts, true);
  }

  function renderResults() {
    while (dom.results.firstChild) dom.results.removeChild(dom.results.firstChild);

    var hasQuery = state.query.length > 0;
    dom.results.hidden = !hasQuery;
    dom.browse.hidden = hasQuery;
    dom.clear.hidden = !hasQuery;

    if (!hasQuery) return;

    if (!state.nomenclature) {
      dom.results.appendChild(
        NAF.el("p", "naf-results-empty", "Chargement de la nomenclature…"));
      return;
    }

    var matches = NAF.search(state.nomenclature.entries, state.query, 8);

    if (!matches.length) {
      dom.results.appendChild(
        NAF.el("p", "naf-results-empty", "Aucun résultat pour « " + state.query + " »."));
      return;
    }

    var list = NAF.el("div", "naf-results-list");
    matches.forEach(function (entry) {
      var link = NAF.el("a", "naf-result");
      link.href = explorerUrl({ v: state.versionId, code: entry.node.code });

      var top = NAF.el("span", "naf-result-top");
      top.appendChild(NAF.el("span", "naf-result-code", entry.node.code));
      top.appendChild(NAF.el("span", "naf-result-label", entry.node.label));
      link.appendChild(top);

      var meta = NAF.el("span", "naf-result-meta");
      meta.appendChild(NAF.el("span", "naf-result-level",
        NAF.LEVEL_LABELS[entry.node.level] + " · " + NAF.VERSIONS[state.versionId].shortLabel));
      meta.appendChild(NAF.el("span", "naf-result-path",
        entry.path.map(function (node) { return node.code; }).join(" › ")));
      link.appendChild(meta);
      link.setAttribute("aria-label",
        entry.node.code + ", " + entry.node.label + ", " +
        NAF.LEVEL_LABELS[entry.node.level] + ", " +
        NAF.VERSIONS[state.versionId].shortLabel);

      list.appendChild(link);
    });
    dom.results.appendChild(list);
  }

  function setQuery(value) {
    state.query = value.trim();
    renderResults();
  }

  function load() {
    NAF.loadNomenclature(state.versionId).then(function (nomenclature) {
      if (nomenclature.id !== state.versionId) return;
      state.nomenclature = nomenclature;
      renderCounts();
      renderResults();
    }).catch(function () {
      state.nomenclature = null;
      // L'accueil reste utilisable : l'Explorer refera la tentative.
      dom.counts.textContent = "";
    });
  }

  dom.form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!state.query) {
      window.location.href = explorerUrl({ v: state.versionId });
      return;
    }
    var matches = state.nomenclature
      ? NAF.search(state.nomenclature.entries, state.query, 1)
      : [];
    window.location.href = matches.length
      ? explorerUrl({ v: state.versionId, code: matches[0].node.code })
      : explorerUrl({ v: state.versionId, q: state.query });
  });

  dom.input.addEventListener("input", NAF.debounce(function () {
    setQuery(dom.input.value);
  }, 120));

  dom.input.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      dom.input.value = "";
      setQuery("");
    }
  });

  dom.clear.addEventListener("click", function () {
    dom.input.value = "";
    setQuery("");
    dom.input.focus();
  });

  Array.prototype.forEach.call(dom.versions, function (button) {
    button.addEventListener("click", function () {
      if (button.dataset.version === state.versionId) return;
      state.versionId = button.dataset.version;
      state.nomenclature = null;
      renderVersion();
      renderCounts();
      renderResults();
      load();
    });
  });

  renderVersion();
  load();
})();
