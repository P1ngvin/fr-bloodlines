# Architecture

FR Bloodlines is a browser-only dragon pedigree editor for Flight Rising.
JSON is the canonical project format. BBCode export is one feature, not the product.

## Layers

| Module | Responsibility | May depend on |
|--------|----------------|---------------|
| `data` | Models, serialization, migrations | `utils` |
| `tree` | Graph, validation, view-tree building | `data` models, `utils` |
| `exporters` | Pure export (BBCode, later HTML/SVG/PNG) | `tree` view models, `frames` metadata |
| `frames` | Frame definitions registry | `utils` |
| `storage` | LocalStorage, file download/open | `data` serialization |
| `state` | App orchestration (workspace mode, selection) | domain modules above |
| `ui` | React workspace | `state`, domain modules |
| `utils` | Shared helpers | nothing |

**Rules**

- `tree`, `data`, `exporters`, and `frames` must never import React or `ui`.
- Exporters must never import UI components.
- Only the migration layer understands old JSON shapes. The rest of the app uses the current model only.

## Workspace UX

One primary workspace. The tree canvas stays visible at all times.

- **Edit mode** — create/edit dragons, assign parents.
- **Export mode** — root, generation limits, overlays, generate BBCode.

Export-only settings (root dragon, hide branches, placeholders) live in a **session** and are not written to the project JSON.

Project open/download and similar actions live in menus/dialogs, not separate pages.

## Data compatibility

Every saved file is a `ProjectFile` envelope with `formatVersion`, `createdWith`, and `updatedWith`.
Format changes require a migration under `data/migrations/`. Saves always use the newest version.

## Images

Users enter a Flight Rising **dragon ID**. The app builds the render URL:

`https://www1.flightrising.com/rendern/350/{ceil(id/100)}/{id}_350.png`

Example: `22389889` → `.../rendern/350/223899/22389889_350.png`

The app never scrapes FR pages. Cropping (`imageCrop`) is a UI concern; exporters do not process images.

## Focus tree

**Edit mode** uses a stable bloodline layout: progenitors at the top, children
below. Selecting another dragon only changes the highlight — the tree shape stays
the same.

**Export mode** uses a Sims-like focus tree around the chosen dragon (ancestors
above, descendants below), with optional generation limits from Settings.

## Incremental stages

0. Scaffold + workspace shell — done
1. Data model, migrations harness, LocalStorage, JSON I/O — done
2. Dragon CRUD + parent relations + validation — done
3. Focus tree layout (Sims-like) + FR dragon ID — done
4. Export mode + BBCode exporter
5. Frames registry + image crop preview
6. Export overlays
7. Polish
