import { View, Mesh, cylinder } from 'phoria2'
import { loadGLTF } from 'phoria2/gltf'

const view = new View({ canvas: '#scene', background: '#2a2a30', orbit: true })
view.scene.environment = 'studio'

// a round white plinth, 40cm across - phoria2's units are metres
const plinth = view.scene.add(new Mesh({
  geometry: cylinder({ radius: 0.2, height: 0.02, segments: 64 }), position: [0, -0.01, 0],
  material: { color: '#e8e6e2', roughness: 0.6 },
}))

// Khronos's sunglasses - Draco geometry and WebP textures, decoded as they load
const sunglasses = await loadGLTF('https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/e124e8d8d7330a5372bc2b4d00d39a4a9d7997ea/Models/SunglassesKhronos/glTF-Draco/SunglassesKhronos.gltf')
sunglasses.position.set(-0.03, 0, 0.07)
view.scene.add(sunglasses)
view.frame(plinth)

view.start()
