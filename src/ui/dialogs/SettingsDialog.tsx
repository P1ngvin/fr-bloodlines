import { useEffect, useId, useRef } from 'react'
import type { ViewSettings } from '../../state/viewSettingsStore'
import './SettingsDialog.css'

type SettingsDialogProps = {
  open: boolean
  settings: ViewSettings
  onChange: (patch: Partial<ViewSettings>) => void
  onClose: () => void
}

function GenerationField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number | null
  onChange: (value: number | null) => void
}) {
  const unlimited = value === null

  return (
    <label className="settings-dialog__field">
      <span>{label}</span>
      <div className="settings-dialog__row">
        <input
          type="number"
          min={0}
          step={1}
          disabled={unlimited}
          value={unlimited ? '' : value}
          onChange={(event) => {
            const raw = event.target.value
            if (raw === '') {
              onChange(0)
              return
            }
            const n = Number(raw)
            if (!Number.isFinite(n)) return
            onChange(Math.max(0, Math.floor(n)))
          }}
        />
        <label className="settings-dialog__check">
          <input
            type="checkbox"
            checked={unlimited}
            onChange={(event) => {
              onChange(event.target.checked ? null : 3)
            }}
          />
          All
        </label>
      </div>
    </label>
  )
}

export function SettingsDialog({
  open,
  settings,
  onChange,
  onClose,
}: SettingsDialogProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="settings-dialog"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className="settings-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="settings-dialog__header">
          <h2 id={titleId}>Settings</h2>
          <button type="button" className="settings-dialog__close" onClick={onClose}>
            Close
          </button>
        </div>

        <GenerationField
          label="Ancestor generations"
          value={settings.ancestorGenerations}
          onChange={(ancestorGenerations) => onChange({ ancestorGenerations })}
        />
        <GenerationField
          label="Descendant generations"
          value={settings.descendantGenerations}
          onChange={(descendantGenerations) => onChange({ descendantGenerations })}
        />
      </div>
    </div>
  )
}
