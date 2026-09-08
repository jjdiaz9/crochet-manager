# Crochet Manager

A single-file web app for managing crochet **projects, patterns, yarn stash, and supplies**, with a built-in **row + repeat counter** that follows your pattern.

Everything runs in the browser — no accounts, no server, no tracking. Your data stays on your device (browser storage) and can be exported/imported as a JSON backup.

## Features

- **Projects** — status (planning / in progress / hibernating / finished / frogged), linked pattern, hook, yarn used, notes, progress photos.
- **Row counter** — big tap targets, optional second counter for pattern repeats or stitches (with a target that auto-advances the row), undo history, jump to any row, keyboard shortcuts (Space/→ +1, ← −1, Z undo). Keeps the screen awake while counting.
- **Patterns** — import PDFs, photos, `.txt`/`.md` files, paste written instructions, or save a link (Ravelry, Etsy, blogs). Written instructions are parsed into rows (`Row 1:`, `Rnd 2:`, `Rows 3-6:` …) so the counter can show the current and next step.
- **Yarn stash** — brand, line, colorway, weight, fiber, yardage, quantity, label photo. **Scan the UPC barcode** with the camera (Safari 17+ / Chrome); known yarns are matched from your own stash first, unknown codes are looked up on UPCitemdb's free tier and then remembered.
- **Supplies** — hooks (one-click "add a hook set"), stitch markers, safety eyes, stuffing, and so on, with quantities.
- **Backup** — export/import JSON, optionally including attached PDFs and photos.

## Use it

Open the GitHub Pages URL for this repo, or just open `index.html` locally.

On iPhone/iPad: open the page in Safari → Share → **Add to Home Screen** for a full-screen app.

> Camera scanning needs a secure context (https or localhost); GitHub Pages provides that.

## Development

There is no build step. `index.html` contains all HTML, CSS and JavaScript. Edit it, refresh, done.

## Privacy

Data lives in your browser's `localStorage` (records) and IndexedDB (files). Nothing is sent anywhere except the optional UPC lookup, which sends only the barcode number to UPCitemdb.
