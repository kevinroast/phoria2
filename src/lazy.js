// Code loaded the first time it's wanted - the renderer's extra passes, bloom, picking, debug
// drawing, the tooltip - so apps that never use it don't carry it. One loader for all of them, so
// each loads once, and one that can't load (offline, a deploy that removed the old chunk, a content
// security policy) says so instead of leaving its feature silently missing.
import { warnOnce } from './validate.js'

// after a failure, how long before the next want tries again - not every frame
const RETRY_MS = 5000

/**
 * A loader for a chunk of code: call it with what to do with the module once loaded. The import
 * starts on the first call; later calls while it loads, or once it has, do nothing. When it fails,
 * a warning names the feature, and a call a few seconds later tries again.
 * @template T
 * @param {string} feature what the code is for, for the warning
 * @param {() => Promise<T>} importer the dynamic import
 * @returns {(then: (module: T) => void) => void}
 */
export function lazy(feature, importer) {
  const state = { loading: false, loaded: false, failedAt: -Infinity }
  return (then) => {
    if (state.loading || state.loaded || performance.now() - state.failedAt < RETRY_MS) return
    state.loading = true
    importer().then((module) => {
      state.loading = false
      state.loaded = true
      then(module)
    }, (error) => {
      state.loading = false
      state.failedAt = performance.now()
      warnOnce(state, `${feature}: its code couldn't be loaded (${error?.message ?? error}) - left out for now, and tried again when next wanted`)
    })
  }
}
