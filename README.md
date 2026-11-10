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
npm run test:dist     # the built single-file artifact (whatever is currently in dist/)
npm run test:all      # baseline, app, a credential-blanked build, then that built artifact
npm run check         # syntax-check src/main.js
```

`test:all` builds with `npm run build:test` rather than `npm run build`: the real
build inlines whatever Supabase credentials are in `.env`, and since sign-in is
required whenever Supabase is configured (see Cloud sync status below), a real
build can only pass the artifact through the gate with a live network
connection, which the suite deliberately has none of. `build:test` blanks the
two `VITE_SUPABASE_*` vars for that one build, matching how the other two
stages already run with Supabase "configured absent". Run a plain `npm run
build` yourself when you want the real distributable.

`test:baseline` runs the same suite against `reference/mindmap-tool.original.html`,
the untouched pre-refactor file. Keeping both green is what makes the
restructuring verifiable rather than hopeful.

The suite never touches the network: remote requests are refused by the jsdom
resource loader, `fetch` is blocked, and the Supabase env values are defined
empty when the module graph is bundled for tests.

Two jsdom limitations shape the harness, and are worth knowing before adding
tests. There is **no layout** — `offsetTop`/`offsetHeight` are always 0, so
nothing may assert on pixel offsets — and **no module execution**, so
`src/main.js` is bundled to a classic script with esbuild before it is handed
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

Whenever Supabase is configured (`.env` has both `VITE_SUPABASE_*` values), a
full-screen gate blocks the app until someone is signed in -- there's no local
fallback while it's up. The gate cycles through sign in, create account
(email-verified once via Supabase's "Confirm email" setting), forgot
password, and reset password; account settings (change password, sign out)
live behind the "Account" button in the sidebar once signed in. Leave the
env vars blank and the gate never appears, which is how local-only use and
the test suite both run.

Sign-in itself works (Supabase email/password), but writes fail with
`42501 new row violates row-level security policy`. Postgres is not receiving
JWT claims on live requests, so `auth.uid()` resolves NULL despite a valid
session — an issue specific to Supabase's newer asymmetric (ES256) JWT signing
keys, not a fault in the schema, the policies, or this code. Parked.

## Layout

```
index.html        markup and the module entry tag
src/styles.css    all styling
src/main.js       entry point: init order and nothing else
tests/            jsdom characterization suite
tools/            check.mjs (parse + module graph), prune-imports.mjs
reference/        the pre-refactor single file, kept for A/B testing
```

`src/` in rough dependency order — each layer uses the ones above it:

| Module | What it owns |
| --- | --- |
| `constants.js` | Values fixed at runtime: keys, palettes, sizes, hotkeys, built-in schemas |
| `util.js` | Ids, HTML escaping and sanitising, rich-text coercion, URL handling |
| `state.js` | All shared mutable state, in one object |
| `dom.js` `toast.js` `clipboard.js` | Element cache, status line, copy-to-clipboard |
| `boards.js` | Document model: notebooks, pages, page ordering |
| `blockTypes.js` | The block-type library, and `fieldVal`/`setFieldVal` |
| `storage.js` `cloud.js` `exportImport.js` | The four backends, Supabase, backup files |
| `pageLoader.js` | Staged loading: open page first, the rest in the background; pending pages are never saved |
| `nodes.js` `rows.js` `connections.js` `collapse.js` | Blocks, their rows, the arrows, subtree folding |
| `connStyle.js` `connRoutes.js` `connPopover.js` | A connection's look, the elbow/curve geometry, its style popover and label editor |
| `selection.js` `view.js` `history.js` | Selection, pan/zoom, undo/redo |
| `customFields.js` `nodeElement.js` `render.js` | Schema-driven fields, one block's DOM, drawing the page |
| `canvas.js` `keyboard.js` `toolbar.js` | Pointer gestures, shortcuts and paste, the add buttons |
| `sidebar.js` `notebookSwitcher.js` `pageMenu.js` `notebookMenu.js` `search.js` `picker.js` `designer.js` | The surrounding UI |

### Flowchart shapes and text labels

Six shapes (rectangle, rounded box, ellipse, diamond, parallelogram,
terminator) are one hardcoded block type, `type: "shape"`, told apart by
`node.shape`, with `node.border` for the outline and `node.color` for the fill.
A text label is `type: "label"`. Both keep their text in `node.title`, so
search, export and the cloud `title` column need nothing extra; `shape` and
`border` ride in `fields.__builtin` for cloud (`CLOUD_BUILTIN_EXTRAS`). The
quick bar, hotkeys and connection picker address the shapes as the pseudo-ids
in `SHAPE_SPAWN` (`shape_rect`, ...), which `createNode()` turns into a
`shape` block. Connections meet a shape's real outline (`edgePoint()` in
`connections.js`); the geometry constants in `constants.js` are shared with the
drawing code, so change them together. Like header and image, these are not
listed in the Block Designer. The quick bar is split into collapsible Blocks and
Shapes sections; the folded state is per device, in localStorage.

### Connectors

Every connection is drawn straight, aimed at the other block's centre and
clipped at its edge, unless it says otherwise. It can say otherwise with
optional properties on the connection object, **stored only when they differ
from the default** (so a plain connection is still the same six keys, in board
files, exports, undo snapshots and the cloud alike):

| Property | Values | Absent means |
| --- | --- | --- |
| `route` | `"elbow"`, `"curve"` | straight |
| `startArrow` / `endArrow` | `true` / `false` | no start arrow / an end arrow |
| `dash` | `"dashed"`, `"dotted"` | solid |
| `color` | `"#rrggbb"` | the grey `#9aa1ab` |
| `width` | number, 0.5 to 12 | 2 |
| `fromSide` / `toSide` | `"t"` `"r"` `"b"` `"l"` | automatic |

`connStyle.js` is the only place that decides what is valid
(`sanitizeConnStyle`); it runs on everything read back, so a hand-edited or
damaged file draws as defaults instead of reaching an SVG attribute. Use
`setConnStyle(conn, patch)` to change one, which keeps the object canonical.
A link between two whole `shape` blocks starts as `route: "elbow"`; nothing
else changes how an existing connection looks.

Straight connections are a `<line>`, exactly as before. Elbows and curves are a
`<path>` between the *side midpoints* of the two blocks (`connRoutes.js`: pure
geometry, tested with explicit rectangles): an unpinned end takes the side
facing the other block, a pinned one its `fromSide`/`toSide`, and the line leaves
and arrives perpendicular to it. Pinned sides attach at the real outline's
midpoint (a diamond's vertex), via `sidePoint()` and `edgePoint()`. Row ends
(`fromItem`/`toItem` set) keep their own attach rule and ignore sides. There is
no obstacle avoidance.

Arrowheads are SVG markers, one per colour and end (a marker cannot take its
line's colour in every browser); the default grey end arrow is still the static
`#arrowHead` in `index.html`. The thin visible stroke and the fat transparent
click target share one route. `connections.js` keeps the drawn elements in
`connEls`, so dragging a block updates only the connections attached to it, in
place.

Selecting a connection opens a style popover at its midpoint and shows a handle
on each whole-block end. Every block has four *side dots* (hover or select
it): drag from one to leave by that side, drop on one to arrive there, or drag
an end handle onto one to re-pin an existing connection. A label is edited in
place (double-click, or the popover's Label button), not through `prompt()`.

Cloud: the `connections` table has no column for any of this and cannot be
migrated from the client, so a styled connection's label column holds a marked
JSON envelope (`packConnLabel` / `unpackConnLabel` in `cloud.js`); an unstyled one
still stores its plain label, and an old row loads with default styling.

### The sidebar: focus mode

The sidebar shows **one notebook's level at a time** instead of the whole nested
tree. From the top: the notebook switcher button, a breadcrumb up the viewed
notebook's chain, the page filter, then that notebook's direct sub-notebooks as
single compact rows (name, page count, chevron) above its pages.

`viewNotebookId` (in `sidebar.js`) is the notebook being viewed. It is **view
state only**: never stored, never in `state.js`, and changing it touches no
notebook or page and queues no save, so the stored data model (including
`collapsed`, which the view no longer reads) is exactly what it was. It follows
the open page: `renderBoardList()` compares `state.currentBoardId` with the page
it last followed and, when it changed (a click, a search jump, a favorite, a new,
duplicated or deleted page, a load), views that page's notebook. Anything that
changes the open page therefore only has to re-render the list, which it must do
to move the highlight anyway. Choosing a notebook (a row, a crumb, the switcher)
only changes the view; it never opens a page.

- **Switcher** (`notebookSwitcher.js`): a panel under the notebook button listing
  every notebook as an indented tree, with the favorites (pinned pages from every
  notebook) as its first section. It closes on Escape (via `closeSidebarPopups()`
  in `keyboard.js`, so Escape does not also deselect blocks) and on a click
  outside. It is re-rendered with every list render and merely hidden while
  closed.
- **Page filter**: narrows the list by page name (case-insensitive substring) and,
  while non-empty, searches the *whole subtree* of the viewed notebook, labelling
  results from sub-notebooks. It is separate from the global search (Shift+F),
  clears on Escape, and is reset by anything that changes the viewed notebook. A
  page opened from the filtered results does not move the view; a page opened
  from elsewhere that the filter cannot show clears the filter and moves it.
  Dragging is off while filtering.
- **New things**: `+ New page` and `+ Notebook` act on the viewed notebook (the
  latter makes a sub-notebook); the switcher's `+ New top-level notebook` makes a
  top-level one and views it. `newNotebook(undefined)` means "in the viewed
  notebook", `newNotebook(null)` means "top level". A new notebook is named in
  place, in its row or, for the viewed one, in the last crumb.
- **Moving**: pages reorder by dragging; a page dropped on a sub-notebook row or an
  ancestor crumb moves there. A notebook dragged onto the middle of another row
  nests inside it, onto the top/bottom edge reorders, onto an ancestor crumb moves
  up. **Move to...** in the page and notebook menus (`openMoveToPicker`) reaches
  every other notebook; it greys out a notebook's own subtree, so a notebook can't
  be moved into itself (the move functions refuse as well).
- **Selection**: a multi-selection only ever holds pages currently on screen; a
  page that leaves the list (another notebook, a filter, a move) drops out of it,
  so the bulk-delete bar can't delete pages you can't see.
- **Keyboard**: crumbs, rows, the switcher, favorites and the filter are tab
  stops; Enter/Space activate a row, the arrows walk the rows, and the Menu key or
  Shift+F10 opens a row's menu. Re-rendering puts focus back on the row's
  replacement.

An import brings its notebooks in alongside the existing ones; they appear in the
switcher but the view stays where it was.

### Two things to know before editing

**Shared state goes through `state.js`.** ES modules make an imported binding
read-only for the importer, so a module that needs to reassign
`currentBoardId` cannot do it through a plain import. Reading and writing
through one object avoids that, and makes it obvious at the call site that
something is shared rather than local. State belonging to a single module
(the designer's selected type, the picker's filter, the undo stacks) stays in
that module.

**Listeners are attached by explicit `init*()` functions,** called in order
from `main.js`, not by bare statements at module top level — which would run
whenever a module happened to be imported. A listener that is never attached
raises no error, so this is the easiest thing to break silently here.
