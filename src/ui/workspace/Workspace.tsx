import { useEffect, useState } from 'react'
import {
  addChildOf,
  addFatherTo,
  addMotherTo,
  assignFather,
  assignMother,
  createDragonInProject,
  deleteDragon,
  getProject,
  getProjectFile,
  hydrateProjectFromStorage,
  linkDragonAsChild,
  linkDragonAsParent,
  linkDragonsAsSiblings,
  newProject,
  openProjectFile,
  patchDragon,
  projectHasContent,
  renameProject,
  replaceProject,
  useProject,
  wasLastPersistSuccessful,
} from '../../state/projectStore'
import {
  clearSelection,
  ensureSelectionValid,
  selectDragon,
  useSelectedDragonId,
  useViewFocusId,
} from '../../state/selectionStore'
import {
  hydrateViewSettings,
  setViewSettings,
  useViewSettings,
} from '../../state/viewSettingsStore'
import { ProjectLoadError } from '../../data/serialization/loadProject'
import {
  FrDragonPageParseError,
  mergeFrDragonPage,
  parseFrDragonPage,
} from '../../importers/frDragonPage'
import {
  downloadProjectJson,
  openProjectJsonFile,
  pickFrDragonPageFiles,
  pickProjectJsonFile,
} from '../../storage/fileIo'
import { TopBar, type MenuAction } from '../chrome/TopBar'
import { SettingsDialog } from '../dialogs/SettingsDialog'
import { WelcomeScreen } from '../dialogs/WelcomeScreen'
import { EditPanel } from '../panels/EditPanel'
import {
  TreeCanvas,
  type CanvasContextTarget,
  type CanvasMenuState,
} from '../tree-view/TreeCanvas'
import './Workspace.css'

function askProjectName(defaultName: string): string | null {
  const value = window.prompt('Project name', defaultName)
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : defaultName
}

export function Workspace() {
  const project = useProject()
  const selectedDragonId = useSelectedDragonId()
  const viewFocusId = useViewFocusId()
  const viewSettings = useViewSettings()
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [booting, setBooting] = useState(true)
  const [hasSession, setHasSession] = useState(false)
  const [welcomeError, setWelcomeError] = useState<string | null>(null)
  const [canvasMenu, setCanvasMenu] = useState<CanvasMenuState | null>(null)

  useEffect(() => {
    hydrateViewSettings()
    const restored = hydrateProjectFromStorage()
    setHasSession(restored)
    setBooting(false)
    if (restored && !wasLastPersistSuccessful()) {
      window.alert(
        'Project restored, but this browser blocked saving. Use Save as JSON for backups.',
      )
    }
  }, [])

  useEffect(() => {
    ensureSelectionValid(project)
  }, [project])

  function showError(message: string) {
    window.alert(message)
  }

  function handleCreated(result: { ok: true; dragonId?: string } | { ok: false; error: string }) {
    if (!result.ok) {
      showError(result.error)
      return
    }
    if (result.dragonId) selectDragon(result.dragonId, getProject())
  }

  function startNewProject(name: string) {
    newProject(name)
    clearSelection()
    setHasSession(true)
    setWelcomeError(null)
  }

  async function openJsonIntoSession(options?: { fromWelcome?: boolean }) {
    const file = await pickProjectJsonFile()
    if (!file) return false

    try {
      const loaded = await openProjectJsonFile(file)
      if (!options?.fromWelcome && projectHasContent()) {
        const ok = window.confirm(
          `Replace the current project with “${loaded.project.name}”?`,
        )
        if (!ok) return false
      }
      openProjectFile(loaded)
      clearSelection()
      setHasSession(true)
      setWelcomeError(null)
      return true
    } catch (error) {
      const message =
        error instanceof ProjectLoadError
          ? error.message
          : 'Could not open that file.'
      if (options?.fromWelcome) {
        setWelcomeError(message)
      } else {
        showError(message)
      }
      return false
    }
  }

  function handleCanvasMenuAction(actionId: string, target: CanvasContextTarget) {
    setCanvasMenu(null)

    if (target.kind === 'empty') {
      if (actionId === 'create') {
        handleCreated(
          createDragonInProject({
            name: 'Unnamed',
            posX: target.worldX,
            posY: target.worldY,
          }),
        )
      }
      return
    }

    if (target.kind === 'link') {
      const { fromId, toId } = target
      let result: { ok: true } | { ok: false; error: string }
      switch (actionId) {
        case 'link-parent':
          // "{to} is parent of {from}"
          result = linkDragonAsParent(toId, fromId)
          break
        case 'link-child':
          // "{to} is child of {from}"
          result = linkDragonAsChild(toId, fromId)
          break
        case 'link-sibling':
          result = linkDragonsAsSiblings(toId, fromId)
          break
        default:
          return
      }
      if (!result.ok) showError(result.error)
      return
    }

    const dragonId = target.dragonId
    const dragon = project.dragons[dragonId]
    if (!dragon) return

    switch (actionId) {
      case 'add-mother':
        handleCreated(addMotherTo(dragonId))
        break
      case 'add-father':
        handleCreated(addFatherTo(dragonId))
        break
      case 'add-child':
        handleCreated(addChildOf(dragonId))
        break
      case 'clear-mother': {
        const result = assignMother(dragonId, null)
        if (!result.ok) showError(result.error)
        break
      }
      case 'clear-father': {
        const result = assignFather(dragonId, null)
        if (!result.ok) showError(result.error)
        break
      }
      case 'delete': {
        const label = dragon.name.trim() || 'Unnamed'
        const ok = window.confirm(
          `Delete "${label}"?\n\nParent links to this dragon will be cleared. This cannot be undone.`,
        )
        if (!ok) return
        const result = deleteDragon(dragonId)
        if (!result.ok) {
          showError(result.error)
          return
        }
        break
      }
      default:
        break
    }
  }

  async function handleImportDragonPages() {
    const files = await pickFrDragonPageFiles()
    if (files.length === 0) return

    let project = getProject()
    let lastMainId: string | null = null
    let imported = 0
    const errors: string[] = []

    for (const file of files) {
      try {
        const text = await file.text()
        const page = parseFrDragonPage(text)
        const merged = mergeFrDragonPage(project, page)
        if (!merged.ok) {
          errors.push(`${file.name}: ${merged.error}`)
          continue
        }
        project = merged.project
        lastMainId = merged.summary.mainId
        imported += 1
      } catch (error) {
        const message =
          error instanceof FrDragonPageParseError
            ? error.message
            : 'Could not read that file.'
        errors.push(`${file.name}: ${message}`)
      }
    }

    if (imported > 0) {
      replaceProject(project)
      if (lastMainId) selectDragon(lastMainId, getProject())
      if (errors.length > 0) {
        showError(`Imported ${imported} page(s). Some files failed:\n${errors[0]}`)
      }
    } else if (errors.length > 0) {
      showError(errors[0]!)
    }
  }

  async function handleMenuAction(action: MenuAction) {
    setMenuOpen(false)
    setCanvasMenu(null)

    if (action === 'rename') {
      const name = askProjectName(project.name)
      if (name === null || name === project.name) return
      renameProject(name)
      return
    }

    if (action === 'new') {
      if (projectHasContent()) {
        const ok = window.confirm(
          'Start a new project? Download JSON first if you need a backup.',
        )
        if (!ok) return
      }
      const name = askProjectName('Untitled')
      if (name === null) return
      startNewProject(name)
      return
    }

    if (action === 'download') {
      downloadProjectJson(getProjectFile())
      return
    }

    if (action === 'open') {
      await openJsonIntoSession()
    }
  }

  if (booting) {
    return <div className="workspace workspace--loading" />
  }

  if (!hasSession) {
    return (
      <WelcomeScreen
        error={welcomeError}
        onCreate={(name) => {
          startNewProject(name)
        }}
        onOpen={() => {
          void openJsonIntoSession({ fromWelcome: true })
        }}
      />
    )
  }

  const selected = selectedDragonId ? project.dragons[selectedDragonId] ?? null : null

  return (
    <div className="workspace">
      <TopBar
        projectName={project.name}
        onOpenSettings={() => {
          setMenuOpen(false)
          setCanvasMenu(null)
          setSettingsOpen(true)
        }}
        menuOpen={menuOpen}
        onMenuToggle={() => setMenuOpen((open) => !open)}
        onMenuClose={() => setMenuOpen(false)}
        onMenuAction={(action) => {
          void handleMenuAction(action)
        }}
      />

      <div className="workspace__body">
        <EditPanel
          project={project}
          selected={selected}
          onSelectDragon={(id) => selectDragon(id, project)}
          onPatch={(patch) => {
            if (!selected) return
            const result = patchDragon(selected.id, patch)
            if (!result.ok) showError(result.error)
          }}
        />

        <TreeCanvas
          project={project}
          selectedDragonId={selectedDragonId}
          viewFocusId={viewFocusId}
          interactive
          emptyLine="Your family tree will appear here."
          ancestorGenerations={viewSettings.ancestorGenerations}
          descendantGenerations={viewSettings.descendantGenerations}
          menu={canvasMenu}
          onSelectDragon={(id) => selectDragon(id, project)}
          onOpenMenu={setCanvasMenu}
          onCloseMenu={() => setCanvasMenu(null)}
          onMenuAction={handleCanvasMenuAction}
          onImportDragonPage={() => {
            void handleImportDragonPages()
          }}
        />
      </div>

      <SettingsDialog
        open={settingsOpen}
        settings={viewSettings}
        onChange={setViewSettings}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  )
}
