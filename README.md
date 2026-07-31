# FR Bloodlines

Browser-based dragon lineage editor for Flight Rising.

Static site for **GitHub Pages**. No backend, no authentication. Projects are JSON files; BBCode export is one feature among others.

## Run locally (easiest)

**Windows:** double-click `start.cmd`  
(installs dependencies on first run, then opens the app in your browser)

Or from a terminal in this folder:

```bash
npm install
npm start
```

The app opens at [http://localhost:5173](http://localhost:5173). Stop with `Ctrl+C`.

| Command | What it does |
|---------|----------------|
| `npm start` / `npm run dev` | Local development server |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Preview the production build locally |

## GitHub Pages

The site is a static Vite build. Deployment is automated via `.github/workflows/deploy-pages.yml`.

After the repo is on GitHub:

1. **Settings → Pages → Build and deployment → Source:** GitHub Actions  
2. Push to `main` (or `master`), or run the workflow manually  
3. Site URL: `https://<user>.github.io/<repo>/`

The workflow sets `VITE_BASE` to `/<repo-name>/` so assets resolve correctly on project Pages.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md).

## Status

**Stage 3 (partial)** — FR dragon ID → render URL; Sims-like focus tree (ancestors above, descendants below).
