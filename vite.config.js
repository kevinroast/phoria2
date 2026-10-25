import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const root = import.meta.dirname

// The package entry points: 'phoria2' (the core), 'phoria2/particles', 'phoria2/charts' and 'phoria2/gltf'.
// The library build emits one ES module per entry (dist/phoria2.js, dist/particles.js, ...).
const ENTRIES = {
  phoria2: 'src/index.js',
  particles: 'src/particles/index.js',
  charts: 'src/charts/index.js',
  gltf: 'src/gltf/index.js',
}

/**
 * Shaders ship as source text, which the JS minifier leaves alone: strip their comments and
 * indentation in builds (strings tagged \/* glsl *\/). Lines stay lines, for the preprocessor.
 * @returns {import('vite').Plugin}
 */
export function minifyGlsl() {
  return {
    name: 'phoria2-minify-glsl',
    apply: 'build',
    transform(code, id) {
      if (!/[\\/]src[\\/].*\.js$/.test(id) || !code.includes('/* glsl */')) return null
      return code.replace(/\/\* glsl \*\/ `([\s\S]*?)`/g, (_, body) =>
        `/* glsl */ \`${body.split('\n').map((line) => line.replace(/\/\/.*$/, '').trim()).filter(Boolean).join('\n')}\n\``)
    },
  }
}

// Default build is the library. `--mode demos` builds the demo gallery as a static site instead.
// In dev, demos import 'phoria2' and its sub-paths straight from src/.
export default defineConfig(({ mode }) => ({
  // relative base so the demo site works from any folder on a static host
  base: mode === 'demos' ? './' : '/',
  plugins: [minifyGlsl()],
  resolve: {
    alias: [
      { find: /^phoria2$/, replacement: resolve(root, ENTRIES.phoria2) },
      { find: /^phoria2\/particles$/, replacement: resolve(root, ENTRIES.particles) },
      { find: /^phoria2\/charts$/, replacement: resolve(root, ENTRIES.charts) },
      { find: /^phoria2\/gltf$/, replacement: resolve(root, ENTRIES.gltf) },
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
            // everything the sub-paths share with the core goes in one predictable chunk; modules
            // loaded on demand (explain, toImage, the tooltip, the .hdr parser, the renderer's
            // environment and shadow passes, GPU picking) keep chunks of their own
            manualChunks: (id) => (/[\\/]src[\\/](?!particles|charts|gltf|explain|snapshot|tooltip|hdr|irradiance|webgl[\\/](?:passes|picking))/.test(id) ? 'core' : undefined),
            chunkFileNames: '[name].js',
          },
        },
      },
  test: {
    include: ['test/**/*.test.js'],
  },
}))
