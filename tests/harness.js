/* Test harness for Mind Map Studio.
 *
 * Loads a full HTML entry point into jsdom, runs its scripts, waits for the
 * app's async init() to finish, and hands back the window plus a few helpers
 * for driving the UI.
 *
 * The point of this harness is that the SAME test bodies run against the
 * original single-file app and against the restructured multi-file app, so
 * the suite is a direct A/B equivalence proof rather than two separate sets
 * of assertions.
 *
 * jsdom gaps that must be stubbed before the app's script evaluates:
 *   - alert / confirm / prompt      (jsdom throws "not implemented")
 *   - document.execCommand          (not implemented; used for rich text)
 *   - navigator.clipboard           (absent)
 *   - URL.createObjectURL           (absent; used by export)
 *   - setPointerCapture             (absent; used by every drag)
 *   - elementFromPoint              (needs layout; used by connection drops)
 *   - scrollIntoView                (absent)
 * Deliberately NOT stubbed, because their absence is what selects the
 * in-memory backend and keeps tests hermetic:
 *   - window.showDirectoryPicker  -> FS_SUPPORTED false -> no folder backend
 *   - window.storage              -> no app backend      -> backend "memory"
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { JSDOM, ResourceLoader, VirtualConsole } from "jsdom";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..");

/** Serves local files, refuses anything remote (fonts + the Supabase CDN),
 *  so the suite never touches the network and stays deterministic. */
class LocalOnlyLoader extends ResourceLoader {
  fetch(url, options) {
    if (/^https?:/i.test(url)) return null;
    return super.fetch(url, options);
  }
}

export function waitFor(fn, { timeout = 5000, interval = 5, label = "condition" } = {}) {
  const start = Date.now();
  return new Promise((res, rej) => {
    (function poll() {
      let value;
      try { value = fn(); } catch { value = false; }
      if (value) return res(value);
      if (Date.now() - start > timeout) return rej(new Error(`waitFor timed out: ${label}`));
      setTimeout(poll, interval);
    })();
  });
}

/** Let queued microtasks/timers drain (the app debounces saves and history). */
export function tick(ms = 0) {
  return new Promise((r) => setTimeout(r, ms));
}

function installStubs(window) {
  const rec = { alerts: [], confirms: [], prompts: [], copied: [], blobs: [], consoleErrors: [] };

  window.alert = (msg) => { rec.alerts.push(String(msg)); };
  // Default to "yes" so destructive flows proceed; tests override per case.
  window.confirm = (msg) => { rec.confirms.push(String(msg)); return rec.confirmReply !== false; };
  window.prompt = (msg, def) => { rec.prompts.push(String(msg)); return rec.promptReply ?? def ?? ""; };

  // jsdom does not treat a contenteditable <div> as a focusable area, so
  // document.activeElement never becomes one. Record focus() calls so the
  // execCommand stub can still find the editable region the app aimed at.
  const nativeFocus = window.HTMLElement.prototype.focus;
  window.HTMLElement.prototype.focus = function (...args) {
    window.__focused = this;
    return nativeFocus.apply(this, args);
  };

  window.document.execCommand = (cmd, _ui, value) => {
    // Enough fidelity for the paths the app exercises: insertText/insertHTML
    // write into the focused editable element.
    // jsdom does not implement isContentEditable either, so test the
    // attribute the way the app's own isTextEntry() does.
    const editable = (n) => {
      if (!n) return false;
      if (n.isContentEditable === true) return true;
      const a = n.getAttribute && n.getAttribute("contenteditable");
      return a === "" || a === "true";
    };
    const active = window.document.activeElement;
    const sel = editable(active) ? active : window.__focused;
    if (editable(sel)) {
      if (cmd === "insertText") sel.textContent += value ?? "";
      else if (cmd === "insertHTML") sel.innerHTML += value ?? "";
    }
    return true;
  };

  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: (t) => { rec.copied.push(String(t)); return Promise.resolve(); } },
  });

  window.URL.createObjectURL = (blob) => { rec.blobs.push(blob); return "blob:mock/" + rec.blobs.length; };
  window.URL.revokeObjectURL = () => {};

  const proto = window.Element.prototype;
  proto.setPointerCapture = function () {};
  proto.releasePointerCapture = function () {};
  proto.hasPointerCapture = function () { return false; };
  proto.scrollIntoView = function () {};

  // Layout-dependent hit testing: tests set `window.__hitTarget` to choose
  // what a pointer drop lands on, since jsdom has no layout.
  window.document.elementFromPoint = () => window.__hitTarget ?? null;

  return rec;
}

/** Stand-in for the window.storage object the app gets when it runs inside a
 *  Claude artifact. Backed by a Map so a test can seed it and inspect it. */
function installFakeStorage(window, seed) {
  const map = new Map(Object.entries(seed || {}));
  window.storage = {
    get: (k) => Promise.resolve(map.has(k) ? { value: map.get(k) } : null),
    set: (k, v) => { map.set(k, v); return Promise.resolve(true); },
    delete: (k) => { map.delete(k); return Promise.resolve(true); },
  };
  window.__storageMap = map;
}

/** Which entry the suite exercises. Defaults to the untouched original so a
 *  bare `npm test` measures the baseline; the refactored app is checked by
 *  running the same suite with MINDMAP_ENTRY=index.html. */
export const DEFAULT_ENTRY = process.env.MINDMAP_ENTRY || "reference/mindmap-tool.original.html";

/**
 * Boot an app entry point in jsdom.
 * @param {string} entry HTML file path, relative to the repo root.
 * @param {object} [opts]
 * @param {object} [opts.storage] seed for a fake window.storage; supplying it
 *        selects the "app" backend instead of the in-memory fallback.
 */
export async function createApp(entry = DEFAULT_ENTRY, opts = {}) {
  const file = resolve(ROOT, entry);
  const html = readFileSync(file, "utf8");

  const virtualConsole = new VirtualConsole();
  const consoleErrors = [];
  virtualConsole.on("jsdomError", (e) => consoleErrors.push(e.message));

  const dom = new JSDOM(html, {
    url: pathToFileURL(file).href,
    runScripts: "dangerously",
    resources: new LocalOnlyLoader(),
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.__stubRecorder = installStubs(window);
      if (opts.storage) installFakeStorage(window, opts.storage);
    },
  });

  const { window } = dom;
  const rec = window.__stubRecorder;
  rec.consoleErrors = consoleErrors;

  // init() is async and exposes no completion signal, but its final act is
  // updateStorageBar(), which replaces the placeholder "Checking…" label.
  await waitFor(
    () => {
      const label = window.document.querySelector("#storageBar .sb-label");
      return label && label.textContent.trim() !== "" && !/Checking/.test(label.textContent);
    },
    { label: "app init to finish", timeout: 8000 }
  );

  return { dom, window, document: window.document, rec, ...helpers(window) };
}

function helpers(window) {
  const { document } = window;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  const fire = (el, type, init = {}) =>
    el.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, ...init }));

  return {
    $, $$,
    /** Click, as a real user click (bubbles, cancelable). */
    click: (el) => fire(el, "click"),
    /** Pointer sequence. jsdom has no PointerEvent, but listeners are keyed
     *  on event type, so a MouseEvent of the right type dispatches fine. */
    pointer: (el, type, init = {}) => fire(el, type, init),
    /** Set an input's value and notify the app, the way typing would. */
    type: (el, value) => {
      el.value = value;
      el.dispatchEvent(new window.Event("input", { bubbles: true }));
    },
    /** Type into a contenteditable region. */
    typeRich: (el, html) => {
      el.innerHTML = html;
      el.dispatchEvent(new window.Event("input", { bubbles: true }));
    },
    blur: (el) => el.dispatchEvent(new window.Event("blur", { bubbles: false })),
    focus: (el) => { el.focus(); el.dispatchEvent(new window.Event("focus", { bubbles: false })); },
    key: (target, key, init = {}) =>
      (target ?? document).dispatchEvent(
        new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })
      ),
    /** Nodes currently rendered on the canvas. */
    nodes: () => $$("#canvasInner .node"),
    nodeTypes: () => $$("#canvasInner .node").map((n) => n.className.match(/type-(\S+)/)?.[1]),
    /** Visible connection lines (the drawn ones, not the fat hit targets). */
    connCount: () => $$("#connSvg line.visible").length,
    /** Sidebar page rows. */
    pages: () => $$(".board-item"),
    notebookNames: () => $$(".nb-name").map((n) => n.textContent.trim()),
  };
}

/** Trigger the app's Export and read back the JSON it would have downloaded.
 *  Relies on the stubbed URL.createObjectURL capturing the Blob. */
export async function exportJson(app) {
  const before = app.rec.blobs.length;
  app.click(app.$("#exportBtn"));
  await waitFor(() => app.rec.blobs.length > before, { label: "export blob" });
  const blob = app.rec.blobs[app.rec.blobs.length - 1];
  const text = typeof blob.text === "function"
    ? await blob.text()
    : await new Promise((res) => {
        const fr = new app.window.FileReader();
        fr.onload = () => res(fr.result);
        fr.readAsText(blob);
      });
  return JSON.parse(text);
}
