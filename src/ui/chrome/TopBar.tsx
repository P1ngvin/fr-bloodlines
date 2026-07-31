import { useEffect, useRef } from 'react'
import './TopBar.css'

type TopBarProps = {
  projectName: string
  onOpenSettings: () => void
  menuOpen: boolean
  onMenuToggle: () => void
  onMenuClose: () => void
  onMenuAction: (action: MenuAction) => void
}

export type MenuAction = 'rename' | 'new' | 'open' | 'download'

export function TopBar({
  projectName,
  onOpenSettings,
  menuOpen,
  onMenuToggle,
  onMenuClose,
  onMenuAction,
}: TopBarProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return

    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        onMenuClose()
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onMenuClose()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen, onMenuClose])

  return (
    <header className="top-bar">
      <div className="top-bar__left">
        <span className="top-bar__brand">Bloodlines</span>
        <span className="top-bar__sep" aria-hidden="true" />

        <div className="top-bar__project-wrap" ref={menuRef}>
          <button
            type="button"
            className="top-bar__project"
            title="Project menu"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={onMenuToggle}
          >
            <span className="top-bar__project-name">{projectName}</span>
            <span className="top-bar__project-caret" aria-hidden="true">
              ▾
            </span>
          </button>

          {menuOpen ? (
            <ul className="top-bar__menu" role="menu">
              <li role="none">
                <button type="button" role="menuitem" onClick={() => onMenuAction('rename')}>
                  Rename...
                </button>
              </li>
              <li role="separator" className="top-bar__menu-sep" />
              <li role="none">
                <button type="button" role="menuitem" onClick={() => onMenuAction('new')}>
                  New project...
                </button>
              </li>
              <li role="none">
                <button type="button" role="menuitem" onClick={() => onMenuAction('open')}>
                  Open JSON...
                </button>
              </li>
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => onMenuAction('download')}
                >
                  Save as JSON
                </button>
              </li>
            </ul>
          ) : null}
        </div>
      </div>

      <div className="top-bar__right">
        <button type="button" className="top-bar__action" onClick={onOpenSettings}>
          Settings
        </button>
      </div>
    </header>
  )
}
