import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const root = import.meta.dirname

// Default build is the library (dist/phoria2.js). `--mode demos` builds the demo
// gallery as a static site instead. In dev, demos import 'phoria2' straight from src/.
export default defineConfig(({ mode }) => ({
  // relative base so the demo site works from any folder on a static host
  base: mode === 'demos' ? './' : '/',
  resolve: {
    alias: { phoria2: resolve(root, 'src/index.js') },
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
          entry: resolve(root, 'src/index.js'),
          formats: ['es'],
          fileName: 'phoria2',
        },
        sourcemap: true,
        copyPublicDir: false,
        rollupOptions: { external: ['gl-matrix'] },
      },
  test: {
    include: ['test/**/*.test.js'],
  },
}))
