// phoria2 - small, friendly 3D for the web.

export * from './types.js'

// canvas to running scene
export { View } from './View.js'
export { WebGLRenderer } from './webgl/WebGLRenderer.js'
export { OrbitControl } from './OrbitControl.js'
export { cameraPreset, CAMERA_PRESETS } from './presets.js'

// scene graph
export { Node, Group } from './scene/Node.js'
export { Scene } from './scene/Scene.js'
export { Drawable, Mesh, InstancedMesh, Points, Lines, Label } from './scene/drawables.js'
export { Camera, PerspectiveCamera, OrthographicCamera } from './scene/cameras.js'
export { Light, AmbientLight, HemisphereLight, DirectionalLight, PointLight, SpotLight } from './scene/lights.js'

// geometry, materials, textures
export { Geometry } from './geometry/Geometry.js'
export { box, sphere, plane, cylinder, torus, icosphere, edges, axes, grid } from './geometry/generators.js'
export { fromPolygons } from './geometry/fromPolygons.js'
export { Material } from './material/Material.js'
export { Texture, loadTexture } from './material/Texture.js'

// values and maths
export { Vec3 } from './value/Vec3.js'
export { Quat } from './value/Quat.js'
export { Euler } from './value/Euler.js'
export { Mat4 } from './value/Mat4.js'
export { Box3 } from './value/Box3.js'
export { Ray } from './value/Ray.js'
export { Color } from './value/Color.js'
export { vec2, vec3, vec4, mat3, mat4, quat, RADIANS, EPSILON } from './math.js'

// descriptions, picking, frames
export { create } from './describe.js'
export { registerType } from './registry.js'
export { Raycaster } from './Raycaster.js'
export { collect, NullRenderer, LIGHT_LIMITS } from './frame.js'
export { PhoriaError } from './validate.js'

/** @typedef {import('./View.js').ViewOptions} ViewOptions */
/** @typedef {import('./View.js').ViewEvent} ViewEvent */
/** @typedef {import('./View.js').ViewHandler} ViewHandler */
/** @typedef {import('./View.js').RenderMode} RenderMode */
/** @typedef {import('./presets.js').CameraPreset} CameraPreset */
/** @typedef {import('./tooltip.js').TooltipContent} TooltipContent */
/** @typedef {import('./Raycaster.js').Hit} Hit */
/** @typedef {import('./scene/drawables.js').LabelPlacement} LabelPlacement */
/** @typedef {import('./scene/drawables.js').InstanceLabels} InstanceLabels */
/** @typedef {import('./snapshot.js').ImageOptions} ImageOptions */
