/**
 * naf-comparer.js
 * Consultation de la table de correspondance NAF rév.2 / NAF 2025.
 *
 * La table dont nous disposons ne couvre pas la totalité des sous-classes.
 * La couverture réelle est calculée à partir des données et affichée : il ne
 * faut pas laisser croire qu'une absence de ligne signifie une absence de
 * correspondance.
 */
(function () {
  "use strict";

  var NAF = window.NAF;
  var root = document.getElementById("naf-compare");
  if (!root) return;

  var dom = {
    form: document.getElementById("naf-compare-form"),
    input: document.getElementById("naf-compare-q"),
    clear: document.getElementById("naf-compare-clear"),
    counts: document.getElementById("naf-compare-counts"),
    result: document.getElementById("naf-compare-result"),
  };

  var data = {
    pairs: null,
    index: null,
  };

  function buildIndex(pairs) {
    return pairs.map(function (pair) {
      return {
        pair: pair,
        codes: NAF.normalizeCode(pair.code_2008) + " " + NAF.normalizeCode(pair.code_2025),
        text: NAF.normalize(pair.libelle_2008 + " " + pair.libelle_2025),
      };
    });
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function explorerUrl(versionId, code) {
    return "../explorer/?v=" + versionId + "&code=" + encodeURIComponent(code);
  }

  function buildSide(versionId, code, label) {
    var side = NAF.el("div", "naf-compare-side");
    side.appendChild(NAF.el("span", "naf-compare-version", NAF.VERSIONS[versionId].shortLabel));
    var link = NAF.el("a", "naf-compare-code", code);
    link.href = explorerUrl(versionId, code);
    side.appendChild(link);
    side.appendChild(NAF.el("span", "naf-compare-label", label));
    return side;
  }

  function renderPairs(matches, query) {
    clear(dom.result);

    if (!query) {
      dom.result.appendChild(NAF.el("p", "naf-results-empty",
        "Saisissez un code ou un libellé pour afficher les correspondances."));
      return;
    }

    if (!matches.length) {
      var empty = NAF.el("p", "naf-results-empty");
      empty.appendChild(document.createTextNode(
        "Aucune ligne de correspondance pour « " + query + " ». " +
        "La table disponible ne couvre pas toutes les sous-classes : " +
        "une absence ici ne signifie pas qu'aucune correspondance n'existe."));
      dom.result.appendChild(empty);
      return;
    }

    dom.result.appendChild(NAF.el("p", "naf-results-count",
      matches.length === 1 ? "1 correspondance" : matches.length + " correspondances"));

    matches.forEach(function (entry) {
      var pair = entry.pair;
      var row = NAF.el("div", "naf-compare-pair");
      row.appendChild(buildSide("2008", pair.code_2008, pair.libelle_2008));
      var arrow = NAF.el("span", "naf-compare-arrow", "→");
      arrow.setAttribute("aria-hidden", "true");
      row.appendChild(arrow);
      row.appendChild(buildSide("2025", pair.code_2025, pair.libelle_2025));
      if (pair.type_correspondance) {
        row.appendChild(NAF.el("span", "naf-compare-type", pair.type_correspondance));
      }
      dom.result.appendChild(row);
    });
  }

  function runSearch() {
    var query = dom.input.value.trim();
    dom.clear.hidden = !query;

    if (!data.index) {
      renderPairs([], query);
      return;
    }

    var asCode = NAF.normalizeCode(query);
    var asText = NAF.normalize(query);
    var matches = data.index.filter(function (entry) {
      if (asCode && entry.codes.indexOf(asCode) !== -1) return true;
      return asText.length >= 3 && entry.text.indexOf(asText) !== -1;
    }).slice(0, 40);

    renderPairs(matches, query);
  }

  function renderCoverage(pairs, subclasses2008, subclasses2025) {
    var covered2008 = new Set();
    var covered2025 = new Set();
    pairs.forEach(function (pair) {
      covered2008.add(pair.code_2008);
      covered2025.add(pair.code_2025);
    });

    var missing2008 = subclasses2008.filter(function (code) { return !covered2008.has(code); }).length;
    var missing2025 = subclasses2025.filter(function (code) { return !covered2025.has(code); }).length;

    clear(dom.counts);
    dom.counts.appendChild(document.createTextNode(
      pairs.length + " relations · couverture partielle : " +
      missing2008 + " sous-classes 2008 et " + missing2025 +
      " sous-classes 2025 ne figurent pas encore dans la table."));
  }

  Promise.all([
    NAF.loadCorrespondances(),
    NAF.loadNomenclature("2008"),
    NAF.loadNomenclature("2025"),
  ]).then(function (results) {
    data.pairs = results[0];
    data.index = buildIndex(data.pairs);

    renderCoverage(
      data.pairs,
      results[1].rows.map(function (row) { return row.subclass_code; }),
      results[2].rows.map(function (row) { return row.subclass_code; })
    );
    runSearch();
  }).catch(function (error) {
    dom.counts.textContent = "Impossible de charger la table de correspondance (" + error.message + ").";
  });

  dom.form.addEventListener("submit", function (event) {
    event.preventDefault();
    runSearch();
  });

  dom.input.addEventListener("input", NAF.debounce(runSearch, 150));

  dom.clear.addEventListener("click", function () {
    dom.input.value = "";
    runSearch();
    dom.input.focus();
  });

  renderPairs([], "");
})();
