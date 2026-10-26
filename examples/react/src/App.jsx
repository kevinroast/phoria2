import { useState } from 'react'
import { SpinningBox } from './SpinningBox.jsx'
import { SalesChart } from './SalesChart.jsx'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']
const someSales = () => MONTHS.map((month) => ({ month, sales: Math.round(20 + Math.random() * 80) }))

// Ordinary React state drives both scenes through props.
export function App() {
  const [color, setColor] = useState('#ff8c1a')
  const [speed, setSpeed] = useState(0.6)
  const [rows, setRows] = useState(someSales)
  const [shown, setShown] = useState(true)

  return (
    <main>
      <h1>phoria2 with React</h1>

      <section>
        <h2>A component with props</h2>
        <label>colour <input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
        <label>speed <input type="range" min="0" max="3" step="0.1" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} /></label>
        <label><input type="checkbox" checked={shown} onChange={(e) => setShown(e.target.checked)} /> mounted</label>
        {shown && <SpinningBox color={color} speed={speed} />}
      </section>

      <section>
        <h2>A chart that follows its data</h2>
        <button onClick={() => setRows(someSales())}>new data</button>
        <SalesChart rows={rows} />
      </section>
    </main>
  )
}
