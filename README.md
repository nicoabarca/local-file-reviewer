# Local File Reviewer

Review PDFs and HTML documents produced by code agents, comment on exact passages or regions, and copy one self-contained prompt for the agent to act on. Runs entirely in your browser on `localhost`: no account, no backend. PDF reviews make no network calls; HTML documents may load their own remote resources (see [HTML documents](#html-documents)).

## Run

```sh
npm install        # also copies PDF.js fonts/cmaps/wasm into public/pdfjs
npm start          # builds and serves on http://127.0.0.1:5174
npm run dev        # development server on http://127.0.0.1:5173
npm test           # unit tests for geometry, visual lines and export
npm run fixtures   # writes sample PDFs to fixtures/ (fixtures/architecture-v2.html is a sample HTML doc)
```

Chromium-based browsers (Chrome, Edge, Arc) can watch the opened file for changes and reopen saved reviews without a file picker. Other browsers detect a change only when they refuse to re-read a modified file.

## Workflow

1. Open the PDF or HTML file (or drop it on the start screen). The file is never modified. Saved reviews are listed on the start screen; click one to reopen its file (Chromium remembers the file; other browsers ask you to pick it).
2. Select text and press **C** (or click **Add comment**), or press **R** and drag a box for figures and scanned pages.
3. Press **E** and **Copy prompt**, then paste it into your agent. Nothing is written to disk.
4. Open the agent's revised file: a file with different content always starts an empty review.

Shortcuts: `C` comment · `Q` ask Claude · `R`/`T` region/text mode · `S` page sidebar (outline for HTML) · `V` one or two pages per row (PDF only) · `J`/`K` next/previous comment · `[`/`]` page (section for HTML) · `+`/`-`/`0` zoom · `E` agent prompt · `Esc` cancel. `⌘/Ctrl+Enter` saves a comment. Shortcuts also work while focus is inside an HTML document, except when typing in one of its form fields.

## Ask Claude

Select text and press **Q** (or click **Ask Claude**) to ask about the passage, for example what a term means. The answer streams into the same card, below the question. Questions are saved with the review but never go into the agent prompt.

- Works only under `npm run dev` and `npm start`: the Vite server runs the [Claude Code](https://claude.com/claude-code) CLI (`claude`, which must be on your `PATH` and logged in). A static deploy has no such server, and the feature stays hidden.
- Opening a document starts one `claude` process for it in the background, so answers start in about a second. The first question sends the document's full text (up to 400,000 characters); later questions send only the passage and the question, and Claude remembers earlier questions about the same document. After 30 questions, or 15 minutes without one, the process is replaced.
- The process has no tools, no settings, hooks, plugins or MCP servers, and an empty working directory: it can only answer, and cannot read or change your files.
- Only this app's pages can call it. Scripts inside an opened HTML document run on the app's origin and could also ask questions.

## HTML documents

HTML files are meant to be self-contained documents you wrote or generated yourself, such as tech docs from an agent.

- The file is shown in a frame at a fixed width of 1024px, so comment positions stay stable; zoom scales the whole frame. The frame grows to the document's full height, and the viewer scrolls it.
- **The document's scripts run, and it can load remote resources** (CDN scripts, stylesheets, fonts, images). It runs on the app's own origin, so its scripts could read the app's saved reviews. Only open HTML you trust.
- Text comments store the quote, the text around it, the heading path (`Architecture › Storage › Retention`) and the nearest element `id`. Each time the file is opened the quote is found again, so highlights follow layout changes. A comment whose quote can no longer be found (usually because a script changed the text) is listed as **Not found in document** and still goes into the prompt.
- Region comments store a rectangle in document pixels at 1024px width, plus the heading path and the `id` of the element under its center.
- `#anchor` links scroll the viewer; other links open in a new tab.
- The sidebar (`S`) shows the document's headings with a comment count for each section.

## Deploy to Vercel

The app is a static site: `vercel.json` builds it with `npm run build` and serves `dist/`. Import the repo in Vercel (or run `vercel --prod`); no settings are needed.

- **Pick the final domain before people use it.** Saved reviews belong to the exact origin. Each preview deployment URL has its own, empty storage, and moving from `*.vercel.app` to a custom domain later leaves every existing review behind on the old one (review files still work).
- **Keep the project static.** Do not add an `api/` folder, Vercel Functions, Web Analytics or Speed Insights. The privacy guarantee is that documents never leave the browser; the app's Content-Security-Policy only allows requests to its own origin, so a server function there would be the one place data could be sent. (`/frame.html`, where HTML documents run, has a permissive policy by design.)
- **Security headers** come from `vercel.json`: the Content-Security-Policy for the app (every path except `/frame.html`, which has its own permissive policy) (also embedded in the built HTML as a meta tag, so `npm start` gets the same policy), no framing by other sites, `nosniff`, no referrer, and no camera/microphone/location access. Edit the policy only in `vercel.json`.

## Data

- Reviews autosave to the browser's `localStorage` for the app origin, keyed by the file's SHA-256. Only comments and file identities are stored, never document contents. Saved reviews are listed (and deletable) on the start screen.
- After the first comment the app asks the browser to keep its storage (`navigator.storage.persist()`). Without that, browsers may clear it under disk pressure, and Safari clears it after 7 days without a visit.
- **Save to file** (`⌘/Ctrl+S`) writes `<file name>.review.json`, a portable copy of the review. **Open review file…** on the start screen (or dropping the file there) loads it back into any browser; opened files are validated and only known fields are kept. Version 2 review files can hold PDF or HTML reviews; version 1 files (PDF only) still open.
- In Chromium, IndexedDB also stores a reference (not the contents) to each reviewed file, so saved reviews reopen it in one click.
- If the reviewed file changes on disk, the review stops and asks whether to start a new review or keep reviewing the originally loaded snapshot; the latter is recorded as a warning in the prompt.

## Agent prompt

The prompt contains, in order:

1. The task: revise the source the PDF was generated from, then regenerate the PDF.
2. The PDF's identity: name, SHA-256 hash, size and page count, with a check-the-hash instruction.
3. How to locate comments: page, quote (and how PDF extraction can differ from the source), before/after context for repeated quotes, visual lines, normalized rectangles, region comments.
4. Warnings, if a file changed during the review.
5. Every comment in document order: location, quote, context and the reviewer's text.
6. What to do when finished.
7. A machine-readable JSON copy (`schemaVersion: 1`) of the same data.

For HTML, the prompt identifies the file as HTML, locates comments by section, quote, context, element id and pixel rectangle, marks comments that were not found, and suggests a 1024px headless-browser screenshot for region comments.

For PDFs, coordinates are page-relative `[left, top, right, bottom]`, 0–1, origin top-left of the page as displayed (PDF `/Rotate` applied), independent of zoom. Text selections store one rectangle per visual line. Visual lines group PDF text items by vertical position, numbered from the top of the page; side-by-side columns can share a number, and they are `null` when unreliable. Region comments never carry a quote or line numbers.

## Security

PDFs are untrusted input. PDF.js runs with XFA off, annotations not rendered (no links, forms or scripts), and all helper assets served from this origin. The production build ships a Content-Security-Policy that forbids network access outside the app's own origin. The servers bind to `127.0.0.1` only.

HTML documents are **trusted** input: they are written into `/frame.html`, a same-origin frame (`sandbox="allow-scripts allow-same-origin"`) that `vercel.json` serves with its own permissive Content-Security-Policy, so their scripts and remote resources work. The app itself keeps the strict policy. Because the frame shares the app's origin, a document's scripts can read the app's storage and send data anywhere; review only HTML you trust.
