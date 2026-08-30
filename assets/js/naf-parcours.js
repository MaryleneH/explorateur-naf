/**
 * naf-parcours.js
 * Parcours guidés (rubrique Bonus) : une couche narrative AU-DESSUS des
 * pages existantes, jamais à leur place.
 *
 * Principe : l'URL est l'état. `?parcours=<id>&etape=<n>` sur n'importe
 * quelle page cible fait apparaître le panneau narratif ; chaque étape est
 * donc partageable. Le contenu vit dans data/parcours.json (source unique) ;
 * les libellés NAF sont résolus au runtime depuis naf2025.csv / naf2008.csv,
 * jamais dupliqués.
 *
 * Le script est autonome : il calcule la racine du site depuis sa propre
 * URL et embarque un mini-parseur CSV, pour fonctionner sur toutes les
 * pages sans dépendre de naf-core.js.
 *
 * Sur bonus/parcours.html, le même script rend la liste éditoriale des
 * parcours (#naf-px-list) et la carte d'introduction (?story=<id>).
 */
(function () {
  "use strict";

  var script = document.currentScript;
  var SITE_ROOT = new URL("../../", script.src).href;

  var params = new URLSearchParams(window.location.search);
  var storyId = params.get("parcours");
  var stepNum = parseInt(params.get("etape") || "1", 10);
  var pageList = document.getElementById("naf-px-list");
  var pageIntro = document.getElementById("naf-px-intro");
  var chooserStory = params.get("story");

  if (!storyId && !pageList) return;

  /* ── Chargement des données ──────────────────────────────────────── */

  function fetchJson(path) {
    return fetch(SITE_ROOT + path).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " sur " + path);
      return r.json();
    });
  }

  // Mini-parseur CSV conforme (guillemets, virgules internes) : on n'en lit
  // que deux colonnes, mais on les lit juste.
  function parseCsv(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    var rows = [], row = [], field = "", inQ = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
        } else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c !== "\r") field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  var labelCache = {};

  function loadLabels(version) {
    if (!labelCache[version]) {
      var file = version === "2008" ? "data/naf2008.csv" : "data/naf2025.csv";
      labelCache[version] = fetch(SITE_ROOT + file).then(function (r) {
        return r.text();
      }).then(function (text) {
        var rows = parseCsv(text);
        var head = rows[0];
        var iCode = head.indexOf("subclass_code");
        var iLabel = head.indexOf("subclass_label");
        var map = {};
        rows.slice(1).forEach(function (r) { map[r[iCode]] = r[iLabel]; });
        return map;
      });
    }
    return labelCache[version];
  }

  /** Remplace les jetons {{2025:CODE}} / {{2008:CODE}} par le libellé officiel. */
  function resolveLabels(html) {
    var tokens = html.match(/\{\{(2025|2008):([0-9.]+[A-Z])\}\}/g) || [];
    if (!tokens.length) return Promise.resolve(html);
    var versions = {};
    tokens.forEach(function (t) { versions[t.slice(2, 6)] = true; });
    return Promise.all(Object.keys(versions).map(loadLabels)).then(function () {
      return Promise.all([]).then(function () {
        return tokens.reduce(function (p, token) {
          return p.then(function (out) {
            var version = token.slice(2, 6);
            var code = token.slice(7, -2);
            return loadLabels(version).then(function (map) {
              var label = map[code] || code;
              return out.split(token).join(
                '<em>' + label.replace(/&/g, "&amp;").replace(/</g, "&lt;") + '</em>');
            });
          });
        }, Promise.resolve(html));
      });
    });
  }

  /* ── URLs ────────────────────────────────────────────────────────── */

  function stepHref(story, index) {
    var step = story.steps[index];
    var raw = step.url || currentPageUrl();
    var hashSplit = raw.split("#");
    var base = hashSplit[0];
    var hash = hashSplit[1] ? "#" + hashSplit[1] : "";
    var sep = base.indexOf("?") === -1 ? "?" : "&";
    var target = base + sep + "parcours=" + encodeURIComponent(story.id) +
      "&etape=" + (index + 1) + hash;
    return step.url ? SITE_ROOT + target : target;
  }

  function currentPageUrl() {
    var clean = new URLSearchParams(window.location.search);
    clean.delete("parcours");
    clean.delete("etape");
    var qs = clean.toString();
    return window.location.pathname + (qs ? "?" + qs : "");
  }

  /** Même page et mêmes paramètres propres ? Alors pas de rechargement. */
  function isSameTarget(step) {
    if (!step.url) return true;
    var target = new URL(SITE_ROOT + step.url);
    if (target.pathname !== window.location.pathname) return false;
    var wanted = new URLSearchParams(target.search);
    var current = new URLSearchParams(window.location.search);
    current.delete("parcours");
    current.delete("etape");
    wanted.sort(); current.sort();
    return wanted.toString() === current.toString();
  }

  function goToStep(story, index) {
    var step = story.steps[index];
    if (isSameTarget(step)) {
      var url = new URL(window.location.href);
      url.searchParams.set("parcours", story.id);
      url.searchParams.set("etape", String(index + 1));
      var hash = (step.url || "").split("#")[1];
      history.replaceState(null, "", url.pathname + url.search +
        (hash ? "#" + hash : window.location.hash));
      if (hash) {
        // Déclenche les ouvertures pilotées par l'ancre (fiches, recettes).
        window.dispatchEvent(new HashChangeEvent("hashchange"));
        var target = document.getElementById(hash);
        if (target) target.scrollIntoView({ block: "start" });
      }
      render(story, index);
    } else {
      window.location.href = stepHref(story, index);
    }
  }

  /* ── Panneau narratif ────────────────────────────────────────────── */

  var panel = null;
  var checkDone = false;

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function ensurePanel() {
    if (panel) return panel;
    panel = el("aside", "naf-px-panel");
    panel.setAttribute("role", "complementary");
    panel.setAttribute("aria-label", "Parcours guidé");
    document.body.appendChild(panel);
    document.body.classList.add("naf-px-active");
    return panel;
  }

  function render(story, index) {
    var step = story.steps[index];
    var box = ensurePanel();
    checkDone = false;
    box.innerHTML = "";

    var head = el("header", "naf-px-head");
    var kicker = el("p", "naf-px-kicker",
      story.titre + " · " + (index + 1) + " / " + story.steps.length);
    head.appendChild(kicker);

    var quit = el("a", "naf-px-quit");
    quit.href = currentPageUrl() || window.location.pathname;
    quit.setAttribute("aria-label", "Quitter le parcours");
    quit.title = "Quitter le parcours";
    quit.textContent = "×";
    head.appendChild(quit);

    var fold = el("button", "naf-px-fold");
    fold.type = "button";
    fold.setAttribute("aria-expanded", "true");
    fold.setAttribute("aria-label", "Replier le panneau du parcours");
    fold.textContent = "▾";
    fold.addEventListener("click", function () {
      var folded = box.classList.toggle("is-folded");
      fold.setAttribute("aria-expanded", folded ? "false" : "true");
      fold.textContent = folded ? "▴" : "▾";
    });
    head.appendChild(fold);
    box.appendChild(head);

    var body = el("div", "naf-px-body");
    body.setAttribute("aria-live", "polite");

    var dots = el("div", "naf-px-dots");
    dots.setAttribute("aria-hidden", "true");
    story.steps.forEach(function (_, i) {
      var dot = el("span", "naf-px-dot" + (i <= index ? " is-done" : ""));
      dots.appendChild(dot);
    });
    body.appendChild(dots);

    body.appendChild(el("h2", "naf-px-title", step.titre));

    var text = el("p", "naf-px-text");
    body.appendChild(text);
    resolveLabels(step.texte).then(function (html) {
      text.innerHTML = html;
    });

    if (step.hand) {
      var hand = el("p", "naf-hand naf-px-hand", step.hand);
      hand.setAttribute("aria-hidden", "true");
      body.appendChild(hand);
    }

    if (step.action && !step.conclusion) {
      var action = el("p", "naf-px-action");
      action.appendChild(el("span", "naf-px-action-label", step.action));
      if (step.check) {
        var status = el("span", "naf-px-check", "");
        status.id = "naf-px-check";
        action.appendChild(status);
      }
      body.appendChild(action);
    }

    var nav = el("nav", "naf-px-nav");
    nav.setAttribute("aria-label", "Navigation du parcours");

    if (!step.conclusion) {
      if (index > 0) {
        var prev = el("a", "naf-px-btn naf-px-btn-ghost", "← Précédent");
        prev.href = stepHref(story, index - 1);
        prev.addEventListener("click", function (event) {
          event.preventDefault();
          goToStep(story, index - 1);
        });
        nav.appendChild(prev);
      }
      var next = el("a", "naf-px-btn", "Suivant →");
      next.href = stepHref(story, index + 1);
      next.addEventListener("click", function (event) {
        event.preventDefault();
        goToStep(story, index + 1);
      });
      nav.appendChild(next);
    } else {
      var restart = el("a", "naf-px-btn naf-px-btn-ghost", "Recommencer");
      restart.href = stepHref(story, 0);
      nav.appendChild(restart);
      var others = el("a", "naf-px-btn", "Choisir un autre parcours");
      others.href = SITE_ROOT + "bonus/parcours.html";
      nav.appendChild(others);
    }
    body.appendChild(nav);
    box.appendChild(body);

    if (step.check) armCheck(step.check);
  }

  /** Détection légère : un clic sur l'élément attendu affiche ✓ — mais
      « Suivant » reste toujours disponible, rien n'est bloquant. */
  function armCheck(check) {
    function onClick(event) {
      if (checkDone) return;
      var hit = event.target.closest(check.selector);
      if (!hit) return;
      if (check.contains &&
          hit.textContent.indexOf(check.contains) === -1) return;
      checkDone = true;
      var status = document.getElementById("naf-px-check");
      if (status) status.textContent = "✓ " + (check.done || "Fait");
      document.removeEventListener("click", onClick, true);
    }
    document.addEventListener("click", onClick, true);
  }

  /* ── Page « Parcours guidés » : liste et introduction ────────────── */

  function renderList(data) {
    pageList.innerHTML = "";
    data.stories.forEach(function (story) {
      var item = el("a", "naf-px-item");
      item.href = "parcours.html?story=" + encodeURIComponent(story.id);
      item.appendChild(el("span", "naf-px-item-num", story.numero));
      var bodyEl = el("span", "naf-px-item-body");
      bodyEl.appendChild(el("span", "naf-px-item-title", story.titre));
      bodyEl.appendChild(el("span", "naf-px-item-sub", story.sous_titre));
      item.appendChild(bodyEl);
      var meta = el("span", "naf-px-item-meta");
      meta.appendChild(el("span", "naf-px-item-theme", story.theme));
      meta.appendChild(el("span", "naf-px-item-time", story.duree));
      item.appendChild(meta);
      var arrow = el("span", "naf-px-item-arrow", "→");
      arrow.setAttribute("aria-hidden", "true");
      item.appendChild(arrow);
      pageList.appendChild(item);
    });
  }

  function renderIntro(story) {
    pageIntro.hidden = false;
    if (pageList) pageList.hidden = true;
    pageIntro.innerHTML = "";
    pageIntro.appendChild(el("p", "naf-px-kicker",
      "Parcours " + story.numero + " · " + story.duree));
    pageIntro.appendChild(el("h2", "naf-px-intro-title", story.titre));
    pageIntro.appendChild(el("p", "naf-px-intro-q", story.question));
    pageIntro.appendChild(el("p", "naf-px-text", story.intro));
    var nav = el("nav", "naf-px-nav");
    var start = el("a", "naf-px-btn", "Commencer →");
    start.href = stepHref(story, 0);
    nav.appendChild(start);
    var back = el("a", "naf-px-btn naf-px-btn-ghost", "← Tous les parcours");
    back.href = "parcours.html";
    nav.appendChild(back);
    pageIntro.appendChild(nav);
  }

  /* ── Démarrage ───────────────────────────────────────────────────── */

  fetchJson("data/parcours.json").then(function (data) {
    if (pageList) {
      var chosen = data.stories.filter(function (s) {
        return s.id === chooserStory;
      })[0];
      if (chosen && pageIntro) renderIntro(chosen);
      else renderList(data);
      return;
    }
    var story = data.stories.filter(function (s) {
      return s.id === storyId;
    })[0];
    if (!story) return;
    var index = Math.min(Math.max(stepNum, 1), story.steps.length) - 1;
    render(story, index);
  }).catch(function (error) {
    if (pageList) {
      pageList.textContent = "Impossible de charger les parcours (" +
        error.message + ").";
    }
  });
})();
