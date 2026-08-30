/**
 * naf-comprendre.js
 * Confort de lecture de la page Comprendre.
 *
 * Rien ici n'est porteur d'information : la page reste entièrement lisible
 * sans JavaScript (navigation par ancres natives, accordéons <details>).
 * Ce script ajoute seulement :
 *   - le suivi de section dans la navigation interne collante ;
 *   - l'ouverture automatique d'un accordéon ciblé par l'URL (#etude-01).
 */
(function () {
  "use strict";

  var nav = document.getElementById("naf-comp-nav");
  if (!nav) return;

  var links = Array.prototype.slice.call(
    nav.querySelectorAll(".naf-comp-nav-link"));
  // Quarto réécrit les liens « #ancre » en URL absolues : lire link.hash,
  // qui reste le fragment quel que soit le préfixe.
  var sections = links
    .map(function (link) {
      return document.getElementById((link.hash || "").replace("#", ""));
    })
    .filter(Boolean);

  function setCurrent(id) {
    links.forEach(function (link) {
      var isCurrent = (link.hash || "") === "#" + id;
      if (isCurrent) {
        link.setAttribute("aria-current", "true");
        // Garder la pilule active visible quand la barre défile (mobile).
        if (link.scrollIntoView) {
          link.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  if ("IntersectionObserver" in window && sections.length) {
    var visible = new Map();
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        visible.set(entry.target.id, entry.isIntersecting);
      });
      var current = sections.filter(function (section) {
        return visible.get(section.id);
      })[0];
      if (current) setCurrent(current.id);
    }, { rootMargin: "-15% 0px -65% 0px" });
    sections.forEach(function (section) { observer.observe(section); });
  }

  function openTargetDetails() {
    var hash = window.location.hash.replace("#", "");
    if (!hash) return;
    var target = document.getElementById(hash);
    if (!target) return;
    var details = target.closest("details") ||
      (target.tagName === "DETAILS" ? target : target.querySelector("details"));
    if (details && details.classList.contains("naf-carnet-item")) {
      details.open = true;
    }
  }

  window.addEventListener("hashchange", openTargetDetails);
  openTargetDetails();
})();
