import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeThemePreference,
  resolveTheme,
} from '../src/services/theme.js';

test('normalizeThemePreference accepts the three canonical values', () => {
  assert.equal(normalizeThemePreference('system'), 'system');
  assert.equal(normalizeThemePreference('light'), 'light');
  assert.equal(normalizeThemePreference('dark'), 'dark');
});

test('normalizeThemePreference defaults unknown/legacy values to system', () => {
  assert.equal(normalizeThemePreference(undefined), 'system');
  assert.equal(normalizeThemePreference(null), 'system');
  assert.equal(normalizeThemePreference(''), 'system');
  assert.equal(normalizeThemePreference('blue'), 'system');
  assert.equal(normalizeThemePreference(42), 'system');
});

test('resolveTheme honors explicit light/dark pins regardless of OS', () => {
  assert.equal(resolveTheme('light', true), 'light'); // OS dark, pinned light
  assert.equal(resolveTheme('light', false), 'light');
  assert.equal(resolveTheme('dark', true), 'dark');
  assert.equal(resolveTheme('dark', false), 'dark');
});

test('resolveTheme follows the OS when preference is system', () => {
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
});

test('resolveTheme falls back safely on malformed input', () => {
  // normalize defaults to system; without a systemDark signal we choose light.
  assert.equal(resolveTheme(undefined, false), 'light');
  assert.equal(resolveTheme(null, true), 'dark');
});
