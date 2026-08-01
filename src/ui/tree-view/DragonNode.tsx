import {
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { Dragon } from '../../data/models'
import {
  displayBirthDate,
  displayElement,
  displayPronouns,
  elementBackgroundUrl,
  elementFallbackColor,
  isFrElement,
} from '../../data/models'
import { useViewSettings } from '../../state/viewSettingsStore'
import { isGenerationOne } from '../../tree'
import { getDragonRenderUrl } from '../../utils/frRender'
import {
  ensureDragonDotColor,
  getDragonDotColor,
  subscribeDragonDotColor,
} from './dragonDotColor'
import type { TreeLod } from './treeLod'
import './DragonNode.css'

type DragonNodeProps = {
  dragon: Dragon
  selected: boolean
  focused?: boolean
  /** Kinship to the active dragon, shown under the name. */
  relationLabel?: string | null
  /** Full kinship term for the tooltip when the card label is abbreviated. */
  relationTitle?: string | null
  /** Soften dragons outside the selected kin set. */
  dimmed?: boolean
  /** Canvas level-of-detail from zoom. */
  lod?: TreeLod
  style?: CSSProperties
  onSelect: () => void
  onContextMenu: (event: MouseEvent) => void
  /** When set, parent owns press/drag; click select is skipped. */
  onNodePointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void
}

type ImageAttempt = 'preferred' | 'full' | 'portrait' | 'none'

function nextImageAttempt(
  failed: ImageAttempt,
  preferred: 'full' | 'portrait',
): ImageAttempt {
  if (failed === 'preferred') {
    return preferred === 'portrait' ? 'full' : 'portrait'
  }
  return 'none'
}

function useDragonDotColor(frId: string, active: boolean): string {
  const color = useSyncExternalStore(
    (onStoreChange) => subscribeDragonDotColor(frId, onStoreChange),
    () => getDragonDotColor(frId),
    () => getDragonDotColor(frId),
  )
  useEffect(() => {
    if (!active || !frId) return
    ensureDragonDotColor(frId)
  }, [active, frId])
  return color
}

export function DragonNode({
  dragon,
  selected,
  focused = false,
  relationLabel = null,
  relationTitle = null,
  dimmed = false,
  lod = 'full',
  style,
  onSelect,
  onContextMenu,
  onNodePointerDown,
}: DragonNodeProps) {
  const [imageAttempt, setImageAttempt] = useState<ImageAttempt>('preferred')
  const { dateFormat } = useViewSettings()
  useEffect(() => {
    setImageAttempt('preferred')
  }, [dragon.frId, dragon.imageCrop])

  const preferredCrop = dragon.imageCrop === 'full' ? 'full' : 'portrait'
  const loadImage = lod !== 'dot'
  const imageUrl =
    !loadImage || imageAttempt === 'none' || !dragon.frId
      ? ''
      : imageAttempt === 'preferred'
        ? getDragonRenderUrl(dragon.frId, preferredCrop)
        : getDragonRenderUrl(dragon.frId, imageAttempt)

  const dotColor = useDragonDotColor(dragon.frId, lod === 'dot')

  const sexUnknown = dragon.sex === 'unknown'
  const generationOne = isGenerationOne(dragon)
  const showSexError = sexUnknown && lod === 'full'
  const showG1 = generationOne && lod !== 'dot'
  const showExalted = dragon.exalted && lod !== 'dot'
  const element = isFrElement(dragon.element) ? dragon.element : null
  const showElement = lod !== 'dot' && element !== null
  const elementBgUrl = element ? elementBackgroundUrl(element) : ''
  const showName = lod === 'full' || lod === 'named'
  const pronouns = displayPronouns(dragon.pronouns)
  const showPronouns = showName && Boolean(pronouns)
  const birthDate = displayBirthDate(dragon.birthDate, dateFormat)
  const showBirthDate = lod === 'full' && Boolean(birthDate)
  const showRelation = lod === 'full' && Boolean(relationLabel)

  const className = [
    'dragon-node',
    `dragon-node--lod-${lod}`,
    selected ? 'dragon-node--selected' : '',
    focused ? 'dragon-node--focused' : '',
    dimmed ? 'dragon-node--dimmed' : '',
    sexUnknown ? 'dragon-node--sex-unknown' : '',
    generationOne ? 'dragon-node--g1' : '',
    dragon.exalted ? 'dragon-node--exalted' : '',
    showElement ? 'dragon-node--element' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const titleParts = [dragon.name.trim() || 'Unnamed']
  if (dragon.frId) titleParts.push(`FR #${dragon.frId}`)
  if (relationTitle || relationLabel) {
    titleParts.push(relationTitle || relationLabel!)
  }
  if (birthDate) titleParts.push(birthDate)
  if (generationOne) titleParts.push('G1 - no parents')
  if (dragon.exalted) titleParts.push('Exalted')
  if (element) titleParts.push(displayElement(element))
  if (sexUnknown) titleParts.push('sex unknown')

  const nodeStyle: CSSProperties = {
    ...style,
    ...(element
      ? ({
          '--dragon-element-fallback': elementFallbackColor(element),
        } as CSSProperties)
      : {}),
  }

  return (
    <button
      type="button"
      className={className}
      style={nodeStyle}
      data-dragon-id={dragon.id}
      title={titleParts.join(' · ')}
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
      {showElement && element ? (
        <span className="dragon-node__element-bg" aria-hidden="true">
          <img
            className="dragon-node__element-img"
            src={elementBgUrl}
            alt=""
            draggable={false}
            referrerPolicy="no-referrer"
          />
        </span>
      ) : null}
      <span className="dragon-node__portrait" aria-hidden="true">
        {lod === 'dot' ? (
          <span
            className="dragon-node__dot"
            style={{ background: dotColor }}
          />
        ) : imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            draggable={false}
            onError={() => {
              setImageAttempt((current) =>
                nextImageAttempt(current, preferredCrop),
              )
            }}
          />
        ) : (
          <span className="dragon-node__placeholder" />
        )}
        {showG1 ? (
          <span className="dragon-node__g1" aria-hidden="true">
            G1
          </span>
        ) : null}
        {showExalted ? (
          <span className="dragon-node__exalted" aria-hidden="true">
            EX
          </span>
        ) : null}
        {showSexError ? (
          <span className="dragon-node__sex-error" aria-hidden="true">
            !
          </span>
        ) : null}
      </span>
      {showName ? (
        <span className="dragon-node__caption">
          <span className="dragon-node__name">{dragon.name}</span>
          {showPronouns ? (
            <span className="dragon-node__pronouns">{pronouns}</span>
          ) : null}
          {showBirthDate ? (
            <span className="dragon-node__birth">{birthDate}</span>
          ) : null}
          {showRelation ? (
            <span
              className="dragon-node__relation"
              title={relationTitle || relationLabel || undefined}
            >
              {relationLabel}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  )
}
