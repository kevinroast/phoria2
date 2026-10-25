import { DirectionalLight, Group, Lines, Mesh, View, grid, loadTexture, plane } from 'phoria2'

// A cube with a different texture on each face, built from six textured planes in a group (a
// material has one map, so each face gets its own). Space reverses the texture order.
export default async function run({ canvas, gui }) {
  const textures = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => loadTexture(`images/texture${i}.png`)))

  const view = new View({ canvas, orbit: true, background: '#eeeeee', camera: { position: [0, 4, 8], target: [0, 1, 0] } })
  view.scene.add(new Lines({ geometry: grid({ size: 20, divisions: 8 }), material: { color: '#aaaaaa' } }))
  view.scene.add(new DirectionalLight({ direction: [0, -0.5, -1], intensity: 1.5 }))

  // plane() faces +y; each rotation turns it to face outwards from one side of the cube
  const H = Math.PI / 2
  const sides = [
    { position: [0, 0, 1], rotation: [H, 0, 0] },
    { position: [1, 0, 0], rotation: [0, 0, -H] },
    { position: [0, 0, -1], rotation: [-H, Math.PI, 0] },
    { position: [-1, 0, 0], rotation: [0, 0, H] },
    { position: [0, 1, 0], rotation: [0, 0, 0] },
    { position: [0, -1, 0], rotation: [Math.PI, 0, 0] },
  ]
  const geometry = plane(2)
  const cube = view.scene.add(new Group({ position: [0, 1, 0] }))
  const faces = sides.map((side, i) => cube.add(new Mesh({ geometry, material: { map: textures[i], roughness: 0.7 }, ...side })))

  let reversed = false
  const reverse = () => {
    reversed = !reversed
    faces.forEach((face, i) => { face.material.map = textures[reversed ? 5 - i : i] })
  }
  document.addEventListener('keydown', (e) => { if (e.code === 'Space') reverse() })
  gui.add({ reverse }, 'reverse')

  return view.start((dt) => cube.rotateY(0.5 * dt))
}
