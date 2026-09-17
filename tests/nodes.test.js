import { describe, it, expect, beforeEach } from "vitest";
import { createApp, exportJson, tick } from "./harness.js";

let app;
beforeEach(async () => { app = await createApp(); });

describe("creating blocks", () => {
  it("adds one block per toolbar button, of the right type", async () => {
    const wanted = ["header", "note", "list", "question", "ticket", "week"];
    for (const type of wanted) {
      app.click(app.$(`.add-btn[data-type="${type}"]`));
    }
    // the seeded board already had one header
    expect(app.nodes()).toHaveLength(1 + wanted.length);
    for (const type of wanted) {
      expect(app.$$(`.node.type-${type}`).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("spawns a block at the cursor for each hotkey, and focuses its title", () => {
    app.key(null, "n");
    expect(app.$$(".node.type-note")).toHaveLength(1);
    expect(app.document.activeElement.className).toBe("node-title");
  });

  it("ignores hotkeys while the caret is in a text field", () => {
    app.key(null, "n");                      // creates a note, focuses its title
    const count = app.nodes().length;
    app.key(app.document.activeElement, "l"); // typing "l" into the title
    expect(app.nodes()).toHaveLength(count);  // no list block appeared

    app.document.activeElement.blur();
    app.key(null, "l");
    expect(app.$$(".node.type-list")).toHaveLength(1);
  });

  it("covers every hotkey in the help text", () => {
    for (const [key, type] of Object.entries({ h: "header", n: "note", l: "list", q: "question", t: "ticket", w: "week" })) {
      app.document.activeElement?.blur?.();
      app.key(null, key);
      expect(app.$$(`.node.type-${type}`).length, `hotkey ${key} -> ${type}`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("list blocks", () => {
  it("starts with one row, and Enter appends another", () => {
    app.click(app.$('.add-btn[data-type="list"]'));
    const listNode = app.$(".node.type-list");
    expect(listNode.querySelectorAll(".list-row")).toHaveLength(1);

    const input = listNode.querySelector(".list-input");
    app.type(input, "first item");
    app.key(input, "Enter");

    expect(app.$(".node.type-list").querySelectorAll(".list-row")).toHaveLength(2);
  });

  /* KNOWN PRE-EXISTING BUG, pinned here so the refactor cannot change it
     silently. Backspace in an empty row removes the row (correct), but
     removeListItem() re-renders the board, which destroys the focused input
     and drops document.activeElement to <body>. The same keydown then keeps
     bubbling to the document handler, which now sees "not in a text field"
     with the block still selected, and deletes the whole block.
     Fix would be to stopPropagation() in the row handler. */
  it("removes a row on Backspace -- and then deletes the whole block (known bug)", () => {
    app.click(app.$('.add-btn[data-type="list"]'));
    let node = app.$(".node.type-list");
    app.type(node.querySelector(".list-input"), "kept");
    app.key(node.querySelector(".list-input"), "Enter");
    expect(app.$(".node.type-list").querySelectorAll(".list-row")).toHaveLength(2);

    node = app.$(".node.type-list");
    const second = node.querySelectorAll(".list-input")[1];
    app.key(second, "Backspace");
    expect(app.$$(".node.type-list")).toHaveLength(0);
  });

  it("removes only the row when the event does not reach the document handler", () => {
    app.click(app.$('.add-btn[data-type="list"]'));
    let node = app.$(".node.type-list");
    app.type(node.querySelector(".list-input"), "kept");
    app.key(node.querySelector(".list-input"), "Enter");

    node = app.$(".node.type-list");
    const second = node.querySelectorAll(".list-input")[1];
    second.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "Backspace", bubbles: false, cancelable: true }));

    expect(app.$(".node.type-list").querySelectorAll(".list-row")).toHaveLength(1);
  });
});

describe("week blocks", () => {
  it("starts with one ticket row and an auto-filled week label", () => {
    app.click(app.$('.add-btn[data-type="week"]'));
    const wk = app.$(".node.type-week");
    expect(wk.querySelectorAll(".ticket-row")).toHaveLength(1);
    expect(wk.querySelector(".wk-label").value).toMatch(/^Week of /);
  });

  it("appends a ticket row from the + button", () => {
    app.click(app.$('.add-btn[data-type="week"]'));
    app.click(app.$(".node.type-week .add-item-btn"));
    expect(app.$(".node.type-week").querySelectorAll(".ticket-row")).toHaveLength(2);
  });
});

describe("built-in blocks backed by the type schema", () => {
  it("renders a ticket's five schema fields", () => {
    app.click(app.$('.add-btn[data-type="ticket"]'));
    const keys = [...app.$(".node.type-ticket").querySelectorAll("[data-fk]")].map((e) => e.dataset.fk);
    expect(keys).toEqual(["ticketNo", "link", "assigned", "customer", "bodyHtml"]);
  });

  it("GOTCHA: note/question keep their body in top-level bodyHtml, fields stays empty", async () => {
    app.click(app.$('.add-btn[data-type="note"]'));
    const body = app.$(".node.type-note .cf-rich");
    app.typeRich(body, "remember this");
    app.blur(body);
    await tick(20);

    const dump = await exportJson(app);
    const note = dump.boards[0].nodes.find((n) => n.type === "note");
    expect(note.bodyHtml).toBe("remember this");
    expect(note.fields).toEqual({});
  });

  it("GOTCHA: ticket fields also live at top level, not under fields", async () => {
    app.click(app.$('.add-btn[data-type="ticket"]'));
    const node = app.$(".node.type-ticket");
    app.type(node.querySelector('[data-fk="ticketNo"]'), "INC-4242");
    app.type(node.querySelector('[data-fk="customer"]'), "Acme");
    await tick(20);

    const dump = await exportJson(app);
    const t = dump.boards[0].nodes.find((n) => n.type === "ticket");
    expect(t.ticketNo).toBe("INC-4242");
    expect(t.customer).toBe("Acme");
    expect(t.fields).toEqual({});
  });
});
