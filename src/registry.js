// Node types added from outside the core (a chart from phoria2/charts), so create() can build their
// descriptions. Kept apart from describe.js so registering a type doesn't pull in every node class.

/** @type {Map<string, new (options: any) => any>} */
const types = new Map()

/**
 * Let create() build descriptions of this node class, by its static `type`. Sub-path modules
 * (phoria2/charts) register theirs when imported. A class with options of its own adds them to its
 * parent's, so the node options still work:
 *
 *     class Beacon extends Group {
 *       static type = 'beacon'
 *       static get OPTIONS() { return [...super.OPTIONS, 'blink'] }
 *     }
 *     registerType(Beacon)
 * @param {(new (options: any) => any) & { type: string }} Class
 */
export function registerType(Class) {
  types.set(Class.type, Class)
}

/** @internal */
export function registeredTypes() {
  return types
}
