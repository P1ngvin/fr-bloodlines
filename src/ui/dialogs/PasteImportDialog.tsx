import { useEffect, useId, useRef, useState } from 'react'
import './PasteImportDialog.css'

type PasteImportDialogProps = {
  open: boolean
  busy?: boolean
  error: string | null
  onClose: () => void
  onImport: (text: string) => void
}

export function PasteImportDialog({
  open,
  busy = false,
  error,
  onClose,
  onImport,
}: PasteImportDialogProps) {
  const titleId = useId()
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState('')

  useEffect(() => {
    if (!open) return
    setText('')
    const id = window.setTimeout(() => areaRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [open])

  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onClose()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, busy, onClose])

  if (!open) return null

  return (
    <div
      className="paste-import-dialog"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div
        className="paste-import-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="paste-import-dialog__header">
          <h2 id={titleId}>Paste dragon text</h2>
          <button
            type="button"
            className="paste-import-dialog__close"
            disabled={busy}
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <p className="paste-import-dialog__lead">
          Copy a dragon profile from Flight Rising and paste it below. Needs a
          header like Name (#12345678).
        </p>

        <label className="paste-import-dialog__field">
          <span>Profile text</span>
          <textarea
            ref={areaRef}
            value={text}
            disabled={busy}
            rows={14}
            spellCheck={false}
            placeholder={'Jotham (#22389889)\nLevel 12 Skydancer\n...'}
            onChange={(event) => setText(event.target.value)}
          />
        </label>

        {error ? (
          <p className="paste-import-dialog__error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="paste-import-dialog__actions">
          <button
            type="button"
            className="paste-import-dialog__secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="paste-import-dialog__primary"
            disabled={busy || text.trim().length === 0}
            onClick={() => onImport(text)}
          >
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  )
}
