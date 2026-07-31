import './SidePanel.css'

export function ExportPanel() {
  return (
    <aside className="side-panel" aria-label="Export">
      <p className="side-panel__kicker">Export</p>
      <h2 className="side-panel__title">BBCode</h2>
      <p className="side-panel__body">
        Pick a root dragon and generation depth. These choices stay in this
        session only - they never change your project file.
      </p>
    </aside>
  )
}
