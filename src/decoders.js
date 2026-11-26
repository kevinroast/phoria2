// Where the decoders for compressed models and textures come from. Draco geometry and KTX2 (Basis
// Universal) textures need WebAssembly decoders too big to ship with every app, so the first file
// that uses one fetches it - from these folders, a pinned version on a public CDN by default. An app
// that hosts its own copies (offline, or a strict content security policy) points here first.
// meshopt geometry's decoder is small, and comes with phoria2/gltf.
import { checkOptions, describe, fail } from './validate.js'

/**
 * The folders the decoders load from.
 * @typedef {object} DecoderPaths
 * @property {string} [draco] Draco's glTF decoder: draco_wasm_wrapper_gltf.js and
 *   draco_decoder_gltf.wasm (from github.com/google/draco's javascript folder)
 * @property {string} [basis] the Basis Universal transcoder: basis_transcoder.js and
 *   basis_transcoder.wasm (from github.com/BinomialLLC/basis_universal's webgl/transcoder/build)
 */

/** @type {Required<DecoderPaths>} */
const PATHS = {
  draco: 'https://cdn.jsdelivr.net/gh/google/draco@1.5.7/javascript/',
  basis: 'https://cdn.jsdelivr.net/gh/BinomialLLC/basis_universal@1.16.4/webgl/transcoder/build/',
}
/** Each decoder, once loading: its module. @type {Map<string, Promise<any>>} */
const LOADED = new Map()

/**
 * Load the decoders for compressed models and textures from folders of your own, rather than the
 * public CDN they come from by default - for apps that work offline or forbid other origins. Set
 * before the first compressed file loads.
 *
 *     useDecoders({ draco: '/decoders/draco/', basis: '/decoders/basis/' })
 *
 * @param {DecoderPaths} paths
 */
export function useDecoders(paths) {
  checkOptions('useDecoders', paths, ['draco', 'basis'], {
    meshopt: "meshopt's decoder comes with phoria2/gltf - nothing to set",
    ktx2: "use 'basis' - KTX2 textures are transcoded by Basis Universal",
  })
  for (const [name, path] of Object.entries(paths)) {
    if (path === undefined) continue
    if (typeof path !== 'string' || !path) fail('useDecoders', `'${name}' is the folder its decoder loads from, got ${describe(path)}`)
    PATHS[/** @type {keyof DecoderPaths} */ (name)] = path.endsWith('/') ? path : `${path}/`
  }
}

/** @internal The folders, as set. @returns {Required<DecoderPaths>} */
export function decoderPaths() {
  return { ...PATHS }
}

/** Each decoder's files, once fetching: its script's text and its WebAssembly. @type {Map<string, Promise<{ code: string, binary: ArrayBuffer }>>} */
const FETCHED = new Map()

/**
 * @internal One of the decoders' files, fetched once a page: its Emscripten script's text and its
 * WebAssembly - for running here (loadDecoder) or in a worker of its own (Draco's).
 * @param {'draco' | 'basis'} which @param {string} script @param {string} wasm
 * @returns {Promise<{ code: string, binary: ArrayBuffer }>}
 */
export function fetchDecoder(which, script, wasm) {
  const base = PATHS[which]
  const key = `${base}${script}`
  let fetching = FETCHED.get(key)
  if (!fetching) {
    const get = async (/** @type {string} */ file) => {
      const response = await fetch(`${base}${file}`).catch((e) => { throw new Error(`couldn't fetch ${base}${file} - ${e.message}`) })
      if (!response.ok) throw new Error(`couldn't fetch ${base}${file} (${response.status})`)
      return response
    }
    fetching = Promise.all([get(script).then((r) => r.text()), get(wasm).then((r) => r.arrayBuffer())]).then(([code, binary]) => ({ code, binary }))
    // a failure is reported by each file that wanted it, and tried again by the next
    fetching.catch(() => FETCHED.delete(key))
    FETCHED.set(key, fetching)
  }
  return fetching
}

/**
 * @internal One of the decoders, ready here - its Emscripten script run and its WebAssembly compiled,
 * once a page. The scripts aren't modules: each defines a factory under `name`, taken from its text.
 * @param {'draco' | 'basis'} which @param {string} script @param {string} wasm @param {string} name
 * @returns {Promise<any>}
 */
export function loadDecoder(which, script, wasm, name) {
  const key = `${PATHS[which]}${script}`
  let loading = LOADED.get(key)
  if (!loading) {
    loading = (async () => {
      const { code, binary } = await fetchDecoder(which, script, wasm)
      const factory = new Function(`${code}
return ${name}`)()
      // Draco's says when it's ready by a callback; Basis's factory returns a promise of the module
      if (which === 'draco') return new Promise((resolve) => { factory({ wasmBinary: binary, onModuleLoaded: resolve }) })
      const module = await factory({ wasmBinary: binary })
      module.initializeBasis?.()
      return module
    })()
    loading.catch(() => LOADED.delete(key))
    LOADED.set(key, loading)
  }
  return loading
}
