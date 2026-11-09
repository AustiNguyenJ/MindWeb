import { describe, it, expect, beforeEach } from "vitest";
import { createApp, exportJson, tick, DEFAULT_ENTRY } from "./harness.js";

// Both features are new to the restructured app; the untouched original has
// neither the per-type title switch nor a shared-only quick bar.
const onBaseline = DEFAULT_ENTRY.includes("original");
const d = describe.skipIf(onBaseline);

let app;
beforeEach(async () => { app = await createApp(); });

const openDesigner = () => app.click(app.$("#designBlocksBtn"));
const closeDesigner = () => app.click(app.$("#bdDone"));
const openToolbar = () => app.click(app.$("#toolbarSettingsBtn"));
const barTypes = () => app.$$("#builtinToolbarBtns .add-btn").map((b) => b.dataset.type);

function setShowTitle(typeId, on) {
  openDesigner();
  app.click(app.$(`#bdTypeList .bd-typebtn[data-id="${typeId}"]`));
  const cb = app.$("#bdShowTitle");
  cb.checked = on;
  cb.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  closeDesigner();
}

d("showing or hiding a block type's title area", () => {
  it("shows the title by default for every type", () => {
    app.click(app.$('.add-btn[data-type="note"]'));
    expect(app.$(".node.type-note .node-title")).not.toBeNull();
  });

  it("offers the checkbox ticked for a type that has never been changed", () => {
    openDesigner();
    app.click(app.$('#bdTypeList .bd-typebtn[data-id="note"]'));
    expect(app.$("#bdShowTitle").checked).toBe(true);
  });

  it("removes the title input from new blocks of that type only", () => {
    setShowTitle("note", false);
    app.click(app.$('.add-btn[data-type="note"]'));
    app.click(app.$('.add-btn[data-type="question"]'));
    expect(app.$(".node.type-note .node-title")).toBeNull();
    expect(app.$(".node.type-note .grip")).not.toBeNull();
    expect(app.$(".node.type-question .node-title")).not.toBeNull();
  });

  it("updates blocks already on the page", () => {
    app.click(app.$('.add-btn[data-type="note"]'));
    expect(app.$(".node.type-note .node-title")).not.toBeNull();
    setShowTitle("note", false);
    expect(app.$(".node.type-note .node-title")).toBeNull();
  });

  it("works for a custom type too", () => {
    openDesigner();
    app.click(app.$("#bdNewType"));
    app.type(app.$("#bdName"), "Server");
    const cb = app.$("#bdShowTitle");
    cb.checked = false;
    cb.dispatchEvent(new app.window.Event("change", { bubbles: true }));
    closeDesigner();
    app.click(app.$("#customTypeBtns .add-btn"));
    expect(app.$(".node[class*='type-ct_'] .node-title")).toBeNull();
  });

  it("keeps a title already typed and brings it back when switched on again", () => {
    app.click(app.$('.add-btn[data-type="note"]'));
    app.type(app.$(".node.type-note .node-title"), "Kept");
    setShowTitle("note", false);
    setShowTitle("note", true);
    expect(app.$(".node.type-note .node-title").value).toBe("Kept");
  });

  it("puts the cursor in the body when a new block has no title", () => {
    setShowTitle("note", false);
    app.click(app.$('.add-btn[data-type="note"]'));
    expect(app.$(".node.type-note .node-title")).toBeNull();
    expect(app.$$(".node.type-note .cf-rich, .node.type-note .node-rich").length).toBeGreaterThan(0);
  });

  it("persists the setting in the exported block types", async () => {
    setShowTitle("note", false);
    await tick(20);
    const dump = await exportJson(app);
    expect(dump.blockTypes.note.showTitle).toBe(false);
    expect(dump.blockTypes.question.showTitle).toBeUndefined();
  });

  it("hides the title in the designer preview", () => {
    openDesigner();
    app.click(app.$('#bdTypeList .bd-typebtn[data-id="note"]'));
    expect(app.$("#bdPreview .node-title")).not.toBeNull();
    const cb = app.$("#bdShowTitle");
    cb.checked = false;
    cb.dispatchEvent(new app.window.Event("change", { bubbles: true }));
    expect(app.$("#bdPreview .node-title")).toBeNull();
  });
});

d("the quick bar is shared by every page", () => {
  const addPage = () => app.click(app.$("#newBoardBtn"));
  const goToPage = (i) => app.click(app.$$(".board-item")[i]);

  it("no longer offers a per-page toolbar override", () => {
    openToolbar();
    expect(app.$("#tsBoardOverride")).toBeNull();
  });

  it("applies a bar change made on one page to every other page", () => {
    addPage();
    expect(app.$$(".board-item").length).toBeGreaterThanOrEqual(2);
    goToPage(0);
    expect(barTypes()).toContain("question");

    openToolbar();
    const cb = app.$('[data-onbar="question"]');
    cb.checked = false;
    cb.dispatchEvent(new app.window.Event("change", { bubbles: true }));
    expect(barTypes()).not.toContain("question");

    goToPage(1);
    expect(barTypes()).not.toContain("question");
    goToPage(0);
    expect(barTypes()).not.toContain("question");
  });

  it("applies a hotkey change on one page to the others", () => {
    addPage();
    goToPage(0);
    openToolbar();
    const inp = app.$('[data-hotkey="note"]');
    app.type(inp, "z");
    app.click(app.$("#tsDone"));
    app.document.activeElement?.blur?.();
    goToPage(1);
    app.key(null, "z");
    expect(app.$$(".node.type-note")).toHaveLength(1);
  });
});
