// phoria2 - small, friendly 3D for the web. See API-DESIGN.md for the design this implements.

export * from './types.js'

// canvas to running scene
export { View } from './View.js'
export { WebGLRenderer } from './webgl/WebGLRenderer.js'
export { OrbitControl } from './OrbitControl.js'

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
export { Raycaster } from './Raycaster.js'
export { collect, NullRenderer, LIGHT_LIMITS } from './frame.js'
export { PhoriaError } from './validate.js'
