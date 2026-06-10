// Applies the saved theme before first paint to avoid a light/dark flash.
// Kept as an external file (not inline) so it complies with the strict
// Content-Security-Policy (script-src 'self') the server sets in production.
(function () {
  try {
    var t = localStorage.getItem("noto-theme") === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", t);
    document.documentElement.style.colorScheme = t;
  } catch (e) {}
})();
