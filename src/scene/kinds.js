// What a drawable is, asked in one place. Nodes are told apart by markers - drawMode, and
// instanceMatrices for an InstancedMesh - rather than instanceof, which would make every module that
// asks import every class (bundle size). A new kind of drawable (a batched mesh) answers here, once,
// rather than at every place that asks.

/**
 * Is it an InstancedMesh - many copies of one geometry, each with its own matrix (and colour, label,
 * datum)?
 * @param {any} node
 * @returns {boolean}
 */
export const isInstanced = (node) => 'instanceMatrices' in node

/**
 * The kind of program that draws it: 'mesh' (triangles, instanced or not), 'points' or 'lines'.
 * @param {any} node
 * @returns {'mesh' | 'points' | 'lines'}
 */
export const drawKind = (node) => (node.drawMode === 'points' ? 'points' : node.drawMode === 'lines' ? 'lines' : 'mesh')
