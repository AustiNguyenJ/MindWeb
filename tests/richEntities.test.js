import { describe, it, expect, beforeEach } from "vitest";
import { createApp, exportJson, tick, waitFor, DEFAULT_ENTRY } from "./harness.js";

/* A contenteditable stores a typed > < & as &gt; &lt; &amp; with no tag, which
   the original's tag-only "is this HTML?" test mistook for legacy plain text and
   re-escaped. Fixed in the app only; the untouched baseline still has it. */
const onBaseline = DEFAULT_ENTRY.includes("original");

let app;
beforeEach(async () => { app = await createApp(); });

const noteBody = () => app.$(".node.type-note .cf-rich");

/** The theme toggle runs a full renderBoard(), re-reading every stored value. */
function rerender() { app.click(app.$("#themeToggleBtn")); }

function setSelect(el, value) {
  el.value = value;
  el.dispatchEvent(new app.window.Event("change", { bubbles: true }));
}

function importFile(payload) {
  const file = new app.window.File([JSON.stringify(payload)], "backup.json", { type: "application/json" });
  const input = app.$("#jsonFileInput");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new app.window.Event("change", { bubbles: true }));
}

describe.skipIf(onBaseline)("rich text holding > < & without any tag", () => {
  it("shows the characters, not entities, after a re-render", () => {
    app.click(app.$('.add-btn[data-type="note"]'));
    app.typeRich(noteBody(), "a > b");
    app.blur(noteBody());
    rerender();

    expect(noteBody().textContent).toBe("a > b");
    expect(noteBody().innerHTML).toBe("a &gt; b");
  });

  it("does not grow another escaping layer across repeated blur and re-render", async () => {
    app.click(app.$('.add-btn[data-type="note"]'));
    app.typeRich(noteBody(), "x < y &amp; z");
    app.blur(noteBody());
    rerender();
    app.blur(noteBody());
    rerender();
    app.blur(noteBody());
    await tick(20);

    expect(noteBody().textContent).toBe("x < y & z");
    const dump = await exportJson(app);
    const note = dump.boards[0].nodes.find((n) => n.type === "note");
    expect(note.bodyHtml).toBe("x &lt; y &amp; z");
  });

  it("leaves a formatted value alone", () => {
    app.click(app.$('.add-btn[data-type="note"]'));
    app.typeRich(noteBody(), "<b>x</b> a &gt; b");
    app.blur(noteBody());
    rerender();

    expect(noteBody().innerHTML).toBe("<b>x</b> a &gt; b");
  });

  it("still renders a legacy plain-text value, newlines included", async () => {
    const dump = await exportJson(app);
    dump.boards[0].nodes.push({
      id: "n_legacy", type: "note", x: 200, y: 200, w: 260, title: "legacy",
      bodyHtml: "a > b\nsecond & line",
    });
    importFile(dump);
    await waitFor(() => app.$("#toast").textContent === "Imported", { label: "import to finish" });
    app.click(app.pages()[1]);

    const body = [...app.$$(".node.type-note .cf-rich")].find((b) => b.textContent.includes("second"));
    expect(body.innerHTML).toBe("a &gt; b<br>second &amp; line");
  });

  describe("in a repeating-group rich cell", () => {
    async function groupCell() {
      app.click(app.$("#designBlocksBtn"));
      app.click(app.$("#bdNewType"));
      app.type(app.$("#bdName"), "Runbook");
      setSelect(app.$("#bdFields .bd-fkind"), "group");
      app.click(app.$("#bdDone"));
      app.click(app.$("#customTypeBtns .add-btn"));
      app.click(app.$("#canvasInner .node:not(.type-header) .grow-add"));
      return app.$("#canvasInner .node:not(.type-header) .grich");
    }

    it("shows the characters and stays stable across re-renders", async () => {
      const cell = await groupCell();
      app.typeRich(cell, "p &gt; q");
      app.blur(cell);
      rerender();
      app.blur(app.$(".grich"));
      rerender();
      await tick(20);

      expect(app.$(".grich").textContent).toBe("p > q");
      const dump = await exportJson(app);
      const n = dump.boards[0].nodes.find((x) => x.type.startsWith("ct_"));
      const rows = Object.values(n.fields).find(Array.isArray);
      expect(Object.values(rows[0]).join("")).toBe("p &gt; q");
    });

    it("is found by searching for the raw character", async () => {
      const cell = await groupCell();
      app.typeRich(cell, "p &gt; q");
      app.blur(cell);
      await tick(20);

      app.document.activeElement?.blur?.();
      app.key(null, "F", { shiftKey: true });
      app.type(app.$("#searchInput"), ">");
      expect(app.$$("#resultsList .result-item")).toHaveLength(1);
    });
  });
});
