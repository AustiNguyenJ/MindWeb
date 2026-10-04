import { describe, it, expect, beforeEach } from "vitest";
import { createApp, exportJson, tick, DEFAULT_ENTRY } from "./harness.js";

// the richer formatting bar (underline, strikethrough, font size, highlight)
// is new, app-only behavior -- the untouched original only ever had the
// seven commands checked below
const onBaseline = DEFAULT_ENTRY.includes("original");

let app;
beforeEach(async () => { app = await createApp(); });

/** Put a note on the canvas and hand back its editable body. */
function noteBody() {
  app.click(app.$('.add-btn[data-type="note"]'));
  return app.$(".node.type-note .cf-rich");
}

describe("rich-text sanitising", () => {
  it("drops script tags and their contents on blur", () => {
    const body = noteBody();
    app.typeRich(body, "<b>keep this</b><script>window.__pwned = true;</script>");
    app.blur(body);

    expect(app.$(".node.type-note .cf-rich").innerHTML).toBe("<b>keep this</b>");
    expect(app.window.__pwned).toBeUndefined();
  });

  it("unwraps tags that are not on the allow list", () => {
    const body = noteBody();
    app.typeRich(body, '<div><img src="x" onerror="window.__pwned=1"><span>text</span></div>');
    app.blur(body);

    const html = app.$(".node.type-note .cf-rich").innerHTML;
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/onerror/i);
    expect(html).toContain("text");
  });

  it("strips event-handler and style attributes but keeps href", () => {
    const body = noteBody();
    app.typeRich(body, '<a href="https://example.com" onclick="window.__pwned=1" style="color:red">link</a>');
    app.blur(body);

    const a = app.$(".node.type-note .cf-rich a");
    expect(a.getAttribute("href")).toBe("https://example.com");
    expect(a.hasAttribute("onclick")).toBe(false);
    expect(a.hasAttribute("style")).toBe(false);
  });

  it("removes javascript: and data:text/html hrefs", () => {
    const body = noteBody();
    app.typeRich(body, '<a href="javascript:alert(1)">a</a><a href="data:text/html;base64,xx">b</a>');
    app.blur(body);

    const hrefs = [...app.$$(".node.type-note .cf-rich a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([null, null]);
  });

  it("forces links to open in a new tab, safely", () => {
    const body = noteBody();
    app.typeRich(body, '<a href="https://example.com">link</a>');
    app.blur(body);

    const a = app.$(".node.type-note .cf-rich a");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("keeps the sanitised html as the stored value", async () => {
    const body = noteBody();
    app.typeRich(body, "<b>bold</b><script>1</script>");
    app.blur(body);
    await tick(20);

    const dump = await exportJson(app);
    const note = dump.boards[0].nodes.find((n) => n.type === "note");
    expect(note.bodyHtml).toBe("<b>bold</b>");
  });
});

describe("the formatting bar", () => {
  it("appears only on the selected block", () => {
    const body = noteBody();
    expect(app.$(".node.type-note .fmt-bar")).toBeTruthy();
    expect(body).toBeTruthy();
  });

  it.skipIf(onBaseline)("offers the full set of formatting commands", () => {
    noteBody();
    expect(app.$$(".node.type-note .fmt-bar button[data-cmd]").map((b) => b.dataset.cmd)).toEqual([
      "bold", "italic", "underline", "strikeThrough",
      "fontSizeDown", "fontSizeUp",
      "insertUnorderedList", "insertOrderedList",
      "createLink", "unlink",
      "highlight", "removeHighlight",
      "copytext",
    ]);
  });

  function selectAllText(win, el) {
    const range = win.document.createRange();
    range.selectNodeContents(el);
    const sel = win.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  it.skipIf(onBaseline)("highlights selected text from the toolbar", () => {
    const body = noteBody();
    app.typeRich(body, "highlight me");
    app.focus(body);
    selectAllText(app.window, body);
    app.click(app.$('.node.type-note .fmt-bar button[data-cmd="highlight"]'));

    const span = app.$(".node.type-note .cf-rich span");
    expect(span).toBeTruthy();
    expect(span.style.backgroundColor).toBeTruthy();
    expect(span.textContent).toBe("highlight me");
  });

  it.skipIf(onBaseline)("removes an existing highlight from the toolbar", () => {
    const body = noteBody();
    app.typeRich(body, '<span style="background-color:#ffeb3b66">highlight me</span>');
    app.focus(body);
    selectAllText(app.window, body);
    app.click(app.$('.node.type-note .fmt-bar button[data-cmd="removeHighlight"]'));
    expect(app.$(".node.type-note .cf-rich span")).toBeNull();
  });

  it.skipIf(onBaseline)("toggles the same highlight back off on a second press, without re-selecting", () => {
    const body = noteBody();
    app.typeRich(body, "highlight me");
    app.focus(body);
    selectAllText(app.window, body);
    const btn = app.$('.node.type-note .fmt-bar button[data-cmd="highlight"]');
    app.click(btn);
    // deliberately NOT re-selecting here -- the whole point is that the
    // first click must leave a selection the second click both sees (so it
    // knows to toggle off) and can still act on
    app.click(btn);

    expect(app.$(".node.type-note .cf-rich span")).toBeNull();
  });

  it.skipIf(onBaseline)("removes a pre-existing highlight with the Ctrl+H shortcut", () => {
    const body = noteBody();
    app.typeRich(body, '<span style="background-color:#ffeb3b66">highlight me</span>');
    app.focus(body);
    selectAllText(app.window, body);
    app.key(body, "h", { ctrlKey: true });

    expect(app.$(".node.type-note .cf-rich span")).toBeNull();
  });

  it.skipIf(onBaseline)("leaves no stray rangy marker behind after removing a highlight", () => {
    const body = noteBody();
    app.typeRich(body, '<span style="background-color:#ffeb3b66">highlight me</span>');
    app.focus(body);
    selectAllText(app.window, body);
    app.click(app.$('.node.type-note .fmt-bar button[data-cmd="removeHighlight"]'));

    const html = app.$(".node.type-note .cf-rich").innerHTML;
    expect(html).not.toMatch(/rangySelectionBoundary|selectionBoundary_/);
    expect(html).toBe("highlight me");
  });

  it.skipIf(onBaseline)("survives sanitizing on blur", () => {
    const body = noteBody();
    app.typeRich(body, "highlight me");
    app.focus(body);
    selectAllText(app.window, body);
    app.click(app.$('.node.type-note .fmt-bar button[data-cmd="highlight"]'));
    app.blur(app.$(".node.type-note .cf-rich"));

    const span = app.$(".node.type-note .cf-rich span");
    expect(span).toBeTruthy();
    expect(span.style.backgroundColor).toBeTruthy();
  });

  it.skipIf(onBaseline)("grows the selected text's font size", () => {
    const body = noteBody();
    app.typeRich(body, "resize me");
    app.focus(body);
    selectAllText(app.window, body);
    app.click(app.$('.node.type-note .fmt-bar button[data-cmd="fontSizeUp"]'));

    const span = app.$(".node.type-note .cf-rich span");
    expect(span.style.fontSize).toBe("16px");
  });

  it.skipIf(onBaseline)("grows the font size again on a second press, without re-selecting", () => {
    const body = noteBody();
    app.typeRich(body, "resize me");
    app.focus(body);
    selectAllText(app.window, body);
    const btn = app.$('.node.type-note .fmt-bar button[data-cmd="fontSizeUp"]');
    app.click(btn);
    // deliberately NOT re-selecting here -- the whole point is that the
    // first click must not have collapsed the selection the second click
    // needs
    app.click(btn);

    const span = app.$(".node.type-note .cf-rich span");
    expect(span.style.fontSize).toBe("20px");
  });

  it.skipIf(onBaseline)("does not collapse the selection when a toolbar command leaves the content unchanged", () => {
    const body = noteBody();
    app.typeRich(body, "resize me");
    app.focus(body);
    selectAllText(app.window, body);
    app.click(app.$('.node.type-note .fmt-bar button[data-cmd="bold"]'));

    // the command already mutated the live DOM (or, as in jsdom, left it
    // untouched) before this handler sanitizes and writes back -- an
    // unconditional innerHTML reassignment here would collapse the
    // selection even though nothing actually changed
    expect(app.window.getSelection().isCollapsed).toBe(false);
  });

  it.skipIf(onBaseline)("keeps the selection alive across a second shortcut press", () => {
    const body = noteBody();
    app.typeRich(body, "shortcut me");
    app.focus(body);
    selectAllText(app.window, body);
    app.key(body, "b", { ctrlKey: true });

    expect(app.window.getSelection().isCollapsed).toBe(false);

    app.key(body, "i", { ctrlKey: true });
    expect(app.window.getSelection().isCollapsed).toBe(false);
  });

  it.skipIf(onBaseline)("toggles highlight with Ctrl+H", () => {
    const body = noteBody();
    app.typeRich(body, "shortcut me");
    app.focus(body);
    selectAllText(app.window, body);
    app.key(body, "h", { ctrlKey: true });

    const span = app.$(".node.type-note .cf-rich span");
    expect(span).toBeTruthy();
    expect(span.style.backgroundColor).toBeTruthy();
  });

  it.skipIf(onBaseline)("prevents the default action for Ctrl+B/I/U so the browser can't hijack them", () => {
    const body = noteBody();
    app.focus(body);

    expect(app.key(body, "b", { ctrlKey: true })).toBe(false);
    expect(app.key(body, "i", { ctrlKey: true })).toBe(false);
    expect(app.key(body, "u", { ctrlKey: true })).toBe(false);
  });

  it.skipIf(onBaseline)("does not prevent plain b/i/u typing", () => {
    const body = noteBody();
    app.focus(body);

    expect(app.key(body, "b")).toBe(true);
    expect(app.key(body, "i")).toBe(true);
    expect(app.key(body, "u")).toBe(true);
  });

  it("inserts a link from the prompt when nothing is selected", () => {
    const body = noteBody();
    app.focus(body);
    app.rec.promptReply = "example.com";
    app.click(app.$('.node.type-note .fmt-bar button[data-cmd="createLink"]'));

    const a = app.$(".node.type-note .cf-rich a");
    expect(a.getAttribute("href")).toBe("https://example.com");
  });

  it("does nothing when the link prompt is cancelled", () => {
    const body = noteBody();
    app.focus(body);
    app.rec.promptReply = "";
    app.click(app.$('.node.type-note .fmt-bar button[data-cmd="createLink"]'));
    expect(app.$(".node.type-note .cf-rich a")).toBeNull();
  });

  it("copies the block's text as plain text", () => {
    const body = noteBody();
    app.typeRich(body, "<b>copy</b> me");
    app.blur(body);
    app.focus(app.$(".node.type-note .cf-rich"));
    app.click(app.$('.node.type-note .fmt-bar button[data-cmd="copytext"]'));

    expect(app.rec.copied[app.rec.copied.length - 1]).toBe("copy me");
  });
});

describe.skipIf(onBaseline)("repeating-group rich subfields", () => {
  function setSelect(el, value) {
    el.value = value;
    el.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  }

  function selectAllText(win, el) {
    const range = win.document.createRange();
    range.selectNodeContents(el);
    const sel = win.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  it("writes toolbar edits to the row, not to node.fields.undefined", async () => {
    app.click(app.$("#designBlocksBtn"));
    app.click(app.$("#bdNewType"));
    app.type(app.$("#bdName"), "Runbook");
    setSelect(app.$("#bdFields .bd-fkind"), "group");
    app.click(app.$("#bdDone"));

    app.click(app.$("#customTypeBtns .add-btn"));
    let node = app.$("#canvasInner .node:not(.type-header)");
    app.click(node.querySelector(".grow-add"));
    node = app.$("#canvasInner .node:not(.type-header)");

    const grich = node.querySelector(".grich");
    app.typeRich(grich, "highlight me");
    app.focus(grich);
    selectAllText(app.window, grich);
    app.click(node.querySelector('.fmt-bar button[data-cmd="highlight"]'));
    await tick(20);

    const gk = grich.dataset.gk, sk = grich.dataset.sk;
    const dump = await exportJson(app);
    const n = dump.boards[0].nodes.find((x) => x.type.startsWith("ct_"));
    expect(n.fields.undefined).toBeUndefined();
    expect(n.fields[gk][0][sk]).toMatch(/<span/);
  });
});

describe("copy buttons", () => {
  it("copies a ticket's whole record", async () => {
    app.click(app.$('.add-btn[data-type="ticket"]'));
    const node = app.$(".node.type-ticket");
    app.type(node.querySelector('[data-fk="ticketNo"]'), "INC-7");
    app.type(node.querySelector('[data-fk="customer"]'), "Acme");
    await tick(10);

    app.click(app.$(".node.type-ticket .cf-copyall"));
    const copied = app.rec.copied[app.rec.copied.length - 1];
    expect(copied).toContain("INC-7");
    expect(copied).toContain("Acme");
  });

  it("copies a whole week, label included", async () => {
    app.click(app.$('.add-btn[data-type="week"]'));
    app.type(app.$(".node.type-week .tr-no"), "INC-1");
    await tick(10);

    app.click(app.$(".node.type-week .cp-week"));
    const copied = app.rec.copied[app.rec.copied.length - 1];
    expect(copied).toMatch(/^Week of /);
    expect(copied).toContain("INC-1");
  });

  it("says so rather than copying nothing", () => {
    app.click(app.$('.add-btn[data-type="week"]'));
    // a fresh week still copies its auto-filled label, so clear that first
    app.type(app.$(".node.type-week .wk-label"), "");
    app.click(app.$(".node.type-week .cp-week"));
    expect(app.$("#toast").textContent).toBe("Nothing to copy");
  });
});

describe("view controls", () => {
  it("zooms in and out and reports the percentage", () => {
    expect(app.$("#zoomPct").textContent).toBe("100%");

    app.click(app.$("#zoomIn"));
    expect(app.$("#zoomPct").textContent).toBe("120%");

    app.click(app.$("#zoomOut"));
    expect(app.$("#zoomPct").textContent).toBe("100%");
  });

  it("clamps zoom at the extremes", () => {
    for (let i = 0; i < 30; i++) app.click(app.$("#zoomIn"));
    expect(parseInt(app.$("#zoomPct").textContent, 10)).toBe(220);

    for (let i = 0; i < 60; i++) app.click(app.$("#zoomOut"));
    expect(parseInt(app.$("#zoomPct").textContent, 10)).toBe(35);
  });

  it("recentres back to 100% on the reset button", () => {
    app.click(app.$("#zoomIn"));
    app.click(app.$("#zoomReset"));
    expect(app.$("#zoomPct").textContent).toBe("100%");
    expect(app.$("#canvasInner").style.transform).toContain("scale(1)");
  });
});
