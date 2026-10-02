// Set the theme before first paint: the saved choice, else the system setting.
// Kept as a file (not inline in index.html) so the page can forbid inline scripts.
(function () {
  var saved = null;
  try {
    saved = localStorage.getItem('bd-theme');
  } catch (e) {}
  var dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
