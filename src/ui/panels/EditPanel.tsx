import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Dragon, DragonSex, ImageCropMode, Project } from '../../data/models'
import { DRAGON_SEXES, IMAGE_CROP_MODES } from '../../data/models'
import { searchDragons } from '../../utils/dragonSearch'
import { normalizeDisplayName } from '../../utils/text'
import './SidePanel.css'
import './EditPanel.css'

type EditPanelProps = {
  project: Project
  selected: Dragon | null
  onSelectDragon: (id: string) => void
  onPatch: (
    patch: Partial<Omit<Dragon, 'id' | 'motherId' | 'fatherId'>>,
  ) => void
}

export function EditPanel({
  project,
  selected,
  onSelectDragon,
  onPatch,
}: EditPanelProps) {
  const searchId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const matches = useMemo(
    () => searchDragons(project, query).slice(0, 12),
    [project, query],
  )

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  function pick(dragon: Dragon) {
    onSelectDragon(dragon.id)
    setQuery('')
    setOpen(false)
  }

  return (
    <aside className="side-panel" aria-label="Dragon editor">
      <div className="dragon-search" ref={wrapRef}>
        <label className="dragon-search__label" htmlFor={searchId}>
          Search
        </label>
        <input
          id={searchId}
          type="search"
          className="dragon-search__input"
          value={query}
          placeholder="Name or ID"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOpen(false)
              ;(event.target as HTMLInputElement).blur()
              return
            }
            if (event.key === 'Enter' && matches[0]) {
              event.preventDefault()
              pick(matches[0])
            }
          }}
        />
        {open && query.trim() && matches.length > 0 ? (
          <ul className="dragon-search__results" role="listbox">
            {matches.map((dragon) => (
              <li key={dragon.id} role="option">
                <button
                  type="button"
                  className="dragon-search__hit"
                  onClick={() => pick(dragon)}
                >
                  <span className="dragon-search__hit-name">
                    {dragon.name.trim() || 'Unnamed'}
                  </span>
                  <span className="dragon-search__hit-id">
                    {dragon.frId ? `#${dragon.frId}` : 'No ID'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {open && query.trim() && matches.length === 0 ? (
          <p className="dragon-search__empty">No matches</p>
        ) : null}
      </div>

      {!selected ? (
        <>
          <p className="side-panel__kicker">Dragons</p>
          <h2 className="side-panel__title">Nothing selected</h2>
          <p className="side-panel__body">
            Right-click the canvas to create a dragon. Drag from one dragon to
            another to set a link.
          </p>
        </>
      ) : (
        <>
          <p className="side-panel__kicker">Dragon</p>
          <h2 className="side-panel__title">{selected.name || 'Unnamed'}</h2>

          <form className="edit-form" onSubmit={(event) => event.preventDefault()}>
            <label className="edit-form__field">
              <span>Name</span>
              <input
                type="text"
                value={selected.name}
                onChange={(event) => onPatch({ name: event.target.value })}
                onBlur={(event) => {
                  const next = normalizeDisplayName(event.target.value)
                  if (next !== selected.name) onPatch({ name: next })
                }}
              />
            </label>

            <label className="edit-form__field">
              <span>Dragon ID</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="e.g. 22389889"
                value={selected.frId}
                onChange={(event) =>
                  onPatch({ frId: event.target.value.replace(/\D/g, '') })
                }
              />
            </label>

            <label className="edit-form__field">
              <span>Sex</span>
              <select
                value={selected.sex}
                onChange={(event) =>
                  onPatch({ sex: event.target.value as DragonSex })
                }
              >
                {DRAGON_SEXES.map((sex) => (
                  <option key={sex} value={sex}>
                    {sex === 'female' ? 'Female' : 'Male'}
                  </option>
                ))}
              </select>
            </label>

            <label className="edit-form__field">
              <span>Crop</span>
              <select
                value={selected.imageCrop}
                onChange={(event) =>
                  onPatch({ imageCrop: event.target.value as ImageCropMode })
                }
              >
                {IMAGE_CROP_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode === 'full' ? 'Full' : 'Portrait'}
                  </option>
                ))}
              </select>
            </label>

            <label className="edit-form__field">
              <span>Notes</span>
              <textarea
                rows={4}
                value={selected.notes}
                onChange={(event) => onPatch({ notes: event.target.value })}
              />
            </label>
          </form>
        </>
      )}
    </aside>
  )
}
