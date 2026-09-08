// Pure theme-preference helpers for the System/Light/Dark setting. Kept free
// of React/DOM so they can be unit-tested with node:test (see
// test/theme.test.js); the matchMedia wiring lives in App.jsx.
//
// Preference values are exactly 'system' | 'light' | 'dark':
//   - 'system' resolves at runtime against prefers-color-scheme and follows
//     the OS when it changes
//   - 'light' / 'dark' pin the theme regardless of the OS

// Unknown/blank legacy values resolve to 'system' — following the OS is the
// sane default when we cannot tell what the user meant.
export function normalizeThemePreference(value) {
  if (value === 'light' || value === 'dark') return value;
  return 'system';
}

// Maps a preference plus the OS dark-mode flag to the concrete theme applied
// to <html data-theme="...">. systemDark is only consulted for 'system'.
export function resolveTheme(preference, systemDark = false) {
  const pref = normalizeThemePreference(preference);
  if (pref !== 'system') return pref;
  return systemDark ? 'dark' : 'light';
}
