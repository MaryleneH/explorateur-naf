/**
 * naf-defense.js
 * Liste des codes ayant reçu une qualification Défense documentée.
 *
 * La liste est lue dans data/defense_qualification.csv plutôt qu'écrite en dur
 * dans la page : ajouter une qualification ne doit demander qu'une ligne de CSV,
 * et la page ne doit jamais affirmer autre chose que ce que les données disent.
 */
(function () {
  "use strict";

  var NAF = window.NAF;
  var root = document.getElementById("naf-defense-list");
  if (!root) return;

  var GROUPS = [
    {
      key: "explicite_industriel",
      title: "Défense explicite",
      note: "Le libellé officiel mentionne un usage militaire.",
    },
    {
      key: "dual_officiel",
      title: "Activité duale",
      note: "Le périmètre officiel couvre des usages civils et militaires.",
    },
    {
      key: "administration_defense",
      title: "Administration de la défense",
      note: "Sphère publique, pas industrie.",
    },
  ];

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function versionId(csvVersion) {
    return csvVersion === "NAF 2025" ? "2025" : "2008";
  }

  function buildEntry(row) {
    var item = NAF.el("div", "naf-compare-pair");

    var side = NAF.el("div", "naf-compare-side");
    side.appendChild(NAF.el("span", "naf-compare-version", row.naf_version));
    var link = NAF.el("a", "naf-compare-code", row.code);
    link.href = "../explorer/?v=" + versionId(row.naf_version) +
      "&code=" + encodeURIComponent(row.code);
    side.appendChild(link);
    item.appendChild(side);

    var body = NAF.el("div", "naf-compare-side");
    body.appendChild(NAF.el("span", "naf-compare-label", row.justification));
    var meta = NAF.el("span", "naf-corr-type",
      "confiance : " + (row.niveau_confiance || "non précisée"));
    body.appendChild(meta);
    item.appendChild(body);

    return item;
  }

  NAF.loadDefense().then(function (rows) {
    clear(root);

    var total = NAF.el("p", "naf-counts",
      rows.length + " codes qualifiés. Tous les autres codes de la NAF sont " +
      "non évalués, ce qui ne présume pas de leur lien avec la Défense.");
    root.appendChild(total);

    GROUPS.forEach(function (group) {
      var matching = rows.filter(function (row) {
        return row.niveau_defense === group.key;
      });
      if (!matching.length) return;

      var heading = NAF.el("h3", null, group.title);
      root.appendChild(heading);
      root.appendChild(NAF.el("p", "naf-sheet-muted naf-sheet-text", group.note));
      matching.forEach(function (row) {
        root.appendChild(buildEntry(row));
      });
    });
  }).catch(function (error) {
    clear(root);
    root.appendChild(NAF.el("p", "naf-counts",
      "Impossible de charger les qualifications (" + error.message + ")."));
  });
})();
