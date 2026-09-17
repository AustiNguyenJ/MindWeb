import { describe, it, expect, beforeEach } from "vitest";
import { createApp, exportJson, tick } from "./harness.js";

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
    expect(app.$$(".node.type-note .fmt-bar button[data-cmd]").map((b) => b.dataset.cmd))
      .toEqual(["bold", "italic", "insertUnorderedList", "insertOrderedList", "createLink", "unlink", "copytext"]);
    expect(body).toBeTruthy();
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
