import { describe, it, expect } from "vitest";
import { createApp, DEFAULT_ENTRY } from "./harness.js";

// drag-to-resize panels are new, app-only behavior -- the untouched original
// has no resize handles
const onBaseline = DEFAULT_ENTRY.includes("original");

function drag(app, handle, fromX, toX) {
  app.pointer(handle, "pointerdown", { button: 0, clientX: fromX, clientY: 0 });
  app.pointer(handle, "pointermove", { button: 0, clientX: toX, clientY: 0 });
  app.pointer(handle, "pointerup", { button: 0, clientX: toX, clientY: 0 });
}

// jsdom refuses real localStorage for a file:// origin (the "opaque origins"
// rule), which is exactly how this harness loads the app -- so persistence
// is verified against a stand-in storage installed after boot, around the
// drag, rather than the app's own (file://, thus throwing) localStorage.
function stubLocalStorage(app) {
  const map = new Map();
  const fake = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
  Object.defineProperty(app.window, "localStorage", { configurable: true, value: fake });
  return fake;
}

describe.skipIf(onBaseline)("panel resize handles", () => {
  it("adds one handle for the sidebar and one per block-designer-style modal body", async () => {
    const app = await createApp();
    const handles = app.$$(".panel-resize-handle");
    const bdBodyCount = app.$$(".bd-body").filter(
      (b) => b.querySelector(":scope > .bd-left") && b.querySelector(":scope > .bd-right")
    ).length;
    expect(handles.length).toBe(1 + bdBodyCount);
  });

  it("resizes the sidebar on drag and persists the width to localStorage", async () => {
    const app = await createApp();
    const fake = stubLocalStorage(app);
    const sidebar = app.$("#sidebar");
    const handle = app.$(".panel-resize-handle");

    drag(app, handle, 0, 300);

    expect(sidebar.style.width).toBe("300px");
    const stored = JSON.parse(fake.getItem("mindmap:panelWidths"));
    expect(stored.sidebar).toBe(300);
  });

  it("clamps the sidebar width to its max and persists the clamped value", async () => {
    const app = await createApp();
    const fake = stubLocalStorage(app);
    const handle = app.$(".panel-resize-handle");

    drag(app, handle, 0, 5000);

    expect(app.$("#sidebar").style.width).toBe("480px");
    const stored = JSON.parse(fake.getItem("mindmap:panelWidths"));
    expect(stored.sidebar).toBe(480);
  });

  it("resizes the Block Designer's left column independently of the sidebar", async () => {
    const app = await createApp();
    const fake = stubLocalStorage(app);
    app.click(app.$("#designBlocksBtn"));
    const bdLeft = app.$("#bdOverlay .bd-left");
    const bdHandle = bdLeft.nextElementSibling;
    expect(bdHandle.classList.contains("panel-resize-handle")).toBe(true);

    drag(app, bdHandle, 0, 220);

    expect(bdLeft.style.width).toBe("220px");
    expect(app.$("#sidebar").style.width).not.toBe("220px");
    const stored = JSON.parse(fake.getItem("mindmap:panelWidths"));
    expect(stored["bd:bdOverlay"]).toBe(220);
  });
});
