// Set the theme before styles paint so system-light users never see a dark
// flash on first load. Kept as a static file so it satisfies script-src 'self'.
(function () {
  try {
    var raw = localStorage.getItem('noughtline_config') || localStorage.getItem('plaything_config');
    var preference = raw ? JSON.parse(raw).theme : 'system';
    var dark = preference === 'dark'
      || (preference !== 'light'
        && window.matchMedia
        && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch (error) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
