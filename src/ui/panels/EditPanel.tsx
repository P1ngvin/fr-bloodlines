import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type {
  Dragon,
  DragonElement,
  DragonSex,
  ImageCropMode,
  Project,
} from '../../data/models'
import {
  DRAGON_SEXES,
  FR_ELEMENTS,
  IMAGE_CROP_MODES,
  PRONOUN_PRESETS,
  displayElement,
  isPronounPreset,
  normalizePronouns,
} from '../../data/models'
import { isGenerationOne } from '../../tree'
import { searchDragons } from '../../utils/dragonSearch'
import { getDragonPageUrl } from '../../utils/frRender'
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
  const [pronounsOther, setPronounsOther] = useState(false)
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

  useEffect(() => {
    if (!selected) {
      setPronounsOther(false)
      return
    }
    setPronounsOther(
      selected.pronouns !== '' && !isPronounPreset(selected.pronouns),
    )
  }, [selected?.id])

  function pick(dragon: Dragon) {
    onSelectDragon(dragon.id)
    setQuery('')
    setOpen(false)
  }

  const pageUrl = selected ? getDragonPageUrl(selected.frId) : ''
  const pronounSelect = pronounsOther
    ? 'other'
    : selected &&
        (selected.pronouns === '' || isPronounPreset(selected.pronouns))
      ? selected.pronouns
      : selected
        ? 'other'
        : ''

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
          <h2 className="side-panel__title">
            {selected.name || 'Unnamed'}
            {isGenerationOne(selected) ? (
              <span
                className="side-panel__g1"
                title="Generation 1 - no parents (None on Flight Rising)"
              >
                G1
              </span>
            ) : null}
            {selected.exalted ? (
              <span
                className="side-panel__exalted"
                title="Exalted on Flight Rising"
              >
                EX
              </span>
            ) : null}
          </h2>

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

            <div className="edit-form__field">
              <span>Dragon ID</span>
              <div className="edit-form__id-row">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="e.g. 22389889"
                  value={selected.frId}
                  aria-label="Dragon ID"
                  onChange={(event) =>
                    onPatch({ frId: event.target.value.replace(/\D/g, '') })
                  }
                />
                <button
                  type="button"
                  className="edit-form__open-page"
                  disabled={!pageUrl}
                  title={
                    pageUrl
                      ? 'Open Flight Rising page'
                      : 'Enter a Dragon ID first'
                  }
                  onClick={() => {
                    if (pageUrl) window.open(pageUrl, '_blank', 'noopener,noreferrer')
                  }}
                >
                  Open page
                </button>
              </div>
            </div>

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
                    {sex === 'female'
                      ? 'Female'
                      : sex === 'male'
                        ? 'Male'
                        : 'Unknown'}
                  </option>
                ))}
              </select>
            </label>

            <label className="edit-form__field">
              <span>Element</span>
              <select
                value={selected.element}
                onChange={(event) =>
                  onPatch({
                    element: event.target.value as DragonElement,
                  })
                }
              >
                <option value="">Not set</option>
                {FR_ELEMENTS.map((element) => (
                  <option key={element} value={element}>
                    {displayElement(element)}
                  </option>
                ))}
              </select>
            </label>

            <label className="edit-form__field">
              <span>Pronouns</span>
              <select
                value={pronounSelect}
                onChange={(event) => {
                  const value = event.target.value
                  if (value === 'other') {
                    setPronounsOther(true)
                    if (isPronounPreset(selected.pronouns)) {
                      onPatch({ pronouns: '' })
                    }
                    return
                  }
                  setPronounsOther(false)
                  onPatch({ pronouns: value })
                }}
              >
                <option value="">Not set</option>
                {PRONOUN_PRESETS.map((set) => (
                  <option key={set} value={set}>
                    {set}
                  </option>
                ))}
                <option value="other">Other</option>
              </select>
            </label>
            {pronounSelect === 'other' ? (
              <label className="edit-form__field">
                <span>Custom pronouns</span>
                <input
                  type="text"
                  value={selected.pronouns}
                  placeholder="e.g. xe/xem"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => onPatch({ pronouns: event.target.value })}
                  onBlur={(event) => {
                    const next = normalizePronouns(event.target.value)
                    if (next !== selected.pronouns) onPatch({ pronouns: next })
                  }}
                />
              </label>
            ) : null}

            <label className="edit-form__field">
              <span>Birth date</span>
              <input
                type="date"
                value={selected.birthDate}
                onChange={(event) =>
                  onPatch({ birthDate: event.target.value })
                }
              />
            </label>

            <label className="edit-form__check">
              <input
                type="checkbox"
                checked={selected.parentsNone}
                disabled={
                  selected.motherId !== null || selected.fatherId !== null
                }
                onChange={(event) =>
                  onPatch({ parentsNone: event.target.checked })
                }
              />
              <span>
                G1
                {selected.motherId !== null || selected.fatherId !== null
                  ? ' - clear parent links first'
                  : ''}
              </span>
            </label>

            <label className="edit-form__check">
              <input
                type="checkbox"
                checked={selected.exalted}
                onChange={(event) =>
                  onPatch({ exalted: event.target.checked })
                }
              />
              <span>Exalted</span>
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
