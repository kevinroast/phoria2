import js from '@eslint/js'
import globals from 'globals'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // eval/runs holds pages written by agents under test - theirs, not ours
  globalIgnores(['dist', 'dist-demos', 'eval/runs']),
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['vite.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // build and measurement scripts run in Node
    files: ['scripts/**/*.mjs', 'perf/**/*.mjs', 'eval/**/*.mjs', 'claude-plugin/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
])
