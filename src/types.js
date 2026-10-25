// Shared JSDoc types for phoria2. No runtime code - the types appear in the generated .d.ts files
// and are re-exported from the package root (import type { Style } from 'phoria2').

/** A position or direction as an object literal. @typedef {{ x: number, y: number, z: number }} XYZ */

/** @typedef {Float32Array | number[]} Vec2Like */
/** @typedef {Float32Array | number[]} Vec3Like */
/** @typedef {Float32Array | number[]} Vec4Like */

/** A colour as [r, g, b]. Materials use 0-255, lights use 0-1. @typedef {number[]} RGB */

/** A wireframe edge between two vertex indices. @typedef {{ a: number, b: number, _avz?: number }} Edge */

/**
 * A polygon: at least three vertex indices, plus optional per-polygon overrides.
 * @typedef {object} Polygon
 * @property {number[]} vertices indices into the entity's points
 * @property {RGB} [color] overrides the style colour, 0-255
 * @property {number} [texture] index into the entity's textures
 * @property {number[]} [uvs] texture coordinates, a u,v pair per vertex
 * @property {number} [emit] overrides the style emission
 * @property {number} [opacity] overrides the style opacity
 * @property {Float32Array} [normal] face normal, set by Entity.generatePolygonNormals()
 * @property {Float32Array} [_worldnormal] world space normal, set each frame
 * @property {number} [_avz] average depth, set when sorting
 */

/**
 * Geometry as returned by the generate* functions and loaders - spread it into Entity.create().
 * @typedef {object} Geometry
 * @property {XYZ[]} points
 * @property {Edge[]} [edges]
 * @property {Polygon[]} polygons
 */

/** @typedef {'point' | 'wireframe' | 'solid'} DrawMode */
/** @typedef {'plain' | 'lightsource' | 'sprite' | 'callback'} ShadeMode */
/** @typedef {'fill' | 'filltwice' | 'inflate' | 'fillstroke' | 'hiddenline'} FillMode */
/** @typedef {'sorted' | 'front' | 'back'} ObjectSortMode */
/** @typedef {'sorted' | 'automatic' | 'none'} GeometrySortMode */

/**
 * How an entity is drawn. Every property is optional in a description; Entity.createStyle()
 * fills in the defaults.
 * @typedef {object} Style
 * @property {RGB} [color] surface colour 0-255 (default [128,128,128])
 * @property {number} [diffuse] material diffusion, generally 0-1 (default 1)
 * @property {number} [specular] specular power if non-zero, e.g. 16 or 64 (default 0)
 * @property {number} [emit] emission (glow) 0-1
 * @property {number} [opacity] 0-1 (default 1)
 * @property {DrawMode} [drawmode] (default 'solid')
 * @property {ShadeMode} [shademode] 'sprite' and 'callback' apply to points (default 'lightsource')
 * @property {FillMode} [fillmode] (default 'inflate')
 * @property {ObjectSortMode} [objectsortmode] coarse object depth sort (default 'sorted')
 * @property {GeometrySortMode} [geometrysortmode] point/edge/polygon sort (default 'automatic')
 * @property {number} [linewidth] line width or point size (default 1)
 * @property {number} [linescale] depth based line scaling, zero for none (default 0)
 * @property {boolean} [doublesided] skip the hidden surface test (default false)
 * @property {number} [texture] default texture index for polygons without one
 * @property {number} [sprite] texture index for shademode 'sprite'
 * @property {GlobalCompositeOperation} [compositeOperation] canvas composite operation
 */

/**
 * Handler called each frame before an entity's matrix is combined with its parent's.
 * `this` is the entity.
 * @typedef {(this: any, scene: import('./scene.js').Scene, time: number) => void} BeforeSceneHandler
 */

/**
 * Handler called each frame after an entity's matrix is combined with its parent's.
 * `this` is the entity.
 * @typedef {(this: any, scene: import('./scene.js').Scene, matLocal: Float32Array, time: number) => void} SceneHandler
 */

/**
 * Object literal description for BaseEntity.create() and its subclasses.
 * @typedef {object} BaseEntityDescription
 * @property {string} [id] lets scene.findEntity() find it
 * @property {Float32Array} [matrix] initial model matrix
 * @property {import('./entity/BaseEntity.js').BaseEntity[]} [children]
 * @property {BeforeSceneHandler | BeforeSceneHandler[]} [onBeforeScene]
 * @property {SceneHandler | SceneHandler[]} [onScene]
 * @property {boolean} [disabled] skip it and its children
 */

/**
 * Object literal description for Entity.create().
 * @typedef {BaseEntityDescription & {
 *   points?: XYZ[],
 *   edges?: Edge[],
 *   polygons?: Polygon[],
 *   style?: Style,
 *   onRender?: RenderHandler | RenderHandler[],
 * }} EntityDescription
 */

/**
 * Custom point renderer for shademode 'callback'. `this` is the entity.
 * @typedef {(this: any, ctx: CanvasRenderingContext2D, x: number, y: number, w: number) => void} RenderHandler
 */

/**
 * A frame trigger: return true when finished to remove it. `this` is the scene.
 * @typedef {{ trigger: (this: import('./scene.js').Scene, position: Float32Array, lookat: Float32Array, up: Float32Array) => boolean | void }} Trigger
 */

export {}
