// phoria2/gltf - load glTF 2.0 models (.gltf and .glb): meshes, materials and their maps, textures,
// the node hierarchy, cameras, lights and animations. See API-DESIGN.md section 16.

export { loadGLTF, parseGLTF, Model } from './load.js'
export { Animation } from './Animation.js'

/** @typedef {import('./load.js').GLTFOptions} GLTFOptions */
/** @typedef {import('./Animation.js').Track} Track */
