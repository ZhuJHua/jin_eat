// @ts-check
import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

export default defineConfig(
  { ignores: ['dist', 'coverage', 'node_modules'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // App source (browser).
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      // The rules below come from the React Compiler lint set. This project does not use the compiler,
      // and they flag idiomatic react-three-fiber / imperative code rather than bugs:
      // three.js objects (materials, uniforms, scene.fog, …) are mutated in place inside useFrame/effects by design.
      'react-hooks/immutability': 'off',
      // "Latest value" refs (ref.current = prop during render) and usePrevious are deliberate, render-safe patterns here.
      'react-hooks/refs': 'off',
      // Phase-driven resets (setState when the ritual phase changes) are intentional; React batches them.
      'react-hooks/set-state-in-effect': 'off',
      // useMemo(factory, deps) with a named factory, and spread deps in the texture helper, are fine without the compiler.
      'react-hooks/use-memo': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // These modules deliberately keep module-level scene state and helpers next to their component
  // (bootApp, glow slots, the tube hit-test, shared materials). Editing them costs a full reload in dev
  // instead of a hot update, which is acceptable.
  {
    files: ['src/App.tsx', 'src/three/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },

  // Hand-written service worker (plain JS, served as-is from public/).
  {
    files: ['public/sw.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.serviceworker, ...globals.browser },
    },
  },

  // Node-side config files.
  {
    files: ['*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },

  // Must stay last: turns off stylistic rules that would fight Prettier.
  prettier,
);
