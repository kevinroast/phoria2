import { View, Mesh, DirectionalLight, cylinder, sphere } from 'phoria2'
import { loadGLTF } from 'phoria2/gltf'

const view = new View({ canvas: '#scene', background: '#2a2a30', orbit: true })
view.scene.environment = 'studio'
view.scene.environmentIntensity = 0.6

view.scene.add(new DirectionalLight({ direction: [-0.4, -1, 0.5], intensity: 1.5, castShadow: true, shadowSoftness: 0.3 }))

const plinth = view.scene.add(new Mesh({
  geometry: cylinder({ radius: 0.2, height: 0.02, segments: 64 }), position: [0, -0.01, 0],
  material: { color: '#e8e6e2', roughness: 0.6 }, receiveShadow: true,
}))

const sunglasses = await loadGLTF('https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/e124e8d8d7330a5372bc2b4d00d39a4a9d7997ea/Models/SunglassesKhronos/glTF-Draco/SunglassesKhronos.gltf')
sunglasses.position.set(-0.03, 0, 0.07)
for (const mesh of sunglasses.meshes) mesh.castShadow = true
view.scene.add(sunglasses)

// a solid glass ball: light passes through it and bends over its thickness - the whole 7cm here
view.scene.add(new Mesh({
  geometry: sphere({ radius: 0.035, segments: 64, rings: 32 }), position: [0.11, 0.035, 0.05], castShadow: true,
  material: { transmission: 1, thickness: 0.07, ior: 1.5, roughness: 0 },
}))
view.frame(plinth)

view.start()
