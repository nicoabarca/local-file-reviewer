# Local File Reviewer

Review PDFs produced by code agents, comment on exact passages or page regions, and copy one self-contained prompt for the agent to act on. Runs entirely in your browser on `localhost`: no account, no backend, no network calls during review.

## Run

```sh
npm install        # also copies PDF.js fonts/cmaps/wasm into public/pdfjs
npm start          # builds and serves on http://127.0.0.1:5174
npm run dev        # development server on http://127.0.0.1:5173
npm test           # unit tests for geometry, visual lines and export
npm run fixtures   # writes sample PDFs to fixtures/
```

Chromium-based browsers (Chrome, Edge, Arc) can watch the opened PDF for changes and reopen saved reviews without a file picker. Other browsers detect a change only when they refuse to re-read a modified file.

## Workflow

1. Open the PDF (or drop it on the start screen). The file is never modified. Saved reviews are listed on the start screen; click one to reopen its PDF (Chromium remembers the file; other browsers ask you to pick it).
2. Select text and press **C** (or click **Add comment**), or press **R** and drag a box for figures and scanned pages.
3. Press **E** and **Copy prompt**, then paste it into your agent. Nothing is written to disk.
4. Open the agent's revised PDF: a file with different content always starts an empty review.

Shortcuts: `C` comment · `R`/`T` region/text mode · `S` page sidebar · `V` one or two pages per row · `J`/`K` next/previous comment · `[`/`]` page · `+`/`-`/`0` zoom · `E` agent prompt · `Esc` cancel. `⌘/Ctrl+Enter` saves a comment.

## Deploy to Vercel

The app is a static site: `vercel.json` builds it with `npm run build` and serves `dist/`. Import the repo in Vercel (or run `vercel --prod`); no settings are needed.

- **Pick the final domain before people use it.** Saved reviews belong to the exact origin. Each preview deployment URL has its own, empty storage, and moving from `*.vercel.app` to a custom domain later leaves every existing review behind on the old one (review files still work).
- **Keep the project static.** Do not add an `api/` folder, Vercel Functions, Web Analytics or Speed Insights. The privacy guarantee is that documents never leave the browser; the Content-Security-Policy only allows requests to the app's own origin, so a server function there would be the one place data could be sent.
- **Security headers** come from `vercel.json`: the Content-Security-Policy (also embedded in the built HTML as a meta tag, so `npm start` gets the same policy), no framing by other sites, `nosniff`, no referrer, and no camera/microphone/location access. Edit the policy only in `vercel.json`.

## Data

- Reviews autosave to the browser's `localStorage` for the app origin, keyed by the PDF's SHA-256. Only comments and file identities are stored, never document contents. Saved reviews are listed (and deletable) on the start screen.
- After the first comment the app asks the browser to keep its storage (`navigator.storage.persist()`). Without that, browsers may clear it under disk pressure, and Safari clears it after 7 days without a visit.
- **Save to file** (`⌘/Ctrl+S`) writes `<pdf name>.review.json`, a portable copy of the review. **Open review file…** on the start screen (or dropping the file there) loads it back into any browser; opened files are validated and only known fields are kept.
- In Chromium, IndexedDB also stores a reference (not the contents) to each reviewed PDF, so saved reviews reopen it in one click.
- If the reviewed PDF changes on disk, the review stops and asks whether to start a new review or keep reviewing the originally loaded snapshot; the latter is recorded as a warning in the prompt.

## Agent prompt

The prompt contains, in order:

1. The task: revise the source the PDF was generated from, then regenerate the PDF.
2. The PDF's identity: name, SHA-256 hash, size and page count, with a check-the-hash instruction.
3. How to locate comments: page, quote (and how PDF extraction can differ from the source), before/after context for repeated quotes, visual lines, normalized rectangles, region comments.
4. Warnings, if a file changed during the review.
5. Every comment in document order: location, quote, context and the reviewer's text.
6. What to do when finished.
7. A machine-readable JSON copy (`schemaVersion: 1`) of the same data.

Coordinates are page-relative `[left, top, right, bottom]`, 0–1, origin top-left of the page as displayed (PDF `/Rotate` applied), independent of zoom. Text selections store one rectangle per visual line. Visual lines group PDF text items by vertical position, numbered from the top of the page; side-by-side columns can share a number, and they are `null` when unreliable. Region comments never carry a quote or line numbers.

## Security

PDFs are untrusted input. PDF.js runs with XFA off, annotations not rendered (no links, forms or scripts), and all helper assets served from this origin. The production build ships a Content-Security-Policy that forbids network access outside the app's own origin. The servers bind to `127.0.0.1` only.
