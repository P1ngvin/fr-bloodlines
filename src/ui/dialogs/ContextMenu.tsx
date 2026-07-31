import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import './ContextMenu.css'

export type ContextMenuItem =
  | {
      type: 'item'
      id: string
      label: string
      danger?: boolean
      disabled?: boolean
    }
  | { type: 'separator' }

type ContextMenuProps = {
  x: number
  y: number
  items: ContextMenuItem[]
  onSelect: (id: string) => void
  onClose: () => void
}

export function ContextMenu({ x, y, items, onSelect, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const left = Math.min(x, window.innerWidth - rect.width - 8)
    const top = Math.min(y, window.innerHeight - rect.height - 8)
    setPos({ left: Math.max(8, left), top: Math.max(8, top) })
  }, [x, y, items])

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: pos.left, top: pos.top }}
      role="menu"
    >
      {items.map((item, index) => {
        if (item.type === 'separator') {
          return <div key={`sep-${index}`} className="context-menu__sep" />
        }
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={
              item.danger
                ? 'context-menu__item context-menu__item--danger'
                : 'context-menu__item'
            }
            disabled={item.disabled}
            onClick={() => {
              if (!item.disabled) onSelect(item.id)
            }}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
