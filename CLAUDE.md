# Working on this codebase

Mind Map Studio, restructured from a single 4,596-line HTML file into an
ES-module project. Read `README.md` first for the module map.

## Always

Run `npm run verify` before calling anything done. It is three gates and each
catches something the others cannot:

```bash
npm run verify   # check + lint + test
```

- `npm run check` — parses every file **and bundles the entry**. Parsing alone
  cannot see a module importing a name its neighbour never exported.
- `npm run lint` — ESLint `no-undef`. Bundling cannot see a name nobody
  imported: esbuild treats it as a global and emits a bundle that fails only
  at runtime. This has already caught one real break.
- `npm test` — the characterization suite, in jsdom.

For anything touching storage, the build, or the entry point, run the full
gate, which also exercises the shipped single-file artifact:

```bash
npm run test:all   # baseline, app, build, built artifact
```

## The test suite is a characterization suite

The 115 tests were written against the original file *before* any
restructuring, and the same test bodies run against both. `npm run
test:baseline` runs them against `reference/mindmap-tool.original.html`.
Keeping both green is what makes a change to this code verifiable rather than
hopeful. Do not delete that reference file.

Tests drive the real page through the DOM rather than calling internals, so
they keep working across refactors. Two jsdom limits shape them:

- **No layout.** `offsetTop` / `offsetHeight` are always 0, so never assert on
  pixel offsets or anything derived from `measureListOffsets`.
- **No module execution.** `src/main.js` is bundled to a classic script with
  esbuild before jsdom sees it. jsdom also implements neither
  `isContentEditable` nor focusable `contenteditable` divs, so the harness
  tracks `focus()` calls instead.

The suite never touches the network: remote requests are refused, `fetch` is
blocked, and Supabase is configured absent.

## Data-model traps

These have each caused a real bug. They are pinned by tests.

- **Built-in types keep their values in top-level node properties, not in
  `node.fields`.** `bodyHtml`, `ticketNo`, `link`, `assigned` and `customer`
  are in `BUILTIN_KEYS`. Always read and write through `fieldVal(node, key)` /
  `setFieldVal(node, key, v)`. Walking `node.fields` directly silently misses
  every built-in field — which is exactly why note, question and ticket body
  text is currently unsearchable (see Known bugs in the README).
- **Connections need `fromItem` / `toItem` set to explicit `null`** when the
  link is not from a specific row, not left off the object.
- **Row keys.** List and week rows are numeric indices; repeating-group rows
  are the string `"g:<fieldKey>:<rowIdx>"`, so the two cannot collide.
  Inserting or removing a row must shift every connection pointing past it.
- **Board data and the block-type library are stored separately.** Losing the
  library while board data survives breaks rendering for every block of that
  type. `reconstructMissingTypes()` rebuilds a working schema from surviving
  field data; keep it working if you touch storage.
- **A damaged stored payload is never overwritten.** One that exists but will
  not parse is treated as damaged, not empty, and saving for that page pauses
  until the user agrees.

## Conventions

- Work in small, verified steps. One change, check it, then the next.
- When moving code between modules, move the text rather than retyping it, and
  take its comments with it — the comments here carry the reasoning.
- Keep the `state.js` / explicit-`init*()` rules described in the README.
- Cloud sync is parked on a Supabase-side JWT issue; see the README before
  spending time there.
