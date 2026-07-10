import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist', 'node_modules', 'server/node_modules', 'server/*.db*']),
  {
    files: ['src/**/*.{js,jsx}', 'vite.config.js'],
    extends: [js.configs.recommended, reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^(motion|[A-Z_])', argsIgnorePattern: '^_' }],
      // Game-event callbacks intentionally update React state; these are not render-time synchronization effects.
      'react-hooks/set-state-in-effect': 'off',
      // Randomness is isolated to user-triggered AI move callbacks, not component rendering.
      'react-hooks/purity': 'off',
    },
  },
  {
    files: ['server/**/*.js'],
    ignores: ['server/test/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 'latest', globals: globals.node, sourceType: 'commonjs' },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
  {
    files: ['server/test/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 'latest', globals: globals.node, sourceType: 'commonjs' },
  },
]);
