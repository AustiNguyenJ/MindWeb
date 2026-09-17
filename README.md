# Mind Map Studio

A notebook-and-canvas mind-mapping tool. Notebooks hold pages, pages hold
blocks, and blocks connect to each other — including from individual rows of a
list, a week's ticket, or a repeating-row group.

Originally a single 4,596-line HTML file; this repo is that app restructured
into a real project without changing how it behaves.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # -> dist/mindmap-tool.html, one portable self-contained file
npm run preview    # serve the built file
```

The build deliberately produces **one standalone HTML file**, the way the app
has always been distributed — open it from anywhere, no server required. The
only external reference left in it is the Google Fonts stylesheet.

Use `npm run dev` rather than opening `index.html` off disk: the "Connect
folder" backend uses the File System Access API, which browsers restrict on
`file://` URLs.

## Configuration

Copy `.env.example` to `.env` and fill in the Supabase values to enable the
cloud backend. Leave them blank and the cloud backend stays switched off.

> Vite inlines every `VITE_*` value into the built bundle, so these are visible
> to anyone who opens the page. That is fine for a *publishable* key, which is
> gated by row-level security — but a real secret (`sb_secret_…`, a service-role
> key) must never go in a `VITE_*` variable.

## Storage backends

Chosen at load time, in this order:

| Backend  | When it's used                        | Where data goes                                    |
| -------- | ------------------------------------- | -------------------------------------------------- |
| `folder` | after you click **Connect folder**    | `<your folder>/saved-boards/*.json`, one per page   |
| `cloud`  | signed in to Supabase, no folder      | Supabase (notebooks/boards/nodes/connections)       |
| `app`    | `window.storage` exists (Claude host) | that host's key/value store                         |
| `memory` | nothing else available                | nowhere — Export/Import still work                  |

Two safety behaviours worth knowing about, both covered by tests:

- **Damaged payloads are never overwritten.** A stored page that fails to parse
  (or is blank) is treated as damaged, not as an empty page. Saving for that
  page is paused and you are asked once before anything clobbers it.
- **Orphaned block types are rebuilt.** If the block-type library is lost while
  page data survives, the schema is reconstructed by inspecting the surviving
  field data, so the blocks render and stay editable.

## Testing

Tests boot the real page in jsdom and drive it through the DOM, so they
exercise the app as shipped rather than its internals.

```bash
npm test              # the app (index.html + src/)
npm run test:baseline # the untouched original, for comparison
npm run test:both     # both, in order
npm run test:dist     # the built single-file artifact
npm run test:all      # baseline, app, build, then the built artifact
npm run check         # syntax-check src/app.js
```

`test:baseline` runs the same suite against `reference/mindmap-tool.original.html`,
the untouched pre-refactor file. Keeping both green is what makes the
restructuring verifiable rather than hopeful.

The suite never touches the network: remote requests are refused by the jsdom
resource loader, `fetch` is blocked, and the Supabase env values are defined
empty when the module graph is bundled for tests.

Two jsdom limitations shape the harness, and are worth knowing before adding
tests. There is **no layout** — `offsetTop`/`offsetHeight` are always 0, so
nothing may assert on pixel offsets — and **no module execution**, so
`src/app.js` is bundled to a classic script with esbuild before it is handed
to jsdom. jsdom also implements neither `isContentEditable` nor focusable
`contenteditable` divs, so `focus()` calls are tracked instead.

## Known bugs

Found while writing the characterization suite. Both are pre-existing, both are
pinned by tests that assert the current (wrong) behaviour, so fixing them is a
deliberate act rather than an accident.

1. **Backspace on an empty list row deletes the whole list block.** The row's
   handler removes the row and re-renders, which destroys the focused input and
   drops `document.activeElement` to `<body>`. The same keydown keeps bubbling
   to the document handler, which now sees "not in a text field" with the block
   still selected, and deletes it. Fix: `stopPropagation()` in the row handler.

2. **Note, question and ticket body text is not searchable.** `nodeHaystack()`
   indexes `title`, `body`, `items`, `tickets` and an explicit list of
   top-level ticket fields — but never `bodyHtml`. Those three types render
   through the custom-field path and write their body to the top-level
   `bodyHtml` property, so `node.body` is never populated and the text is
   invisible to search. Custom block types are unaffected, because their values
   land in `node.fields`. Fix: read through `fieldVal(node, key)` instead of
   walking `node.fields` directly.

Also cosmetic: `.bd-btn.primary:hover` references `--accent-strong`, which is
never defined, so that hover rule does nothing. `blankSubfield()` and
`onlySelected()` are dead code, as is the `.tk-fields` wiring in
`nodeElement()` — ticket now renders through the schema path.

## Cloud sync status

Sign-in works (Supabase email magic link), but writes fail with
`42501 new row violates row-level security policy`. Postgres is not receiving
JWT claims on live requests, so `auth.uid()` resolves NULL despite a valid
session — an issue specific to Supabase's newer asymmetric (ES256) JWT signing
keys, not a fault in the schema, the policies, or this code. Parked.

## Layout

```
index.html                         markup and the module entry tag
src/styles.css                     all styling
src/app.js                         the application
tests/                             jsdom characterization suite
reference/mindmap-tool.original.html   the pre-refactor file, kept for A/B testing
```
