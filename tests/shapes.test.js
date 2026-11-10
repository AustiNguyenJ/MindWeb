import { describe, it, expect, beforeEach } from "vitest";
import { createApp, exportJson, waitFor, tick, DEFAULT_ENTRY } from "./harness.js";

// Flowchart shapes, the text label and the sectioned quick bar exist only in
// the restructured app; the untouched original has none of them.
const d = describe.skipIf(DEFAULT_ENTRY.includes("original"));

const SHAPES = {
  shape_rect: { kind: "rect", key: "r" },
  shape_rounded: { kind: "rounded", key: "b" },
  shape_ellipse: { kind: "ellipse", key: "o" },
  shape_diamond: { kind: "diamond", key: "d" },
  shape_parallelogram: { kind: "parallelogram", key: "p" },
  shape_terminator: { kind: "terminator", key: "s" },
};

let app;
beforeEach(async () => { app = await createApp(); });

const bar = (id) => app.$(`.add-btn[data-type="${id}"]`);
const blur = () => app.document.activeElement?.blur?.();
const pageNodes = async () => (await exportJson(app)).boards[0].nodes;
const shapeNodes = async () => (await pageNodes()).filter((n) => n.type === "shape");

function connect(fromNode, toNode) {
  app.pointer(fromNode.querySelector(".conn-handle"), "pointerdown", { button: 0 });
  app.window.__hitTarget = toNode;
  app.pointer(app.document, "pointerup", { button: 0 });
  app.window.__hitTarget = null;
}

function importFile(payload) {
  const file = new app.window.File([JSON.stringify(payload)], "backup.json", { type: "application/json" });
  const input = app.$("#jsonFileInput");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new app.window.Event("change", { bubbles: true }));
}

/** Drag a node's resize handle by (dx, dy) screen pixels (view scale is 1). */
function resize(nodeEl, dx, dy) {
  app.pointer(nodeEl.querySelector(".resize-handle"), "pointerdown", { button: 0, clientX: 0, clientY: 0 });
  app.pointer(app.document, "pointermove", { clientX: dx, clientY: dy });
  app.pointer(app.document, "pointerup", { button: 0, clientX: dx, clientY: dy });
}

d("shapes: spawning", () => {
  for (const [id, { kind, key }] of Object.entries(SHAPES)) {
    it(`${kind}: spawns from its bar button`, async () => {
      expect(bar(id)).not.toBeNull();
      app.click(bar(id));
      const el = app.$(`.node.type-shape.shape-${kind}`);
      expect(el).not.toBeNull();
      await tick(20);
      const [n] = await shapeNodes();
      expect(n.shape).toBe(kind);
      expect(n.border).toBe(true);
      expect(n.color).toBe("#ffffff");
    });

    it(`${kind}: spawns from its hotkey (${key})`, async () => {
      blur();
      app.key(null, key);
      expect(app.$$(`.node.type-shape.shape-${kind}`)).toHaveLength(1);
      await tick(20);
      expect((await shapeNodes())[0].shape).toBe(kind);
    });
  }

  it("focuses the new shape's text field", () => {
    app.click(bar("shape_ellipse"));
    expect(app.document.activeElement.classList.contains("diagram-input")).toBe(true);
  });

  it("has no header, title input, or collapse control on a shape", () => {
    app.click(bar("shape_diamond"));
    const el = app.$(".node.type-shape");
    expect(el.querySelector(".node-header")).toBeNull();
    expect(el.querySelector(".collapse-btn")).toBeNull();
    expect(el.querySelector("input.node-title")).toBeNull();
    expect(el.querySelector(".resize-handle")).not.toBeNull();
    expect(el.querySelector(".conn-handle")).not.toBeNull();
  });

  it("draws ellipse, diamond and parallelogram as SVG and the rest as a CSS box", () => {
    for (const id of ["shape_ellipse", "shape_diamond", "shape_parallelogram", "shape_rect", "shape_rounded", "shape_terminator"]) {
      app.click(bar(id));
    }
    const svgKinds = ["ellipse", "diamond", "parallelogram"];
    for (const kind of svgKinds) {
      expect(app.$(`.node.shape-${kind} svg.shape-bg`), kind).not.toBeNull();
    }
    for (const kind of ["rect", "rounded", "terminator"]) {
      expect(app.$(`.node.shape-${kind} div.shape-bg`), kind).not.toBeNull();
      expect(app.$(`.node.shape-${kind} svg`), kind).toBeNull();
    }
  });
});

d("shapes: editing, colour, outline", () => {
  it("persists the label text into the export", async () => {
    app.click(bar("shape_diamond"));
    app.type(app.$(".node.type-shape .node-title"), "Is it done?");
    await tick(20);
    const [n] = await shapeNodes();
    expect(n.title).toBe("Is it done?");
  });

  it("keeps multi-line text and a leading blank line through a re-render", async () => {
    app.click(bar("shape_rect"));
    app.type(app.$(".node.type-shape .node-title"), "\nline two\nline three");
    await tick(20);
    app.click(bar("shape_rounded")); // re-renders the page
    const ta = app.$(".node.type-shape.shape-rect .node-title");
    expect(ta.value).toBe("\nline two\nline three");
  });

  it("escapes markup typed into a shape instead of rendering it", () => {
    app.click(bar("shape_rect"));
    app.type(app.$(".node.type-shape .node-title"), "<b>x</b> & <script>");
    app.click(bar("shape_rounded")); // re-render
    expect(app.$(".node.shape-rect .node-title").value).toBe("<b>x</b> & <script>");
    expect(app.$(".node.shape-rect b")).toBeNull();
  });

  it("recolours through the swatches and keeps the colour in the export", async () => {
    app.click(bar("shape_ellipse"));
    app.click(app.$('.node.type-shape .swatch[data-color="#fde68a"]'));
    expect(app.$(".node.type-shape").style.getPropertyValue("--shape-fill")).toBe("#fde68a");
    await tick(20);
    expect((await shapeNodes())[0].color).toBe("#fde68a");
  });

  it("uses the dark-theme counterpart of a fill colour", () => {
    app.click(bar("shape_ellipse"));
    app.click(app.$('.node.type-shape .swatch[data-color="#fde68a"]'));
    app.click(app.$("#themeToggleBtn"));
    expect(app.$(".node.type-shape").style.getPropertyValue("--shape-fill")).toBe("#4a3f1a");
  });

  it("toggles the outline and remembers it", async () => {
    app.click(bar("shape_rect"));
    expect(app.$(".node.type-shape").classList.contains("no-border")).toBe(false);
    app.click(app.$(".node.type-shape .border-toggle"));
    expect(app.$(".node.type-shape").classList.contains("no-border")).toBe(true);
    await tick(20);
    expect((await shapeNodes())[0].border).toBe(false);
    app.click(app.$(".node.type-shape .border-toggle"));
    expect(app.$(".node.type-shape").classList.contains("no-border")).toBe(false);
  });
});

d("shapes: move, resize, duplicate, delete, copy", () => {
  it("resizes freely below the normal 150x50 minimum", async () => {
    app.click(bar("shape_ellipse"));
    resize(app.$(".node.type-shape"), -200, -200);
    await tick(20);
    const [n] = await shapeNodes();
    expect(n.w).toBe(60);
    expect(n.h).toBe(36);
    expect(app.$(".node.type-shape").style.width).toBe("60px");
  });

  it("grows with the resize handle", async () => {
    app.click(bar("shape_rect"));
    const before = (await shapeNodes())[0];
    resize(app.$(".node.type-shape"), 40, 30);
    await tick(20);
    const after = (await shapeNodes())[0];
    expect(after.w).toBe(before.w + 40);
    expect(after.h).toBe(before.h + 30);
  });

  it("moves with a drag, like other blocks", async () => {
    app.click(bar("shape_rect"));
    blur();
    const before = (await shapeNodes())[0];
    const el = app.$(".node.type-shape");
    app.pointer(el, "pointerdown", { button: 0, clientX: 10, clientY: 10 });
    app.pointer(app.document, "pointermove", { clientX: 60, clientY: 40 });
    app.pointer(app.document, "pointerup", { button: 0, clientX: 60, clientY: 40 });
    await tick(20);
    const after = (await shapeNodes())[0];
    expect(after.x).toBe(before.x + 50);
    expect(after.y).toBe(before.y + 30);
  });

  it("duplicates with its shape, text, colour and outline", async () => {
    app.click(bar("shape_parallelogram"));
    app.type(app.$(".node.type-shape .node-title"), "Read input");
    app.click(app.$(".node.type-shape .border-toggle"));
    app.click(app.$(".node.type-shape .dupe"));
    expect(app.$$(".node.type-shape")).toHaveLength(2);
    await tick(20);
    const [a, b] = await shapeNodes();
    expect(b).toMatchObject({ shape: "parallelogram", title: "Read input", border: false });
    expect(b.id).not.toBe(a.id);
  });

  it("deletes with its button, taking its connections along", () => {
    app.click(bar("shape_rect"));
    app.click(bar("shape_ellipse"));
    connect(app.$(".node.shape-rect"), app.$(".node.shape-ellipse"));
    expect(app.connCount()).toBe(1);
    app.click(app.$(".node.shape-rect .del"));
    expect(app.$(".node.shape-rect")).toBeNull();
    expect(app.connCount()).toBe(0);
  });

  it("deletes with the Delete key when selected", () => {
    app.click(bar("shape_rect"));
    blur();
    app.pointer(app.$(".node.type-shape"), "pointerdown", { button: 0 });
    app.key(null, "Delete");
    expect(app.$(".node.type-shape")).toBeNull();
  });

  it("copies and pastes, keeping the shape kind and text", async () => {
    app.click(bar("shape_diamond"));
    app.type(app.$(".node.type-shape .node-title"), "Branch");
    blur();
    app.pointer(app.$(".node.type-shape"), "pointerdown", { button: 0 });
    app.key(null, "c", { ctrlKey: true });
    app.document.dispatchEvent(new app.window.Event("paste", { bubbles: true, cancelable: true }));
    expect(app.$$(".node.shape-diamond")).toHaveLength(2);
    await tick(20);
    const nodes = await shapeNodes();
    expect(nodes.map((n) => n.title)).toEqual(["Branch", "Branch"]);
    expect(nodes.every((n) => n.shape === "diamond")).toBe(true);
  });
});

d("text label", () => {
  it("spawns from its bar button and its hotkey", () => {
    app.click(bar("label"));
    expect(app.$$(".node.type-label")).toHaveLength(1);
    blur();
    app.key(null, "a");
    expect(app.$$(".node.type-label")).toHaveLength(2);
  });

  it("has no box: no swatches, no header, a text field only", () => {
    app.click(bar("label"));
    const el = app.$(".node.type-label");
    expect(el.querySelector(".color-row")).toBeNull();
    expect(el.querySelector(".node-header")).toBeNull();
    expect(el.querySelector("textarea.node-title")).not.toBeNull();
    expect(el.style.background).toBe("");
    expect(app.document.activeElement).toBe(el.querySelector("textarea"));
  });

  it("stores its text and size in the export", async () => {
    app.click(bar("label"));
    app.type(app.$(".node.type-label .node-title"), "Phase one");
    resize(app.$(".node.type-label"), 100, 0);
    await tick(20);
    const n = (await pageNodes()).find((x) => x.type === "label");
    expect(n.title).toBe("Phase one");
    expect(n.w).toBe(280);
  });

  it("keeps the width at no less than 60px and lets height follow the text", async () => {
    app.click(bar("label"));
    resize(app.$(".node.type-label"), -500, 400);
    await tick(20);
    const n = (await pageNodes()).find((x) => x.type === "label");
    expect(n.w).toBe(60);
    expect(app.$(".node.type-label").style.height).toBe("");
  });

  it("is searchable by its text, and so is a shape's", () => {
    app.click(bar("label"));
    app.type(app.$(".node.type-label .node-title"), "Zebra annotation");
    app.click(bar("shape_diamond"));
    app.type(app.$(".node.type-shape .node-title"), "Quokka decision");
    blur();

    const search = (term) => {
      app.key(null, "F", { shiftKey: true });
      app.type(app.$("#searchInput"), term);
      return app.$$("#resultsList .result-item");
    };
    expect(search("zebra")).toHaveLength(1);
    expect(app.$("#resultsList .result-title").textContent).toContain("Zebra annotation");
    expect(search("quokka")).toHaveLength(1);
  });

  it("can be connected like any block", async () => {
    app.click(bar("label"));
    app.click(bar("shape_rect"));
    connect(app.$(".node.type-shape"), app.$(".node.type-label"));
    expect(app.connCount()).toBe(1);
    await tick(20);
    const dump = await exportJson(app);
    const conn = dump.boards[0].connections[0];
    expect(conn).toHaveProperty("fromItem", null);
    expect(conn).toHaveProperty("toItem", null);
  });
});

d("shapes: connections", () => {
  it("connects two shapes with explicit-null item ends", async () => {
    app.click(bar("shape_terminator"));
    app.click(bar("shape_diamond"));
    connect(app.$(".node.shape-terminator"), app.$(".node.shape-diamond"));
    expect(app.connCount()).toBe(1);
    await tick(20);
    const conn = (await exportJson(app)).boards[0].connections[0];
    // a link between two whole shapes starts as an elbow (connectors.test.js); the one extra key
    expect(Object.keys(conn).sort()).toEqual(["from", "fromItem", "id", "label", "route", "to", "toItem"]);
    expect(conn.route).toBe("elbow");
    expect(conn.fromItem).toBeNull();
    expect(conn.toItem).toBeNull();
  });

  it("spawns a connected shape by hotkey while dragging a link", async () => {
    app.click(bar("shape_rect"));
    app.pointer(app.$(".node.type-shape .conn-handle"), "pointerdown", { button: 0 });
    blur();
    app.key(null, "d");
    expect(app.$$(".node.type-shape")).toHaveLength(2);
    expect(app.$(".node.shape-diamond")).not.toBeNull();
    expect(app.connCount()).toBe(1);
  });

  it("offers every shape and the label in the drop-on-canvas picker", () => {
    app.click(bar("shape_rect"));
    app.pointer(app.$(".node.type-shape .conn-handle"), "pointerdown", { button: 0 });
    app.window.__hitTarget = null;
    app.pointer(app.document, "pointerup", { button: 0, clientX: 300, clientY: 300 });
    const names = app.$$("#pickerList .pk-name").map((e) => e.textContent);
    for (const n of ["Rectangle", "Rounded box", "Ellipse", "Diamond", "Parallelogram", "Terminator", "Text label"]) {
      expect(names).toContain(n);
    }
  });

  it("creates a connected diamond from the picker", async () => {
    app.click(bar("shape_rect"));
    app.pointer(app.$(".node.type-shape .conn-handle"), "pointerdown", { button: 0 });
    app.pointer(app.document, "pointerup", { button: 0, clientX: 300, clientY: 300 });
    app.type(app.$("#pickerInput"), "diam");
    app.key(app.$("#pickerInput"), "Enter");
    expect(app.$(".node.shape-diamond")).not.toBeNull();
    expect(app.connCount()).toBe(1);
    await tick(20);
    expect((await shapeNodes()).map((n) => n.shape).sort()).toEqual(["diamond", "rect"]);
  });
});

function seedBoard(nodes, connections = []) {
  return {
    "mindmap:index": JSON.stringify({
      version: 2,
      notebooks: [{ id: "nb_seed", name: "NB", collapsed: false }],
      boards: [{ id: "brd_s", name: "Seeded", description: "", notebookId: "nb_seed", order: 0, pinned: false }],
    }),
    "mindmap:board:brd_s": JSON.stringify({ id: "brd_s", name: "Seeded", nodes, connections }),
  };
}

d("shapes: persistence", () => {
  const base = { collapsed: false, body: "", bodyHtml: "", color: "#ffffff" };

  it("loads stored shapes with their kind, outline flag, colour and text", async () => {
    const storage = seedBoard([
      { ...base, id: "s1", type: "shape", shape: "diamond", border: false, title: "Stored?", color: "#bfdbfe", x: 50, y: 60, w: 180, h: 110 },
      { ...base, id: "l1", type: "label", title: "A label", x: 300, y: 60, w: 200, h: 36 },
    ]);
    app = await createApp(undefined, { storage });
    await waitFor(() => app.$(".node.type-shape"), { label: "seeded shape" });
    const el = app.$(".node.type-shape");
    expect(el.classList.contains("shape-diamond")).toBe(true);
    expect(el.classList.contains("no-border")).toBe(true);
    expect(el.querySelector(".node-title").value).toBe("Stored?");
    expect(el.style.getPropertyValue("--shape-fill")).toBe("#bfdbfe");
    expect(app.$(".node.type-label .node-title").value).toBe("A label");
  });

  it("fills in defaults for a shape saved without its extra properties", async () => {
    const storage = seedBoard([{ ...base, id: "s1", type: "shape", x: 0, y: 0, w: 100, h: 60 }, { ...base, id: "s2", type: "shape", shape: "bogus", title: 5, x: 0, y: 0, w: 100, h: 60 }]);
    app = await createApp(undefined, { storage });
    await waitFor(() => app.$$(".node.type-shape").length === 2, { label: "seeded shapes" });
    expect(app.$$(".node.shape-rect")).toHaveLength(2);
    expect(app.$(".node.type-shape").classList.contains("no-border")).toBe(false);
    app.click(bar("shape_rect")); // forces a save of the migrated page
    await tick(30);
    const nodes = await shapeNodes();
    expect(nodes.filter((n) => n.id === "s1" || n.id === "s2").every((n) => n.shape === "rect" && n.border === true && typeof n.title === "string")).toBe(true);
  });

  it("round-trips shapes and labels through export and import", async () => {
    app.click(bar("shape_parallelogram"));
    app.type(app.$(".node.type-shape .node-title"), "Read file");
    app.click(app.$(".node.type-shape .border-toggle"));
    app.click(app.$('.node.type-shape .swatch[data-color="#bbf7d0"]'));
    app.click(bar("label"));
    app.type(app.$(".node.type-label .node-title"), "Note to self");
    await tick(20);
    const dump = await exportJson(app);
    expect(dump.boards[0].nodes.filter((n) => n.type === "shape" || n.type === "label")).toHaveLength(2);

    importFile(dump);
    await waitFor(() => app.$("#toast").textContent === "Imported", { label: "import to finish" });
    const after = await exportJson(app);
    const copy = after.boards.find((b) => b.id !== dump.boards[0].id);
    const shape = copy.nodes.find((n) => n.type === "shape");
    expect(shape).toMatchObject({ shape: "parallelogram", title: "Read file", border: false, color: "#bbf7d0" });
    expect(copy.nodes.find((n) => n.type === "label").title).toBe("Note to self");
  });

  it("repairs an imported shape that lacks its extra properties", async () => {
    app.click(bar("shape_rect"));
    await tick(20);
    const dump = await exportJson(app);
    const bare = dump.boards[0].nodes.find((n) => n.type === "shape");
    delete bare.shape; delete bare.border;
    importFile(dump);
    await waitFor(() => app.$("#toast").textContent === "Imported", { label: "import to finish" });
    const after = await exportJson(app);
    const copy = after.boards.find((b) => b.id !== dump.boards[0].id).nodes.find((n) => n.type === "shape");
    expect(copy).toMatchObject({ shape: "rect", border: true });
  });
});

d("shapes: connection anchoring on the canvas", () => {
  it("draws a connection from the ellipse's outline, not its bounding box", async () => {
    const base = { collapsed: false, body: "", bodyHtml: "", color: "#ffffff" };
    const storage = seedBoard(
      [
        { ...base, id: "a", type: "shape", shape: "ellipse", border: true, title: "", x: 100, y: 100, w: 200, h: 100 },
        { ...base, id: "b", type: "shape", shape: "rect", border: true, title: "", x: 600, y: 500, w: 100, h: 100 },
      ],
      [{ id: "c1", from: "a", to: "b", fromItem: null, toItem: null, label: "" }]
    );
    app = await createApp(undefined, { storage });
    await waitFor(() => app.connCount() === 1, { label: "seeded connection" });
    const line = app.$("#connSvg line.visible");
    const x1 = parseFloat(line.getAttribute("x1")), y1 = parseFloat(line.getAttribute("y1"));
    // centre (200,150), semi-axes 100 x 50: the point must satisfy the ellipse equation
    expect(((x1 - 200) / 100) ** 2 + ((y1 - 150) / 50) ** 2).toBeCloseTo(1, 6);
    // ...which a rectangle anchor at (256.25, 200) would not
    expect(x1).toBeLessThan(252);
    expect(y1).toBeLessThan(195);
  });
});

d("quick bar sections", () => {
  const section = (id) => app.$(`.tb-section[data-section="${id}"]`);
  const head = (id) => section(id).querySelector(".tb-sec-head");

  it("groups the bar into Blocks and Shapes", () => {
    expect(app.$$(".tb-section").map((s) => s.querySelector(".tb-sec-head").textContent.trim())).toEqual(["Blocks", "Shapes"]);
    const blocks = section("blocks");
    for (const id of ["header", "note", "list", "question", "ticket", "week"]) {
      expect(blocks.querySelector(`.add-btn[data-type="${id}"]`), id).not.toBeNull();
    }
    expect(blocks.querySelector("#addImageBtn")).not.toBeNull();
    expect(blocks.querySelector("#customTypeBtns")).not.toBeNull();
    const shapes = section("shapes");
    for (const id of [...Object.keys(SHAPES), "label"]) {
      expect(shapes.querySelector(`.add-btn[data-type="${id}"]`), id).not.toBeNull();
    }
    expect(shapes.querySelector('.add-btn[data-type="note"]')).toBeNull();
  });

  it("keeps a custom type in the Blocks section", () => {
    app.click(app.$("#designBlocksBtn"));
    app.click(app.$("#bdNewType"));
    app.click(app.$("#bdDone"));
    expect(section("blocks").querySelector("#customTypeBtns .add-btn")).not.toBeNull();
    expect(section("shapes").querySelector("#customTypeBtns")).toBeNull();
  });

  it("starts expanded and collapses and expands from the header", () => {
    expect(section("shapes").classList.contains("collapsed")).toBe(false);
    expect(head("shapes").getAttribute("aria-expanded")).toBe("true");
    app.click(head("shapes"));
    expect(section("shapes").classList.contains("collapsed")).toBe(true);
    expect(head("shapes").getAttribute("aria-expanded")).toBe("false");
    expect(section("blocks").classList.contains("collapsed")).toBe(false);
    app.click(head("shapes"));
    expect(section("shapes").classList.contains("collapsed")).toBe(false);
  });

  it("still spawns from a hotkey while its section is collapsed", () => {
    app.click(head("shapes"));
    blur();
    app.key(null, "o");
    expect(app.$$(".node.shape-ellipse")).toHaveLength(1);
  });

  it("keeps working, folding in-session, when localStorage is unavailable", async () => {
    app = await createApp(undefined, {
      beforeParse(w) {
        Object.defineProperty(w, "localStorage", { configurable: true, get() { throw new Error("denied"); } });
      },
    });
    expect(app.$$(".tb-section")).toHaveLength(2);
    app.click(head("blocks"));
    expect(section("blocks").classList.contains("collapsed")).toBe(true);
  });

  it("remembers folded sections per viewer and restores them on the next load", async () => {
    const store = {};
    const fake = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    };
    const withStore = { beforeParse(w) { Object.defineProperty(w, "localStorage", { configurable: true, value: fake }); } };

    app = await createApp(undefined, withStore);
    app.click(head("shapes"));
    expect(JSON.parse(store["mindmap-toolbar-sections"])).toEqual({ shapes: true });

    app = await createApp(undefined, withStore);
    expect(section("shapes").classList.contains("collapsed")).toBe(true);
    expect(section("blocks").classList.contains("collapsed")).toBe(false);
  });

  it("ignores a garbled stored value", async () => {
    app = await createApp(undefined, {
      beforeParse(w) {
        Object.defineProperty(w, "localStorage", {
          configurable: true,
          value: { getItem: () => "{not json", setItem() {}, removeItem() {} },
        });
      },
    });
    expect(app.$$(".tb-section.collapsed")).toHaveLength(0);
  });

  it("hides the Shapes section entirely when none of its entries are on the bar", () => {
    app.click(app.$("#toolbarSettingsBtn"));
    for (const id of [...Object.keys(SHAPES), "label"]) {
      const cb = app.$(`[data-onbar="${id}"]`);
      cb.checked = false;
      cb.dispatchEvent(new app.window.Event("change", { bubbles: true }));
    }
    expect(section("shapes").style.display).toBe("none");
    expect(section("blocks").style.display).toBe("");
  });
});

d("toolbar settings and help for the new types", () => {
  it("lists every shape and the label with their default hotkeys", () => {
    app.click(app.$("#toolbarSettingsBtn"));
    for (const [id, { key }] of Object.entries(SHAPES)) {
      expect(app.$(`[data-onbar="${id}"]`).checked, id).toBe(true);
      expect(app.$(`[data-hotkey="${id}"]`).value, id).toBe(key);
    }
    expect(app.$('[data-hotkey="label"]').value).toBe("a");
    expect(app.$("#tsError").textContent).toBe("");
  });

  it("gives every default hotkey to exactly one type", () => {
    app.click(app.$("#toolbarSettingsBtn"));
    const keys = app.$$("[data-hotkey]").map((i) => i.value).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("removes a shape from the bar when switched off, but keeps its hotkey", () => {
    app.click(app.$("#toolbarSettingsBtn"));
    const cb = app.$('[data-onbar="shape_diamond"]');
    cb.checked = false;
    cb.dispatchEvent(new app.window.Event("change", { bubbles: true }));
    expect(bar("shape_diamond")).toBeNull();
    app.click(app.$("#tsDone"));
    blur();
    app.key(null, "d");
    expect(app.$$(".node.shape-diamond")).toHaveLength(1);
  });

  it("rebinding a shape's hotkey takes effect on the bar and in the help list", () => {
    app.click(app.$("#toolbarSettingsBtn"));
    app.type(app.$('[data-hotkey="shape_ellipse"]'), "z");
    expect(bar("shape_ellipse").querySelector(".key").textContent).toBe("Z");
    app.click(app.$("#tsDone"));
    blur();
    app.key(null, "z");
    expect(app.$$(".node.shape-ellipse")).toHaveLength(1);
    app.click(app.$("#helpTriggerBtn"));
    expect(app.$("#helpBody .help-hotkeys").textContent).toMatch(/Z\s*Ellipse/);
  });

  it("lists the shape and label hotkeys in the Spawn at cursor help", () => {
    app.click(app.$("#helpTriggerBtn"));
    const text = app.$('#helpBody .help-section[data-section="spawn"]').textContent;
    const expected = { R: "Rectangle", B: "Rounded box", O: "Ellipse", D: "Diamond", P: "Parallelogram", S: "Terminator", A: "Text label" };
    for (const [key, name] of Object.entries(expected)) {
      expect(text, name).toMatch(new RegExp(key + "\\s*" + name));
    }
  });

  it("does not add the new types to the Block Designer list", () => {
    app.click(app.$("#designBlocksBtn"));
    expect(app.$$("#bdTypeList [data-protected]")).toHaveLength(4);
  });
});
