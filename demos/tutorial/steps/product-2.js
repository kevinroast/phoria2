import { View, Mesh, DirectionalLight, cylinder } from 'phoria2'
import { loadGLTF } from 'phoria2/gltf'

const view = new View({ canvas: '#scene', background: '#2a2a30', orbit: true })
view.scene.environment = 'studio'
view.scene.environmentIntensity = 0.6

// a key light from behind and to the right, so the shadows fall towards you - soft, as under a
// big studio light
view.scene.add(new DirectionalLight({ direction: [-0.4, -1, 0.5], intensity: 1.5, castShadow: true, shadowSoftness: 0.3 }))

const plinth = view.scene.add(new Mesh({
  geometry: cylinder({ radius: 0.2, height: 0.02, segments: 64 }), position: [0, -0.01, 0],
  material: { color: '#e8e6e2', roughness: 0.6 }, receiveShadow: true,
}))

const sunglasses = await loadGLTF('https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/e124e8d8d7330a5372bc2b4d00d39a4a9d7997ea/Models/SunglassesKhronos/glTF-Draco/SunglassesKhronos.gltf')
sunglasses.position.set(-0.03, 0, 0.07)
for (const mesh of sunglasses.meshes) mesh.castShadow = true
view.scene.add(sunglasses)
view.frame(plinth)

view.start()
