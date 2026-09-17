import { describe, it, expect, beforeEach } from "vitest";
import { createApp, exportJson, waitFor, tick } from "./harness.js";

function importFile(app, payload) {
  const json = typeof payload === "string" ? payload : JSON.stringify(payload);
  const file = new app.window.File([json], "backup.json", { type: "application/json" });
  const input = app.$("#jsonFileInput");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new app.window.Event("change", { bubbles: true }));
}

/** An index + board pair in the shape the app writes to window.storage. */
function seedStorage(boardId, boardPayload, { nbName = "NB", pageName = "Page" } = {}) {
  return {
    "mindmap:index": JSON.stringify({
      version: 2,
      notebooks: [{ id: "nb_seed", name: nbName, collapsed: false }],
      boards: [{ id: boardId, name: pageName, description: "", notebookId: "nb_seed", order: 0, pinned: false }],
    }),
    ["mindmap:board:" + boardId]: boardPayload,
  };
}

describe("export", () => {
  let app;
  beforeEach(async () => { app = await createApp(); });

  it("writes a versioned bundle carrying notebooks, pages and the type library", async () => {
    const dump = await exportJson(app);
    expect(dump.version).toBe(2);
    expect(dump.exported).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(dump.notebooks).toHaveLength(1);
    expect(dump.boards).toHaveLength(1);
    expect(dump.boards[0]).toMatchObject({ name: "My first mind map" });
    expect(dump.boards[0].nodes).toHaveLength(1);
    expect(Array.isArray(dump.boards[0].connections)).toBe(true);
  });

  it("GOTCHA: the block-type library travels with the export", async () => {
    const dump = await exportJson(app);
    // the editable built-ins share the library with user-defined types
    expect(Object.keys(dump.blockTypes).sort()).toEqual(["note", "question", "ticket"]);
    expect(dump.blockTypes.ticket.fields.map((f) => f.key))
      .toEqual(["ticketNo", "link", "assigned", "customer", "bodyHtml"]);
  });

  it("carries a user-defined block type too", async () => {
    app.click(app.$("#designBlocksBtn"));
    app.click(app.$("#bdNewType"));
    app.type(app.$("#bdName"), "Server");
    app.click(app.$("#bdDone"));
    await tick(20);

    const dump = await exportJson(app);
    const custom = Object.values(dump.blockTypes).find((t) => t.name === "Server");
    expect(custom).toBeTruthy();
    expect(custom.id).toMatch(/^ct_/);
  });
});

describe("import", () => {
  let app;
  beforeEach(async () => { app = await createApp(); });

  it("adds the imported pages alongside the existing ones", async () => {
    const dump = await exportJson(app);
    importFile(app, dump);
    await waitFor(() => app.$("#toast").textContent === "Imported", { label: "import to finish" });
    expect(app.pages()).toHaveLength(2);
  });

  it("round-trips a page's blocks", async () => {
    app.click(app.$('.add-btn[data-type="note"]'));
    app.type(app.$(".node.type-note .node-title"), "Kept through import");
    await tick(20);

    const dump = await exportJson(app);
    importFile(app, dump);
    await waitFor(() => app.pages().length === 2, { label: "imported page" });

    const after = await exportJson(app);
    const copies = after.boards.filter((b) => b.nodes.some((n) => n.title === "Kept through import"));
    expect(copies).toHaveLength(2);
  });

  it("rejects a file that is not JSON", async () => {
    importFile(app, "this is not json");
    await waitFor(() => app.rec.alerts.length > 0, { label: "alert" });
    expect(app.rec.alerts[0]).toMatch(/valid JSON/);
    expect(app.pages()).toHaveLength(1);
  });

  it("rejects a bundle with no pages", async () => {
    importFile(app, { version: 2, boards: [] });
    await waitFor(() => app.rec.alerts.length > 0, { label: "alert" });
    expect(app.rec.alerts[0]).toMatch(/No pages found/);
  });

  it("does nothing if the confirmation is declined", async () => {
    const dump = await exportJson(app);
    app.rec.confirmReply = false;
    importFile(app, dump);
    await waitFor(() => app.rec.confirms.length > 0, { label: "confirm" });
    await tick(30);
    expect(app.pages()).toHaveLength(1);
  });
});

describe("the in-browser (app) backend", () => {
  it("is selected when window.storage exists, and says so", async () => {
    const app = await createApp(undefined, { storage: {} });
    expect(app.$("#storageBar .sb-label").textContent).toBe("Saving in this browser");
  });

  it("loads notebooks and pages back out of storage", async () => {
    const payload = JSON.stringify({
      nodes: [{
        id: "n1", type: "note", x: 100, y: 100, w: 220, h: 140,
        title: "From storage", bodyHtml: "", color: "#ffffff",
      }],
      connections: [],
    });
    const app = await createApp(undefined, {
      storage: seedStorage("brd_1", payload, { nbName: "Seeded Notebook", pageName: "Seeded Page" }),
    });

    expect(app.notebookNames()).toEqual(["Seeded Notebook"]);
    expect(app.$("#boardTitle").value).toBe("Seeded Page");
    expect(app.$(".node .node-title").value).toBe("From storage");
  });
});

describe("damaged-data protection", () => {
  it("refuses to overwrite a page whose stored payload could not be parsed", async () => {
    const damaged = "{ this is not valid json";
    const app = await createApp(undefined, { storage: seedStorage("brd_corrupt", damaged) });

    await waitFor(() => /couldn/.test(app.$("#toast").textContent), { label: "corrupt warning" });
    expect(app.nodes()).toHaveLength(0);

    // the damaged payload is still in storage, byte for byte
    expect(app.window.__storageMap.get("mindmap:board:brd_corrupt")).toBe(damaged);

    // and editing asks once before it is allowed to clobber it
    app.click(app.$('.add-btn[data-type="note"]'));
    await tick(30);
    expect(app.rec.confirms.some((c) => /couldn/.test(c))).toBe(true);
  });

  it("treats a blank stored payload as damaged, not as an empty page", async () => {
    const app = await createApp(undefined, { storage: seedStorage("brd_blank", "   ") });
    await waitFor(() => /couldn/.test(app.$("#toast").textContent), { label: "corrupt warning" });
    expect(app.window.__storageMap.get("mindmap:board:brd_blank")).toBe("   ");
  });
});

describe("recovering an orphaned custom block type", () => {
  it("rebuilds a usable schema from surviving node data", async () => {
    // nodes of type ct_gone survive, but mindmap:types has no definition
    const payload = JSON.stringify({
      nodes: [{
        id: "n1", type: "ct_gone", x: 100, y: 100, w: 300, h: 200,
        title: "Runbook", color: "#ffffff",
        fields: {
          heading: "Restart the service",
          steps: [{ name: "Stop it", detail: "<b>sudo</b> systemctl stop" }],
        },
      }],
      connections: [],
    });
    const app = await createApp(undefined, { storage: seedStorage("brd_orphan", payload) });

    await waitFor(() => /recovered from page data/.test(app.$("#toast").textContent), { label: "recovery toast" });

    // the block renders again: the plain field and the repeating group both return
    const node = app.$(".node");
    expect(node.querySelector('[data-fk="heading"]').value).toBe("Restart the service");
    expect(node.querySelectorAll(".group-row")).toHaveLength(1);

    const dump = await exportJson(app);
    expect(dump.blockTypes.ct_gone.recovered).toBe(true);
    expect(dump.blockTypes.ct_gone.fields.find((f) => f.kind === "group")).toBeTruthy();
  });
});
