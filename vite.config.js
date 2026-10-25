import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const root = import.meta.dirname

// The package entry points: 'phoria2' (the core), 'phoria2/particles' and 'phoria2/charts'. The library
// build emits one ES module per entry (dist/phoria2.js, dist/particles.js, dist/charts.js).
const ENTRIES = {
  phoria2: 'src/index.js',
  particles: 'src/particles/index.js',
  charts: 'src/charts/index.js',
}

// Default build is the library. `--mode demos` builds the demo gallery as a static site instead.
// In dev, demos import 'phoria2' and its sub-paths straight from src/.
export default defineConfig(({ mode }) => ({
  // relative base so the demo site works from any folder on a static host
  base: mode === 'demos' ? './' : '/',
  resolve: {
    alias: [
      { find: /^phoria2$/, replacement: resolve(root, ENTRIES.phoria2) },
      { find: /^phoria2\/particles$/, replacement: resolve(root, ENTRIES.particles) },
      { find: /^phoria2\/charts$/, replacement: resolve(root, ENTRIES.charts) },
    ],
  },
  build: mode === 'demos'
    ? {
        outDir: 'dist-demos',
        rollupOptions: {
          input: {
            index: resolve(root, 'index.html'),
            demo: resolve(root, 'demo.html'),
          },
        },
      }
    : {
        lib: {
          entry: Object.fromEntries(Object.entries(ENTRIES).map(([name, file]) => [name, resolve(root, file)])),
          formats: ['es'],
          fileName: (format, name) => `${name}.js`,
        },
        sourcemap: true,
        copyPublicDir: false,
        rollupOptions: {
          output: {
            // everything the sub-paths share with the core goes in one predictable chunk; modules the
            // View loads on demand (explain, toImage, the tooltip) keep chunks of their own
            manualChunks: (id) => (/[\\/]src[\\/](?!particles|charts|explain|snapshot|tooltip)/.test(id) ? 'core' : undefined),
            chunkFileNames: '[name].js',
          },
        },
      },
  test: {
    include: ['test/**/*.test.js'],
  },
}))
