'use strict';

// Mirrors the official DeepSeek Harness desktop shell: the native window
// fallback color follows the resolved scheme while the Windows title-bar
// overlay itself stays transparent, so the renderer's Aqua background flows
// continuously behind the caption buttons.
const THEME_BACKGROUNDS = Object.freeze({
  light: '#ffffff',
  dark: '#151517'
});

const TITLE_BAR_SYMBOL_COLORS = Object.freeze({
  light: '#0f1115',
  dark: '#f5f6f7'
});

const TITLE_BAR_OVERLAY_COLOR = 'rgba(0, 0, 0, 0)';

function getWindowTheme(theme) {
  const resolvedTheme = theme === 'light' ? 'light' : 'dark';
  return {
    backgroundColor: THEME_BACKGROUNDS[resolvedTheme],
    titleBarOverlay: {
      color: TITLE_BAR_OVERLAY_COLOR,
      symbolColor: TITLE_BAR_SYMBOL_COLORS[resolvedTheme]
    }
  };
}

module.exports = {
  THEME_BACKGROUNDS,
  TITLE_BAR_OVERLAY_COLOR,
  TITLE_BAR_SYMBOL_COLORS,
  getWindowTheme
};
