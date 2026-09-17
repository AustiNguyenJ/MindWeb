import { describe, it, expect, beforeEach } from "vitest";
import { createApp, DEFAULT_ENTRY } from "./harness.js";

/* The original file carried 17 literal \uXXXX sequences in its markup, where
   they rendered as visible text rather than as characters -- the Search button
   read "⇧F" instead of "⇧F", Favorites read "★" instead of "★".
   These were fixed when the markup moved into index.html, so the check is
   skipped against the untouched baseline, which still contains them. */
const onBaseline = DEFAULT_ENTRY.includes("original");

let app;
beforeEach(async () => { app = await createApp(); });

describe.skipIf(onBaseline)("markup renders real characters, not escape sequences", () => {
  it("leaves no literal \\uXXXX anywhere in the rendered page", () => {
    const text = app.document.body.textContent;
    expect(text).not.toMatch(/\\u[0-9a-fA-F]{4}/);
  });

  it("shows the search shortcut as ⇧F", () => {
    expect(app.$("#searchTrigger kbd").textContent).toBe("⇧F");
  });

  it("shows the favorites star", () => {
    expect(app.$(".fav-star").textContent).toBe("★");
  });

  it("shows the picker hint arrows and separators", () => {
    const hint = app.$(".picker-hint").textContent;
    expect(hint).toContain("↑↓");
    expect(hint).toContain("·");
  });

  it("shows the block picker placeholder with a real ellipsis", () => {
    expect(app.$("#pickerInput").placeholder).toBe("Pick a block… (type to filter)");
  });

  it("uses em dashes and curly quotes in the help text", () => {
    const help = app.$(".help-body").textContent;
    expect(help).toContain("—");
    expect(help).toContain("“Repeating rows”");
    expect(help).not.toContain("u2014");
  });
});
