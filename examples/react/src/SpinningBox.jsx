import { useEffect, useRef } from 'react'
import { View, Mesh, box, DirectionalLight } from 'phoria2'

// The whole pattern: React owns the canvas element, phoria2 owns what is drawn on it.
//  1. make the View once, when the component mounts, and dispose of it when it unmounts
//  2. keep the nodes you will change in refs
//  3. when props change, change those nodes in place - the scene is never rebuilt
export function SpinningBox({ color, speed }) {
  const canvas = useRef(null)
  const mesh = useRef(null)
  const spin = useRef(speed)

  useEffect(() => {
    const view = new View({ canvas: canvas.current, orbit: true, background: '#1c1c20' })
    view.scene.add(new DirectionalLight({ direction: [-1, -2, -1] }))
    mesh.current = view.scene.add(new Mesh({ geometry: box(2) }))
    // the loop reads the latest speed from a ref, so a new speed doesn't restart anything
    view.start((dt) => mesh.current.rotateY(spin.current * dt))
    // runs on unmount - and in development, React's StrictMode mounts twice to check this works
    return () => view.dispose()
  }, [])

  // after the view is made (effects run in order), and whenever the prop changes
  useEffect(() => {
    mesh.current.material.color.set(color)
  }, [color])

  useEffect(() => {
    spin.current = speed
  }, [speed])

  // the canvas takes its size from CSS; the View follows it
  return <canvas ref={canvas} style={{ width: '100%', height: 320, display: 'block', borderRadius: 8 }} />
}
