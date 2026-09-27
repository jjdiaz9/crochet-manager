# Crochet Manager

A single-file web app for managing crochet **projects, patterns, yarn stash, and supplies**, with a built-in **row + repeat counter** that follows your pattern.

Everything runs in the browser — no accounts, no server, no tracking. Your data stays on your device (browser storage) and can be exported/imported as a JSON backup.

## Features

- **Projects** — status (planning / in progress / hibernating / finished / frogged), one or more linked patterns (each keeps its own row count; switch between them in the counter), hook, yarn used, notes, progress photos.
- **Row counter** — big tap targets, optional second counter for pattern repeats or stitches (with a target that auto-advances the row), undo history, jump to any row, keyboard shortcuts (Space/→ +1, ← −1, Z undo). Keeps the screen awake while counting.
- **Patterns** — import PDFs, photos, `.txt`/`.md` files, paste written instructions, or save a link (Ravelry, Etsy, blogs). **PDF text is extracted automatically** on import (or later via "Extract rows" on the pattern page) and parsed into rows (`Row 1:`, `Rnd 2:`, `Rows 3-6:` …) so the counter shows the current and next step. Multi-part patterns whose numbering restarts (e.g. amigurumi body, then wings) are stepped through in order. Scanned-image PDFs have no text to extract. The PDF reader (pdf.js) loads from cdnjs the first time it's needed.
- **Yarn stash** — brand, line, colorway, weight, fiber, yardage, quantity, label photo. **Scan the UPC barcode** with the camera (Safari 17+ / Chrome); known yarns are matched from your own stash first, then Open Products Facts / Open Food Facts (free, no key), then UPCitemdb through the proxy below.
- **Ravelry** — search and import crochet patterns (details, hook, weight, yardage, photo, download link), search yarns, and one-tap import of your Ravelry **library, queue, projects and stash**. Read-only; nothing is written to your Ravelry account.
- **Supplies** — hooks (one-click "add a hook set"), stitch markers, safety eyes, stuffing, and so on, with quantities.
- **Sync** — keep every device on the same data through a JSON file in a private GitHub repo (PDFs and photos included). See below.
- **Backup** — export/import JSON, optionally including attached PDFs and photos.

## Use it

Open the GitHub Pages URL for this repo, or just open `index.html` locally.

On iPhone/iPad: open the page in Safari → Share → **Add to Home Screen** for a full-screen app.

> Camera scanning needs a secure context (https or localhost); GitHub Pages provides that.

## Lookup proxy (UPCitemdb + Ravelry)

UPCitemdb and the Ravelry API both refuse calls made directly from a web page, so the repo ships a small Cloudflare Worker, `worker/upc-proxy.js` (free tier is plenty). Deploy it from Terminal with Wrangler (needs Node: `brew install node`):

```
cd worker
npx wrangler login
npx wrangler kv namespace create TOKENS     # paste the printed id into wrangler.toml
npx wrangler deploy                         # prints your https://….workers.dev URL
```

Ravelry access comes in two layers, both created at ravelry.com/pro/developer:

1. **Catalog search** (patterns, yarns): an app of type *Basic Auth: read only access*. Store its pair as secrets: `npx wrangler secret put RAVELRY_USER` and `npx wrangler secret put RAVELRY_PASS`.
2. **Your own data** (library, queue, projects, stash): Ravelry only exposes these through OAuth. Create a second app of type *OAuth 2.0* with redirect URI `https://<your worker>.workers.dev/oauth/callback`, then `npx wrangler secret put RAVELRY_CLIENT_ID` and `npx wrangler secret put RAVELRY_CLIENT_SECRET`. In the app: Data → paste the worker URL → **Connect Ravelry** (a one-time approval on ravelry.com). Tokens are kept in the worker's KV store and refreshed automatically; the browser never sees them.

Optional: `npx wrangler secret put UPCITEMDB_KEY` for a paid UPCitemdb plan. The worker only accepts GET requests from the app's origin, a whitelist of read-only Ravelry paths, and Ravelry/UPCitemdb image hosts for the photo pass-through.

## Sync across devices (private GitHub repo)

Data → **Sync with a private GitHub repo**. Your data is saved as `crochet-manager/data.json` in a private repo you own. Attached PDFs and photos go under `crochet-manager/files/`. This repo only holds the app, never your data.

1. Create a **fine-grained personal access token** at github.com → Settings → Developer settings → Fine-grained tokens. Set *Repository access* → *Only select repositories* → your private data repo, and *Permissions* → *Contents: Read and write*. Nothing else is needed.
2. In the app, enter the owner, the private repo name, and the token, then **Save settings**. The first save syncs right away.
3. Do the same on each device. The first sync on a device that already has its own data asks which copy to keep.

**Sync now** (or the status chip in the header) pulls if GitHub is newer and pushes if this device is newer. If both changed since the last sync, it stops and asks which copy to keep, and downloads the other copy as a backup file first. It never merges silently.

**Sync automatically** (on by default) pulls when the app opens or comes back to the front. It pushes a minute after you stop editing and when you leave the app. Every push is a commit in the data repo; turn this off to sync only when you press the button.

The token and sync settings stay in this browser only. They are never included in the data file or in exported backups. Every app published under the same `github.io` address can read what this page stores, so keep the token limited to the one data repo.

## Development

There is no build step. `index.html` contains all HTML, CSS and JavaScript. Edit it, refresh, done.

## Privacy

Data lives in your browser's `localStorage` (records) and IndexedDB (files). PDFs are read locally in your browser (pdf.js is downloaded from cdnjs, your file is never uploaded). Network calls are limited to the optional UPC lookups, the Ravelry proxy you deploy yourself, and GitHub if you turn on sync.
