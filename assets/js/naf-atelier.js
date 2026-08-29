/**
 * naf-atelier.js
 * Bonus — Atelier d'étude : une interface de raisonnement méthodologique.
 *
 * L'atelier n'est ni un chatbot ni un tunnel : l'utilisateur choisit une
 * question, puis compose librement objet observé, périmètre, sources,
 * fraîcheur et indicateurs ; chaque choix affiche ses conséquences et ses
 * limites, une synthèse se construit en direct, et la fiche finale reste
 * un PROTOCOLE PROPOSÉ — jamais un résultat, jamais un chiffre inventé.
 *
 * Toute la connaissance vit dans des fichiers documentés :
 *   data/atelier_scenarios.json      règles question ↔ choix (7 scénarios)
 *   data/etudes/sources.csv          identité des sources (grain, rythme…)
 *   data/quality/source_status.json  dernier état de disponibilité
 * Ce script n'est que l'assemblage. Aucun appel à une IA : des règles
 * lisibles, reproductibles, testées (tests/test_atelier.py).
 */
(function () {
  "use strict";

  var NAF = window.NAF;
  var root = document.getElementById("naf-at");
  if (!root || !NAF) return;

  // Quarto (page-layout: full) propage ses classes page-columns/page-full
  // sur les div de la page : sa grille nommée disloquerait la mise en page
  // de l'atelier. On retire ces classes à l'intérieur de #naf-at — au
  // chargement et après coup, car quarto.js les pose de façon différée.
  function stripQuartoGrid() {
    var nodes = [root].concat(
      Array.prototype.slice.call(root.querySelectorAll(".page-columns")));
    nodes.forEach(function (node) {
      node.classList.remove("page-columns", "page-full");
    });
  }
  stripQuartoGrid();
  window.addEventListener("load", stripQuartoGrid);

  var dom = {
    chooser: document.getElementById("naf-at-chooser"),
    work: document.getElementById("naf-at-work"),
    synth: document.getElementById("naf-at-synth"),
    fiche: document.getElementById("naf-at-fiche"),
  };

  var DATA = { rules: null, sources: {}, status: {} };

  var ROLES = {
    recommandee: "Recommandée",
    complementaire: "Complémentaire",
    optionnelle: "Optionnelle",
  };

  var NIVEAUX = {
    recommande: "recommandé",
    possible: "possible",
    prudence: "à utiliser avec prudence",
  };

  var STATUS_LABELS = {
    AVAILABLE: "✓ disponible lors du dernier contrôle",
    WARNING: "⚠ le dernier contrôle automatisé a rencontré une difficulté",
    ACCESS_SPECIFIC: "↗ accès spécifique (compte, clé ou droits)",
    UNAVAILABLE: "✕ lien à corriger lors du dernier contrôle",
    MANUAL: "? contrôle manuel",
  };

  var TOOLBOX = {
    sirene_stock: "fiche-sirene", sirene_api: "fiche-sirene",
    sirene_geo: "fiche-sirene", sirus: "fiche-sirus",
    side: "fiche-side", side_stocks: "fiche-side",
    boamp: "fiche-boamp", decp: "fiche-decp",
    bodacc: "fiche-bodacc", rne: "fiche-bodacc",
    douanes: "fiche-douanes", inpi_brevets: "fiche-inpi",
    refd: "fiche-refd", edis: "fiche-refd",
    naf_correspondance: "fiche-naf",
  };

  var state = null;
  var nafPickerNomenclature = null;

  var el = NAF.el;

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function shortName(source) {
    return source.nom.split("—")[0].split("(")[0].trim();
  }

  function scenarioById(id) {
    return DATA.rules.scenarios.filter(function (s) {
      return s.id === id;
    })[0] || null;
  }

  /* ═══════════════════════════════════════════════════════════════════
     État
  ═══════════════════════════════════════════════════════════════════ */

  function defaultState(scenario) {
    function firstNiveau(list) {
      var hit = list.filter(function (x) {
        return x.niveau === "recommande";
      })[0];
      return (hit || list[0]).id;
    }
    return {
      scenario: scenario,
      grain: firstNiveau(scenario.grains),
      perimetre: firstNiveau(scenario.perimetres),
      nafCode: null,
      sources: scenario.sources.filter(function (s) {
        return s.role === "recommandee";
      }).map(function (s) { return s.id; }),
      fraicheur: firstNiveau(scenario.fraicheurs),
      indicateurs: scenario.indicateurs.slice(0, 2)
        .map(function (i) { return i.label; }),
    };
  }

  function updateUrl() {
    var params = new URLSearchParams();
    if (state) {
      params.set("question", state.scenario.id);
      params.set("grain", state.grain);
    }
    var qs = params.toString();
    history.replaceState(null, "",
      window.location.pathname + (qs ? "?" + qs : ""));
  }

  function setState(patch) {
    Object.keys(patch).forEach(function (k) { state[k] = patch[k]; });
    updateUrl();
    renderWorkspace();
    renderSynth();
  }

  /* ═══════════════════════════════════════════════════════════════════
     Choix de la question
  ═══════════════════════════════════════════════════════════════════ */

  function renderChooser() {
    clear(dom.chooser);
    DATA.rules.scenarios.forEach(function (scenario) {
      var button = el("button", "naf-px-item naf-at-q");
      button.type = "button";
      button.appendChild(el("span", "naf-px-item-num", scenario.numero));
      var body = el("span", "naf-px-item-body");
      body.appendChild(el("span", "naf-at-q-verbe", scenario.verbe));
      body.appendChild(el("span", "naf-px-item-title", scenario.titre));
      button.appendChild(body);
      var arrow = el("span", "naf-px-item-arrow", "→");
      arrow.setAttribute("aria-hidden", "true");
      button.appendChild(arrow);
      button.addEventListener("click", function () {
        startScenario(scenario);
      });
      dom.chooser.appendChild(button);
    });
    var autre = el("p", "naf-at-autre",
      "Autre question ? L'atelier couvre sept familles d'études ; pour un " +
      "sujet différent, la même grille reste valable : question → unité → " +
      "périmètre → sources → fraîcheur → limites. Les fiches de la Boîte à " +
      "outils et la page Comprendre vous aideront à la remplir.");
    dom.chooser.appendChild(autre);
  }

  function startScenario(scenario) {
    state = defaultState(scenario);
    updateUrl();
    dom.chooser.hidden = true;
    dom.fiche.hidden = true;
    dom.work.hidden = false;
    dom.synth.hidden = false;
    renderWorkspace();
    renderSynth();
    dom.work.scrollIntoView({ block: "start" });
  }

  function resetAll() {
    state = null;
    updateUrl();
    dom.work.hidden = true;
    dom.synth.hidden = true;
    dom.fiche.hidden = true;
    dom.chooser.hidden = false;
    clear(dom.work);
    clear(dom.synth);
    clear(dom.fiche);
  }

  /* ═══════════════════════════════════════════════════════════════════
     Blocs de construction
  ═══════════════════════════════════════════════════════════════════ */

  function sectionBlock(title, hint) {
    var section = el("section", "naf-at-section");
    var head = el("header", "naf-at-section-head");
    head.appendChild(el("h3", "naf-at-section-title", title));
    if (hint) head.appendChild(el("p", "naf-at-section-hint", hint));
    section.appendChild(head);
    return section;
  }

  function niveauTag(niveau) {
    return el("span", "naf-at-niveau naf-at-niveau-" + niveau,
      NIVEAUX[niveau] || niveau);
  }

  function choiceRow(kind, name, checked, onChange) {
    var label = el("label", "naf-at-choice" +
      (checked ? " is-checked" : ""));
    var input = el("input");
    input.type = kind;
    input.name = name;
    input.checked = checked;
    input.addEventListener("change", onChange);
    label.appendChild(input);
    var body = el("span", "naf-at-choice-body");
    label.appendChild(body);
    return { row: label, body: body };
  }

  /* ═══════════════════════════════════════════════════════════════════
     Espace de travail
  ═══════════════════════════════════════════════════════════════════ */

  function renderWorkspace() {
    var scenario = state.scenario;
    clear(dom.work);

    /* Rappel de la question */
    var head = el("div", "naf-at-current");
    var headText = el("div", "naf-at-current-text");
    headText.appendChild(el("p", "naf-comp-kicker",
      scenario.numero + " · " + scenario.verbe));
    headText.appendChild(el("h2", "naf-at-current-title", scenario.titre));
    head.appendChild(headText);
    var change = el("button", "naf-linklike naf-at-change", "Changer de question");
    change.type = "button";
    change.addEventListener("click", resetAll);
    head.appendChild(change);
    dom.work.appendChild(head);

    dom.work.appendChild(renderGrains());
    dom.work.appendChild(renderPerimetres());
    dom.work.appendChild(renderSources());
    dom.work.appendChild(renderFraicheur());
    dom.work.appendChild(renderAppariement());
    dom.work.appendChild(renderIndicateurs());
    dom.work.appendChild(renderLimites());
    renderAlertes();

    var actions = el("p", "naf-comp-ctas naf-at-actions");
    var generate = el("button", "naf-chg-cta naf-at-generate",
      "Générer la fiche méthode →");
    generate.type = "button";
    generate.addEventListener("click", renderFiche);
    actions.appendChild(generate);
    dom.work.appendChild(actions);
  }

  function renderGrains() {
    var scenario = state.scenario;
    var section = sectionBlock("Qu'allez-vous réellement compter ?",
      "L'unité d'observation décide de tout ce qui suit.");
    section.appendChild(handNote("« qu'est-ce que je compte vraiment ? »"));

    scenario.grains.forEach(function (option) {
      var grain = DATA.rules.grains[option.id];
      var choice = choiceRow("radio", "naf-at-grain",
        state.grain === option.id, function () {
          setState({ grain: option.id });
        });
      var top = el("span", "naf-at-choice-top");
      top.appendChild(el("strong", null, grain.label));
      top.appendChild(el("span", "naf-mono naf-at-cle", grain.cle));
      top.appendChild(niveauTag(option.niveau));
      choice.body.appendChild(top);
      choice.body.appendChild(el("span", "naf-at-choice-desc",
        option.pourquoi || grain.description));
      if (option.niveau === "prudence" && option.avertissement) {
        choice.body.appendChild(el("span", "naf-at-choice-warn",
          option.avertissement));
      }
      section.appendChild(choice.row);
    });
    return section;
  }

  function renderPerimetres() {
    var scenario = state.scenario;
    var section = sectionBlock("Comment définir votre population ?",
      "La NAF est un périmètre possible parmi d'autres — pas le défaut " +
      "de toute étude.");

    scenario.perimetres.forEach(function (option) {
      var choice = choiceRow("radio", "naf-at-perimetre",
        state.perimetre === option.id, function () {
          setState({ perimetre: option.id });
        });
      var top = el("span", "naf-at-choice-top");
      top.appendChild(el("strong", null,
        DATA.rules.perimetre_labels[option.id] || option.id));
      top.appendChild(niveauTag(option.niveau));
      choice.body.appendChild(top);
      var consequences = el("span", "naf-at-choice-desc");
      consequences.appendChild(el("em", null, "Avantage : "));
      consequences.appendChild(document.createTextNode(option.avantage + ". "));
      consequences.appendChild(el("em", null, "Limite : "));
      consequences.appendChild(document.createTextNode(option.limite + "."));
      choice.body.appendChild(consequences);
      section.appendChild(choice.row);
    });

    if (scenario.naf_selectable && state.perimetre === "naf") {
      section.appendChild(renderNafPicker());
    }
    return section;
  }

  function renderNafPicker() {
    var wrap = el("div", "naf-at-nafpick");
    if (state.nafCode) {
      var chip = el("p", "naf-at-nafchip");
      chip.appendChild(el("span", "naf-mono", state.nafCode.code));
      chip.appendChild(el("span", null, " " + state.nafCode.label + " "));
      var remove = el("button", "naf-linklike", "retirer");
      remove.type = "button";
      remove.addEventListener("click", function () {
        setState({ nafCode: null });
      });
      chip.appendChild(remove);
      wrap.appendChild(chip);
      return wrap;
    }
    var label = el("label", "naf-at-nafpick-label",
      "Choisir un code NAF 2025 (facultatif)");
    label.setAttribute("for", "naf-at-nafq");
    wrap.appendChild(label);
    var input = el("input", "naf-search-input");
    input.id = "naf-at-nafq";
    input.type = "search";
    input.placeholder = "26.51Y, radar, aéronautique…";
    input.autocomplete = "off";
    wrap.appendChild(input);
    var results = el("div", "naf-at-nafresults");
    wrap.appendChild(results);

    input.addEventListener("input", NAF.debounce(function () {
      var query = input.value.trim();
      clear(results);
      if (!query) return;
      var ready = nafPickerNomenclature
        ? Promise.resolve(nafPickerNomenclature)
        : NAF.loadNomenclature("2025").then(function (n) {
            nafPickerNomenclature = n;
            return n;
          });
      ready.then(function (nomenclature) {
        clear(results);
        NAF.search(nomenclature.entries, query, 6).forEach(function (entry) {
          var button = el("button", "naf-at-nafresult");
          button.type = "button";
          button.appendChild(el("span", "naf-mono", entry.node.code));
          button.appendChild(el("span", null, entry.node.label));
          button.addEventListener("click", function () {
            setState({ nafCode: { code: entry.node.code,
              label: entry.node.label } });
          });
          results.appendChild(button);
        });
      });
    }, 150));
    return wrap;
  }

  function renderSources() {
    var scenario = state.scenario;
    var section = sectionBlock("Quelles sources peuvent répondre ?",
      "Chaque source répond à une partie de la question — aucune n'est " +
      "« meilleure » dans l'absolu.");
    section.appendChild(handNote("« une source répond à une question, pas à toutes »"));

    scenario.sources.forEach(function (entry) {
      var source = DATA.sources[entry.id];
      if (!source) return;
      var checked = state.sources.indexOf(entry.id) !== -1;
      var choice = choiceRow("checkbox", "naf-at-src", checked, function (event) {
        var next = state.sources.slice();
        if (event.target.checked) next.push(entry.id);
        else next = next.filter(function (x) { return x !== entry.id; });
        setState({ sources: next });
      });

      var top = el("span", "naf-at-choice-top");
      top.appendChild(el("strong", null, shortName(source)));
      top.appendChild(el("span", "naf-at-role naf-at-role-" + entry.role,
        ROLES[entry.role]));
      choice.body.appendChild(top);
      choice.body.appendChild(el("span", "naf-at-choice-desc",
        "Pourquoi : " + entry.pourquoi + "."));
      choice.body.appendChild(el("span", "naf-at-src-meta",
        source.unite + " · " + source.frequence + " · " + source.acces));
      choice.body.appendChild(el("span", "naf-at-choice-warn",
        source.limitations.split(";")[0].split(":")[0].trim() + "."));

      var status = DATA.status[entry.id];
      var line = el("span", "naf-at-src-status");
      line.appendChild(el("span", null,
        STATUS_LABELS[status] || "? non contrôlé"));
      var see = el("a", "naf-link", "Voir l'état →");
      see.href = "sources.html#source-" + entry.id;
      line.appendChild(see);
      choice.body.appendChild(line);

      if (status === "UNAVAILABLE" && entry.alternative_id) {
        var alt = DATA.sources[entry.alternative_id];
        if (alt) {
          choice.body.appendChild(el("span", "naf-at-choice-warn",
            shortName(source) + " indisponible → " + shortName(alt) +
            " peut répondre à une partie du besoin."));
        }
      }
      section.appendChild(choice.row);
    });
    return section;
  }

  function renderFraicheur() {
    var scenario = state.scenario;
    var section = sectionBlock(
      "À quel point les données doivent-elles être récentes ?", null);
    section.appendChild(handNote(
      "« le plus récent n'est pas toujours le plus consolidé »"));

    scenario.fraicheurs.forEach(function (option) {
      var fraicheur = DATA.rules.fraicheurs[option.id];
      var choice = choiceRow("radio", "naf-at-fraicheur",
        state.fraicheur === option.id, function () {
          setState({ fraicheur: option.id });
        });
      var top = el("span", "naf-at-choice-top");
      top.appendChild(el("strong", null, fraicheur.label));
      top.appendChild(el("span", "naf-at-cle", fraicheur.horizon));
      top.appendChild(niveauTag(option.niveau));
      choice.body.appendChild(top);
      choice.body.appendChild(el("span", "naf-at-choice-desc",
        fraicheur.consequence + (option.note ? " — " + option.note + "." : "")));
      section.appendChild(choice.row);
    });
    return section;
  }

  function renderAppariement() {
    var section = sectionBlock("Comment relier les sources ?", null);
    section.appendChild(el("p", "naf-at-text", state.scenario.appariement));
    section.appendChild(handNote(
      "« même SIREN ? même période ? même concept ? »"));
    return section;
  }

  function renderIndicateurs() {
    var scenario = state.scenario;
    var section = sectionBlock("Quels indicateurs sont défendables ?", null);
    scenario.indicateurs.forEach(function (indicateur) {
      var checked = state.indicateurs.indexOf(indicateur.label) !== -1;
      var choice = choiceRow("checkbox", "naf-at-ind", checked,
        function (event) {
          var next = state.indicateurs.slice();
          if (event.target.checked) next.push(indicateur.label);
          else next = next.filter(function (x) {
            return x !== indicateur.label;
          });
          setState({ indicateurs: next });
        });
      var top = el("span", "naf-at-choice-top");
      top.appendChild(el("strong", null, indicateur.label));
      choice.body.appendChild(top);
      if (indicateur.note) {
        choice.body.appendChild(el("span", "naf-at-choice-desc",
          indicateur.note + "."));
      }
      section.appendChild(choice.row);
    });
    return section;
  }

  function renderLimites() {
    var scenario = state.scenario;
    var section = sectionBlock("Qu'est-ce que vos données ne diront pas ?",
      "Un protocole sans limites n'est pas un protocole.");
    var list = el("ul", "naf-at-limites");
    scenario.limites.forEach(function (id) {
      list.appendChild(el("li", null, DATA.rules.limitations[id]));
    });
    section.appendChild(list);

    var invisible = el("div", "naf-callout");
    invisible.appendChild(el("strong", null,
      "Ce que vous ne verrez pas nécessairement : "));
    invisible.appendChild(document.createTextNode(
      DATA.rules.invisibles_defense.join(" ; ") + "."));
    section.appendChild(invisible);
    return section;
  }

  function handNote(text) {
    var hand = el("p", "naf-hand naf-at-hand", text);
    hand.setAttribute("aria-hidden", "true");
    return hand;
  }

  /* ── Alertes méthodologiques ─────────────────────────────────────── */

  function activeAlertes() {
    return (state.scenario.alertes || []).filter(function (alerte) {
      if (alerte.si_grain) return state.grain === alerte.si_grain;
      if (alerte.si_perimetre) return state.perimetre === alerte.si_perimetre;
      if (alerte.si_sources_sans) {
        return state.sources.indexOf(alerte.si_sources_sans) === -1;
      }
      return false;
    });
  }

  function renderAlertes() {
    activeAlertes().forEach(function (alerte) {
      var box = el("div", "naf-at-alerte");
      box.setAttribute("role", "note");
      box.appendChild(el("strong", null, "Alerte méthodologique. "));
      box.appendChild(document.createTextNode(alerte.texte + " "));
      if (alerte.suggere_grain) {
        var fixGrain = el("button", "naf-linklike",
          "Passer à l'établissement");
        fixGrain.type = "button";
        fixGrain.addEventListener("click", function () {
          setState({ grain: alerte.suggere_grain });
        });
        box.appendChild(fixGrain);
      }
      if (alerte.suggere_source) {
        var fixSource = el("button", "naf-linklike", "Ajouter cette source");
        fixSource.type = "button";
        fixSource.addEventListener("click", function () {
          setState({ sources: state.sources.concat([alerte.suggere_source]) });
        });
        box.appendChild(fixSource);
      }
      dom.work.appendChild(box);
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     Synthèse en direct
  ═══════════════════════════════════════════════════════════════════ */

  function synthEntries() {
    var scenario = state.scenario;
    var grain = DATA.rules.grains[state.grain];
    var entries = [
      ["Question", scenario.titre],
      ["Objet observé", grain.label + " — " + grain.cle],
      ["Périmètre", (DATA.rules.perimetre_labels[state.perimetre] ||
        state.perimetre) + (state.nafCode ? " · " + state.nafCode.code +
        " " + state.nafCode.label : "")],
      ["Sources", state.sources.map(function (id) {
        return DATA.sources[id] ? shortName(DATA.sources[id]) : id;
      }).join(" · ") || "—"],
      ["Fraîcheur", DATA.rules.fraicheurs[state.fraicheur].label + " (" +
        DATA.rules.fraicheurs[state.fraicheur].horizon + ")"],
      ["Appariement", scenario.appariement],
      ["Indicateurs", state.indicateurs.join(" · ") || "—"],
      ["Limites", scenario.limites.map(function (id) {
        return DATA.rules.limitations[id];
      })],
    ];
    return entries;
  }

  function renderSynth() {
    clear(dom.synth);
    dom.synth.appendChild(el("p", "naf-at-badge", "Protocole proposé"));
    dom.synth.appendChild(el("h2", "naf-at-synth-title", "Votre protocole"));

    var list = el("dl", "naf-at-synth-list");
    synthEntries().forEach(function (entry) {
      if (entry[0] === "Appariement") return; // détail réservé à la fiche
      list.appendChild(el("dt", null, entry[0]));
      var dd = el("dd");
      if (Array.isArray(entry[1])) {
        dd.textContent = entry[1][0];
      } else {
        dd.textContent = entry[1];
      }
      list.appendChild(dd);
    });
    dom.synth.appendChild(list);

    var count = activeAlertes().length;
    if (count) {
      dom.synth.appendChild(el("p", "naf-at-synth-alerte",
        count + (count > 1 ? " alertes méthodologiques actives"
          : " alerte méthodologique active")));
    }
    dom.synth.appendChild(handNote("« la méthode commence à prendre forme »"));
  }

  /* ═══════════════════════════════════════════════════════════════════
     Fiche méthode finale
  ═══════════════════════════════════════════════════════════════════ */

  function renderFiche() {
    var scenario = state.scenario;
    clear(dom.fiche);
    dom.fiche.hidden = false;
    dom.work.hidden = true;
    dom.synth.hidden = true;

    var head = el("header", "naf-at-fiche-head");
    head.appendChild(el("p", "naf-at-badge", "Protocole proposé"));
    head.appendChild(el("h2", "naf-at-fiche-title", "Protocole proposé"));
    head.appendChild(el("p", "naf-at-fiche-sub",
      "Protocole méthodologique proposé — à adapter au contexte de " +
      "l'étude. Généré le " + new Date().toLocaleDateString("fr-FR") + "."));
    dom.fiche.appendChild(head);

    function ficheSection(title, content) {
      var section = el("section", "naf-at-fiche-section");
      section.appendChild(el("h3", "naf-at-fiche-h", title));
      if (typeof content === "string") {
        section.appendChild(el("p", null, content));
      } else {
        section.appendChild(content);
      }
      dom.fiche.appendChild(section);
    }

    var grain = DATA.rules.grains[state.grain];
    ficheSection("Votre question", scenario.titre);
    ficheSection("Ce que vous observez", grain.label + " (" + grain.cle +
      ") — " + grain.description);
    ficheSection("Périmètre",
      (DATA.rules.perimetre_labels[state.perimetre] || state.perimetre) +
      (state.nafCode ? " · " + state.nafCode.code + " — " +
        state.nafCode.label : ""));

    var sourcesList = el("ol", "naf-at-fiche-sources");
    state.sources.forEach(function (id) {
      var source = DATA.sources[id];
      if (!source) return;
      var item = el("li");
      item.appendChild(el("strong", null, shortName(source)));
      item.appendChild(el("span", "naf-at-src-meta",
        " — " + source.unite + " · " + source.frequence + " · " +
        source.acces));
      if (TOOLBOX[id]) {
        var link = el("a", "naf-link naf-at-noprint",
          "Voir comment la récupérer →");
        link.href = "../comprendre/boite-outils.html#" + TOOLBOX[id];
        item.appendChild(document.createTextNode(" "));
        item.appendChild(link);
      }
      sourcesList.appendChild(item);
    });
    ficheSection("Sources", sourcesList);

    ficheSection("Appariements", scenario.appariement);
    ficheSection("Fraîcheur",
      DATA.rules.fraicheurs[state.fraicheur].label + " (" +
      DATA.rules.fraicheurs[state.fraicheur].horizon + ") — " +
      DATA.rules.fraicheurs[state.fraicheur].consequence);

    var indicateursList = el("ul");
    state.indicateurs.forEach(function (label) {
      indicateursList.appendChild(el("li", null, label));
    });
    ficheSection("Indicateurs", indicateursList);

    ficheSection("Contrôles",
      "Schémas et volumes vérifiés avant analyse ; doublons et valeurs " +
      "impossibles recherchés ; taux d'appariement mesuré et publié avec " +
      "les résultats.");

    var limitesList = el("ul");
    scenario.limites.forEach(function (id) {
      limitesList.appendChild(el("li", null, DATA.rules.limitations[id]));
    });
    limitesList.appendChild(el("li", null,
      "Ce que vous ne verrez pas nécessairement : " +
      DATA.rules.invisibles_defense.join(" ; ") + "."));
    ficheSection("À garder en tête", limitesList);

    var outils = el("p");
    outils.appendChild(document.createTextNode(
      "Les recettes R et Python de chaque source sont dans la "));
    var toolboxLink = el("a", "naf-link", "Boîte à outils");
    toolboxLink.href = "../comprendre/boite-outils.html";
    outils.appendChild(toolboxLink);
    outils.appendChild(document.createTextNode(
      " (tabsets Python / R synchronisés)."));
    ficheSection("Outils", outils);

    var actions = el("p", "naf-comp-ctas naf-at-noprint");
    var copy = el("button", "naf-chg-cta", "Copier en Markdown");
    copy.type = "button";
    copy.addEventListener("click", function () {
      copyMarkdown(copy);
    });
    actions.appendChild(copy);
    var print = el("button", "naf-chg-cta", "Imprimer");
    print.type = "button";
    print.addEventListener("click", function () { window.print(); });
    actions.appendChild(print);
    var back = el("button", "naf-chg-cta", "Modifier le protocole");
    back.type = "button";
    back.addEventListener("click", function () {
      dom.fiche.hidden = true;
      dom.work.hidden = false;
      dom.synth.hidden = false;
    });
    actions.appendChild(back);
    var restart = el("button", "naf-chg-cta", "Nouvelle étude");
    restart.type = "button";
    restart.addEventListener("click", resetAll);
    actions.appendChild(restart);
    dom.fiche.appendChild(actions);

    dom.fiche.appendChild(el("p", "naf-at-mention",
      "Les recommandations proposées reposent sur les caractéristiques " +
      "documentées des sources et constituent une aide au cadrage. Elles " +
      "ne remplacent pas l'expertise nécessaire à chaque étude."));

    dom.fiche.scrollIntoView({ block: "start" });
  }

  function buildMarkdown() {
    var scenario = state.scenario;
    var grain = DATA.rules.grains[state.grain];
    var lines = [
      "# Protocole d'étude — proposé",
      "",
      "## Question", scenario.titre, "",
      "## Unité d'observation",
      grain.label + " (" + grain.cle + ")", "",
      "## Périmètre",
      (DATA.rules.perimetre_labels[state.perimetre] || state.perimetre) +
        (state.nafCode ? " · " + state.nafCode.code + " — " +
          state.nafCode.label : ""), "",
      "## Sources",
    ];
    state.sources.forEach(function (id) {
      var source = DATA.sources[id];
      if (source) {
        lines.push("- " + shortName(source) + " (" + source.unite + " · " +
          source.frequence + ")");
      }
    });
    lines.push("", "## Appariements", scenario.appariement, "",
      "## Fraîcheur", DATA.rules.fraicheurs[state.fraicheur].label + " (" +
      DATA.rules.fraicheurs[state.fraicheur].horizon + ")", "",
      "## Indicateurs");
    state.indicateurs.forEach(function (label) {
      lines.push("- " + label);
    });
    lines.push("", "## Limites");
    scenario.limites.forEach(function (id) {
      lines.push("- " + DATA.rules.limitations[id]);
    });
    lines.push("- Ce que vous ne verrez pas nécessairement : " +
      DATA.rules.invisibles_defense.join(" ; ") + ".");
    lines.push("", "---",
      "Protocole méthodologique proposé — à adapter au contexte de " +
      "l'étude. Construit avec l'Atelier d'étude d'Explorateur NAF.");
    return lines.join("\n");
  }

  function copyMarkdown(button) {
    var text = buildMarkdown();
    var done = function () {
      var previous = button.textContent;
      button.textContent = "Copié ✓";
      setTimeout(function () { button.textContent = previous; }, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done);
    } else {
      var area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
      done();
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     Démarrage
  ═══════════════════════════════════════════════════════════════════ */

  Promise.all([
    fetch(NAF.dataUrl("atelier_scenarios.json")).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }),
    NAF.loadCsv("etudes/sources.csv"),
    fetch(NAF.dataUrl("quality/source_status.json")).then(function (r) {
      return r.ok ? r.json() : null;
    }).catch(function () { return null; }),
  ]).then(function (loaded) {
    DATA.rules = loaded[0];
    loaded[1].forEach(function (source) {
      DATA.sources[source.source_id] = source;
    });
    if (loaded[2]) {
      (loaded[2].sources || []).forEach(function (s) {
        DATA.status[s.source_id] = s.status;
      });
    }
    renderChooser();

    var params = new URLSearchParams(window.location.search);
    var wanted = scenarioById(params.get("question"));
    if (wanted) {
      startScenario(wanted);
      var grainParam = params.get("grain");
      if (grainParam && wanted.grains.some(function (g) {
        return g.id === grainParam;
      })) {
        setState({ grain: grainParam });
      }
    }
  }).catch(function (error) {
    clear(dom.chooser);
    dom.chooser.appendChild(el("p", "naf-error",
      "Impossible de charger l'atelier (" + error.message + ")."));
  });
})();
