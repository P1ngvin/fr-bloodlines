import type { ProjectFile } from '../data/models'
import { loadProject } from '../data/serialization/loadProject'
import { serializeProjectFile } from '../data/serialization/saveProject'

function safeFileStem(name: string): string {
  const cleaned = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').slice(0, 80)
  return cleaned.length > 0 ? cleaned : 'bloodlines-project'
}

/** Trigger a browser download of the canonical JSON project file. */
export function downloadProjectJson(file: ProjectFile): void {
  const text = serializeProjectFile(file)
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${safeFileStem(file.project.name)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

/** Open a `.json` file from disk and parse it as a ProjectFile. */
export function openProjectJsonFile(file: File): Promise<ProjectFile> {
  return file.text().then((text) => loadProject(text))
}

/**
 * Show a file picker for JSON projects.
 * Resolves null if the user cancels.
 */
export function pickProjectJsonFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.style.display = 'none'

    let settled = false

    function finish(file: File | null) {
      if (settled) return
      settled = true
      window.removeEventListener('focus', onFocus)
      input.remove()
      resolve(file)
    }

    function onFocus() {
      // Cancel detection: focus returns without a change event.
      window.setTimeout(() => {
        if (!settled) finish(null)
      }, 300)
    }

    input.addEventListener('change', () => {
      finish(input.files?.[0] ?? null)
    })

    document.body.appendChild(input)
    window.addEventListener('focus', onFocus)
    input.click()
  })
}
