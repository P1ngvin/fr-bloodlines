import type { CSSProperties, MouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { Dragon } from '../../data/models'
import { getDragonRenderUrl } from '../../utils/frRender'
import './DragonNode.css'

type DragonNodeProps = {
  dragon: Dragon
  selected: boolean
  focused?: boolean
  style?: CSSProperties
  onSelect: () => void
  onContextMenu: (event: MouseEvent) => void
  /** When set, parent owns press/drag; click select is skipped. */
  onNodePointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void
}

export function DragonNode({
  dragon,
  selected,
  focused = false,
  style,
  onSelect,
  onContextMenu,
  onNodePointerDown,
}: DragonNodeProps) {
  const imageUrl = getDragonRenderUrl(dragon.frId, dragon.imageCrop)
  const className = [
    'dragon-node',
    selected ? 'dragon-node--selected' : '',
    focused ? 'dragon-node--focused' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type="button"
      className={className}
      style={style}
      data-dragon-id={dragon.id}
      title={dragon.frId ? `FR #${dragon.frId}` : dragon.name}
      onPointerDown={onNodePointerDown}
      onClick={(event) => {
        event.stopPropagation()
        if (onNodePointerDown) return
        onSelect()
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onSelect()
        onContextMenu(event)
      }}
    >
      <span className="dragon-node__portrait" aria-hidden="true">
        {imageUrl ? (
          <img src={imageUrl} alt="" draggable={false} />
        ) : (
          <span className="dragon-node__placeholder" />
        )}
      </span>
      <span className="dragon-node__name">{dragon.name}</span>
    </button>
  )
}
