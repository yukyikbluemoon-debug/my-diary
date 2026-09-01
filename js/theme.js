/* theme.js — theme + reading font size, applied via data-* attributes on
   <html> so CSS custom properties can swap per theme. Applied as early as
   possible (see the inline snippet in index.html <head>) to avoid a flash
   of the wrong theme on load. */

const ThemeSettings = (() => {
  const THEME_KEY = "diary_theme";
  const SIZE_KEY = "diary_font_size";
  const THEMES = ["lamp", "forest", "orchid", "paper"];
  const SIZES = ["small", "medium", "large"];

  function apply() {
    document.documentElement.setAttribute("data-theme", getTheme());
    document.documentElement.setAttribute("data-fontsize", getFontSize());
  }
  function setTheme(theme) {
    if (!THEMES.includes(theme)) return;
    localStorage.setItem(THEME_KEY, theme);
    apply();
  }
  function setFontSize(size) {
    if (!SIZES.includes(size)) return;
    localStorage.setItem(SIZE_KEY, size);
    apply();
  }
  function getTheme() { return localStorage.getItem(THEME_KEY) || "lamp"; }
  function getFontSize() { return localStorage.getItem(SIZE_KEY) || "medium"; }

  return { apply, setTheme, setFontSize, getTheme, getFontSize, THEMES, SIZES };
})();
