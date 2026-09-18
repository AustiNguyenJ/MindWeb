import { describe, it, expect, beforeEach } from "vitest";
import { createApp, exportJson, tick, DEFAULT_ENTRY } from "./harness.js";

// the confirm modal is new, app-only behavior -- the untouched original used
// window.confirm()
const onBaseline = DEFAULT_ENTRY.includes("original");

let app;
beforeEach(async () => { app = await createApp(); });

const open = () => app.click(app.$("#designBlocksBtn"));
const done = () => app.click(app.$("#bdDone"));
const typeNames = () => app.$$("#bdTypeList .bd-typebtn span:nth-child(2)").map((e) => e.textContent);

/** Add a brand-new custom type and return the toolbar button that creates it. */
function newCustomType(name) {
  open();
  app.click(app.$("#bdNewType"));
  if (name) app.type(app.$("#bdName"), name);
  done();
  return app.$("#customTypeBtns .add-btn");
}

function setSelect(el, value) {
  el.value = value;
  el.dispatchEvent(new app.window.Event("change", { bubbles: true }));
}

describe("the designer's type list", () => {
  it("opens and closes", () => {
    open();
    expect(app.$("#bdOverlay").classList.contains("open")).toBe(true);
    done();
    expect(app.$("#bdOverlay").classList.contains("open")).toBe(false);
  });

  it("lists the editable built-ins and the locked ones", () => {
    open();
    expect(typeNames()).toEqual(["Note", "Question", "Ticket", "List", "Week", "Header", "Image"]);
    expect(app.$$("#bdTypeList [data-protected]")).toHaveLength(4);
  });

  it("explains why a locked built-in cannot be edited", () => {
    open();
    app.click(app.$('#bdTypeList [data-protected="list"]'));
    expect(app.$("#bdEditor").textContent).toMatch(/built-in block with special behaviour/);
    expect(app.$("#bdEditor").textContent).toMatch(/Repeating lines/);
  });

  it("will not offer a delete button for a built-in type", () => {
    open();
    const noteBtn = app.$('#bdTypeList .bd-typebtn[data-id="note"]');
    expect(noteBtn.querySelector("[data-del]")).toBeNull();
    expect(noteBtn.textContent).toMatch(/built-in/);
  });
});

describe("editing a built-in type", () => {
  it("renames Note and shows the new name on its blocks' schema", async () => {
    open();
    app.click(app.$('#bdTypeList .bd-typebtn[data-id="note"]'));
    app.type(app.$("#bdName"), "Sticky");
    done();
    await tick(20);

    const dump = await exportJson(app);
    expect(dump.blockTypes.note.name).toBe("Sticky");
    expect(dump.blockTypes.note.builtin).toBe(true);
  });

  it("adds a field to Ticket and it appears on new ticket blocks", async () => {
    open();
    app.click(app.$('#bdTypeList .bd-typebtn[data-id="ticket"]'));
    app.click(app.$("#bdAddField"));
    const cards = app.$$("#bdFields .bd-fieldcard");
    app.type(cards[cards.length - 1].querySelector(".bd-flabel"), "Severity");
    done();

    app.click(app.$('.add-btn[data-type="ticket"]'));
    const labels = [...app.$(".node.type-ticket").querySelectorAll(".cf-label")].map((e) => e.textContent);
    expect(labels).toContain("Severity");
  });
});

describe("creating a custom type", () => {
  it("adds it to the toolbar and can place one on the canvas", () => {
    const btn = newCustomType("Server");
    expect(btn.textContent).toContain("Server");

    app.click(btn);
    const node = app.$(".node.type-ct_, .node[class*='type-ct_']");
    expect(node).toBeTruthy();
    expect(node.querySelector(".cf-label").textContent).toBe("Detail");
  });

  it("starts with one text field and refuses to drop the last one", () => {
    open();
    app.click(app.$("#bdNewType"));
    expect(app.$$("#bdFields .bd-fieldcard")).toHaveLength(1);

    app.click(app.$("#bdFields .fdel"));
    expect(app.$("#toast").textContent).toBe("Keep at least one field");
    expect(app.$$("#bdFields .bd-fieldcard")).toHaveLength(1);
  });

  it("renders a live preview that mirrors the schema", () => {
    open();
    app.click(app.$("#bdNewType"));
    app.type(app.$("#bdName"), "Contact");
    app.type(app.$("#bdFields .bd-flabel"), "Email");

    const preview = app.$("#bdPreview");
    expect(preview.querySelector(".node-title").value).toBe("Contact");
    expect(preview.querySelector(".cf-label").textContent).toBe("Email");
  });

  it("duplicates a type under a new id", async () => {
    newCustomType("Server");
    open();
    // reopening always reselects the first type, so pick Server again first
    app.click(app.$('#bdTypeList .bd-typebtn[data-id^="ct_"]'));
    app.click(app.$("#bdDuplicate"));
    done();
    await tick(20);

    const dump = await exportJson(app);
    const names = Object.values(dump.blockTypes).map((t) => t.name);
    expect(names).toContain("Server");
    expect(names).toContain("Server copy");

    const ids = Object.keys(dump.blockTypes).filter((k) => k.startsWith("ct_"));
    expect(new Set(ids).size).toBe(2);
  });

  it.skipIf(onBaseline)("deletes a custom type after confirming", async () => {
    newCustomType("Disposable");
    open();
    app.click(app.$("#bdTypeList [data-del]"));
    // deletion asks first, through an in-app modal rather than a native
    // browser confirm() -- nothing has happened until it's confirmed
    expect(app.$("#confirmOverlay").classList.contains("open")).toBe(true);
    app.click(app.$("#confirmOkBtn"));
    await tick(20);
    done();

    const dump = await exportJson(app);
    expect(Object.values(dump.blockTypes).map((t) => t.name)).not.toContain("Disposable");
    expect(app.$("#customTypeBtns .add-btn")).toBeNull();
  });

  it.skipIf(onBaseline)("keeps the type if the delete is cancelled", async () => {
    newCustomType("Keep me");
    open();
    app.click(app.$("#bdTypeList [data-del]"));
    app.click(app.$("#confirmCancelBtn"));
    await tick(20);
    done();

    const dump = await exportJson(app);
    expect(Object.values(dump.blockTypes).map((t) => t.name)).toContain("Keep me");
  });

  it("supports every field kind the designer offers", () => {
    open();
    app.click(app.$("#bdNewType"));
    const kinds = [...app.$("#bdFields .bd-fkind").options].map((o) => o.value);
    expect(kinds).toEqual(["text", "richtext", "link", "number", "date", "select", "checkbox", "group"]);
  });
});

describe("repeating-row (group) fields", () => {
  function typeWithGroup() {
    open();
    app.click(app.$("#bdNewType"));
    app.type(app.$("#bdName"), "Runbook");
    setSelect(app.$("#bdFields .bd-fkind"), "group");
    done();
    return app.$("#customTypeBtns .add-btn");
  }

  it("seeds a step/description pair of columns", () => {
    open();
    app.click(app.$("#bdNewType"));
    setSelect(app.$("#bdFields .bd-fkind"), "group");

    const labels = app.$$("#bdFields .bd-sublabel").map((i) => i.value);
    expect(labels).toEqual(["Step", "Description"]);
    const kinds = app.$$("#bdFields .bd-subkind").map((s) => s.value);
    expect(kinds).toEqual(["text", "richtext"]);
  });

  it("toggles between stacked and side-by-side layouts", () => {
    open();
    app.click(app.$("#bdNewType"));
    setSelect(app.$("#bdFields .bd-fkind"), "group");

    expect(app.$('.bd-layopt[data-layout="rows"]').classList.contains("active")).toBe(true);
    app.click(app.$('.bd-layopt[data-layout="columns"]'));
    expect(app.$('.bd-layopt[data-layout="columns"]').classList.contains("active")).toBe(true);
  });

  it("starts a placed block with no rows and appends them on +", () => {
    app.click(typeWithGroup());
    const node = app.$("#canvasInner .node:not(.type-header)");
    expect(node.querySelectorAll(".group-row")).toHaveLength(0);

    app.click(node.querySelector(".grow-add"));
    expect(app.$("#canvasInner .node:not(.type-header)").querySelectorAll(".group-row")).toHaveLength(1);
  });

  it("gives every row its own branch point", async () => {
    app.click(typeWithGroup());
    let node = app.$("#canvasInner .node:not(.type-header)");
    app.click(node.querySelector(".grow-add"));
    app.click(app.$("#canvasInner .node:not(.type-header) .grow-add"));

    node = app.$("#canvasInner .node:not(.type-header)");
    expect(node.querySelectorAll(".row-conn[data-grow]")).toHaveLength(2);

    // branch off the second row onto a fresh note
    app.click(app.$('.add-btn[data-type="note"]'));
    node = app.$("#canvasInner .node:not(.type-header):not(.type-note)");
    const dot = node.querySelectorAll(".row-conn[data-grow]")[1];
    app.pointer(dot, "pointerdown", { button: 0 });
    app.window.__hitTarget = app.$(".node.type-note");
    app.pointer(app.document, "pointerup", { button: 0 });
    await tick(20);

    const dump = await exportJson(app);
    const conn = dump.boards[0].connections[0];
    expect(conn.fromItem).toMatch(/^g:[^:]+:1$/);
  });

  it("keeps row links pointing at the right row when an earlier row is removed", async () => {
    app.click(typeWithGroup());
    let node = app.$("#canvasInner .node:not(.type-header)");
    app.click(node.querySelector(".grow-add"));
    app.click(app.$("#canvasInner .node:not(.type-header) .grow-add"));

    app.click(app.$('.add-btn[data-type="note"]'));
    node = app.$("#canvasInner .node:not(.type-header):not(.type-note)");
    app.pointer(node.querySelectorAll(".row-conn[data-grow]")[1], "pointerdown", { button: 0 });
    app.window.__hitTarget = app.$(".node.type-note");
    app.pointer(app.document, "pointerup", { button: 0 });
    await tick(20);

    // delete row 0; the link that pointed at row 1 must follow down to row 0
    node = app.$("#canvasInner .node:not(.type-header):not(.type-note)");
    app.click(node.querySelectorAll(".grow-del")[0]);
    await tick(20);

    const dump = await exportJson(app);
    expect(dump.boards[0].connections[0].fromItem).toMatch(/^g:[^:]+:0$/);
  });
});
