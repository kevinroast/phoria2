import { useEffect, useRef } from 'react'
import { View } from 'phoria2'
import { chart } from 'phoria2/charts'

// A chart that follows its data: made once with the first rows, then chart.update() on each new
// set - the bars animate to their new heights rather than being rebuilt.
export function SalesChart({ rows }) {
  const canvas = useRef(null)
  const sales = useRef(null)

  useEffect(() => {
    const view = new View({ canvas: canvas.current, orbit: true, camera: 'front', framing: 'both' })
    sales.current = view.scene.add(chart({ mark: 'bar', data: rows, x: 'month', y: 'sales', color: 'month', tooltip: true }))
    return () => view.dispose()
    // made once; new rows arrive through the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    sales.current.update(rows)
  }, [rows])

  return <canvas ref={canvas} style={{ width: '100%', height: 320, display: 'block', borderRadius: 8, background: '#1c1c20' }} />
}
