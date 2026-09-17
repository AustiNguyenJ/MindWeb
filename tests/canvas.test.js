import { describe, it, expect, beforeEach } from "vitest";
import { createApp, exportJson, tick } from "./harness.js";

let app;
beforeEach(async () => { app = await createApp(); });

/** Drag the connection handle of `fromNode` and drop it on `toNode`. */
function connect(app, fromNode, toNode) {
  app.pointer(fromNode.querySelector(".conn-handle"), "pointerdown", { button: 0 });
  app.window.__hitTarget = toNode;
  app.pointer(app.document, "pointerup", { button: 0 });
  app.window.__hitTarget = null;
}

function twoNotes(app) {
  app.click(app.$('.add-btn[data-type="note"]'));
  app.click(app.$('.add-btn[data-type="question"]'));
  return [app.$(".node.type-note"), app.$(".node.type-question")];
}

describe("connections", () => {
  it("links two blocks by dragging the edge handle onto another block", () => {
    const [a, b] = twoNotes(app);
    expect(app.connCount()).toBe(0);
    connect(app, a, b);
    expect(app.connCount()).toBe(1);
  });

  it("refuses to link a block to itself", () => {
    const [a] = twoNotes(app);
    connect(app, a, a);
    expect(app.connCount()).toBe(0);
  });

  it("GOTCHA: a whole-block link records fromItem/toItem as explicit null", async () => {
    const [a, b] = twoNotes(app);
    connect(app, a, b);
    await tick(20);

    const dump = await exportJson(app);
    const conn = dump.boards[0].connections[0];
    expect(conn).toHaveProperty("fromItem", null);
    expect(conn).toHaveProperty("toItem", null);
    expect(Object.keys(conn).sort()).toEqual(["from", "fromItem", "id", "label", "to", "toItem"]);
  });

  it("branches from a single list row, keyed by row index", async () => {
    app.click(app.$('.add-btn[data-type="list"]'));
    app.click(app.$('.add-btn[data-type="note"]'));
    const list = app.$(".node.type-list");
    const note = app.$(".node.type-note");

    app.pointer(list.querySelector(".row-conn[data-idx='0']"), "pointerdown", { button: 0 });
    app.window.__hitTarget = note;
    app.pointer(app.document, "pointerup", { button: 0 });
    await tick(20);

    const dump = await exportJson(app);
    expect(dump.boards[0].connections[0].fromItem).toBe(0);
  });

  it("drops connections when their block is deleted", () => {
    const [a, b] = twoNotes(app);
    connect(app, a, b);
    expect(app.connCount()).toBe(1);
    app.click(app.$(".node.type-note .del"));
    expect(app.connCount()).toBe(0);
  });
});

describe("collapsing", () => {
  it("folds everything downstream and reports the hidden count", () => {
    const [a, b] = twoNotes(app);
    connect(app, a, b);
    expect(app.nodes()).toHaveLength(3); // header + 2

    const chevron = app.$(".node.type-note .collapse-btn");
    expect(chevron).toBeTruthy();
    app.click(chevron);

    expect(app.nodes()).toHaveLength(2);
    expect(app.$(".node.type-note .hidden-badge").textContent).toBe("1 hidden");

    app.click(app.$(".node.type-note .collapse-btn"));
    expect(app.nodes()).toHaveLength(3);
  });

  it("gives no chevron to a block with nothing leading out of it", () => {
    twoNotes(app);
    expect(app.$(".node.type-note .collapse-btn")).toBeNull();
  });
});

describe("selection", () => {
  it("selects a block on pointerdown and recolours it via a swatch", () => {
    const [a] = twoNotes(app);
    app.pointer(a.querySelector(".grip"), "pointerdown", { button: 0 });
    expect(a.classList.contains("selected")).toBe(true);

    app.click(a.querySelector('.swatch[data-color="#fde68a"]'));
    expect(app.$(".node.type-note").style.background).toBe("rgb(253, 230, 138)");
  });

  it("Ctrl+A then Delete clears the board", () => {
    twoNotes(app);
    app.document.activeElement.blur();
    expect(app.nodes()).toHaveLength(3);

    app.key(null, "a", { ctrlKey: true });
    app.key(null, "Delete");
    expect(app.nodes()).toHaveLength(0);
    expect(app.$(".empty-hint")).toBeTruthy();
  });
});

describe("undo / redo", () => {
  it("undoes and redoes a block creation", () => {
    app.click(app.$('.add-btn[data-type="note"]'));
    app.document.activeElement.blur();
    expect(app.nodes()).toHaveLength(2);

    app.key(null, "z", { ctrlKey: true });
    expect(app.nodes()).toHaveLength(1);

    app.key(null, "z", { ctrlKey: true, shiftKey: true });
    expect(app.nodes()).toHaveLength(2);
  });

  it("supports Ctrl+Y as redo", () => {
    app.click(app.$('.add-btn[data-type="note"]'));
    app.document.activeElement.blur();
    app.key(null, "z", { ctrlKey: true });
    expect(app.nodes()).toHaveLength(1);
    app.key(null, "y", { ctrlKey: true });
    expect(app.nodes()).toHaveLength(2);
  });

  it("keeps history per page", async () => {
    app.click(app.$('.add-btn[data-type="note"]'));
    app.document.activeElement.blur();
    app.click(app.$("#newBoardBtn"));          // switches to a fresh page
    app.document.activeElement.blur();

    app.key(null, "z", { ctrlKey: true });     // nothing to undo on the new page
    expect(app.$("#toast").textContent).toBe("Nothing to undo");
  });
});

describe("copy / paste", () => {
  it("copies a selected block and pastes a duplicate", () => {
    const [a] = twoNotes(app);
    app.pointer(a.querySelector(".grip"), "pointerdown", { button: 0 });
    app.document.activeElement.blur();

    app.key(null, "c", { ctrlKey: true });
    expect(app.rec.copied[0]).toMatch(/^MINDMAP_NODE::/);

    app.document.dispatchEvent(new app.window.Event("paste", { bubbles: true, cancelable: true }));
    expect(app.$$(".node.type-note")).toHaveLength(2);
  });

  it("carries internal connections along with a copied cluster", () => {
    const [a, b] = twoNotes(app);
    connect(app, a, b);
    app.document.activeElement?.blur?.();

    app.key(null, "a", { ctrlKey: true });     // select all three
    app.key(null, "c", { ctrlKey: true });
    const payload = JSON.parse(app.rec.copied[0].slice("MINDMAP_NODE::".length));
    expect(payload.nodes).toHaveLength(3);
    expect(payload.connections).toHaveLength(1);

    app.document.dispatchEvent(new app.window.Event("paste", { bubbles: true, cancelable: true }));
    expect(app.nodes()).toHaveLength(6);
    expect(app.connCount()).toBe(2);
  });
});
