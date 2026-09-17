import { describe, it, expect, beforeEach } from "vitest";
import { createApp, tick } from "./harness.js";

let app;
beforeEach(async () => { app = await createApp(); });

const results = () => app.$$("#resultsList .result-item");
const titles = () => app.$$("#resultsList .result-title").map((e) => e.textContent);

function search(term) {
  app.document.activeElement?.blur?.();
  app.key(null, "F", { shiftKey: true });
  app.type(app.$("#searchInput"), term);
}

describe("search", () => {
  it("opens on Shift+F and closes on Escape", () => {
    app.document.activeElement?.blur?.();
    app.key(null, "F", { shiftKey: true });
    expect(app.$("#searchOverlay").classList.contains("open")).toBe(true);

    app.key(null, "Escape");
    expect(app.$("#searchOverlay").classList.contains("open")).toBe(false);
  });

  it("opens from the sidebar button too", () => {
    app.click(app.$("#searchTrigger"));
    expect(app.$("#searchOverlay").classList.contains("open")).toBe(true);
  });

  it("finds a block by its title and highlights the match", () => {
    app.click(app.$('.add-btn[data-type="note"]'));
    app.type(app.$(".node.type-note .node-title"), "Widget rollout");

    search("widget");
    expect(results()).toHaveLength(1);
    expect(titles()[0]).toContain("Widget rollout");
    expect(app.$("#resultsList mark")).toBeTruthy();
  });

  it("offers all-notebooks, this-notebook and this-page scopes", () => {
    search("");
    const chips = app.$$(".sm-scope").map((c) => c.textContent);
    expect(chips).toEqual(["All notebooks", "My Notebook", "This page"]);
    expect(app.$(".sm-scope.active").textContent).toBe("All notebooks");
  });

  it("narrows to the current page when the page scope is picked", () => {
    app.click(app.$('.add-btn[data-type="note"]'));
    app.type(app.$(".node.type-note .node-title"), "findme alpha");
    app.click(app.$("#newBoardBtn"));                     // second page
    app.click(app.$('.add-btn[data-type="note"]'));
    app.type(app.$(".node.type-note .node-title"), "findme beta");

    search("findme");
    expect(results()).toHaveLength(2);

    app.click(app.$$(".sm-scope")[2]);                    // "This page"
    expect(results()).toHaveLength(1);
    expect(titles()[0]).toContain("beta");
  });

  it("jumps to the top hit on Enter and flashes it", () => {
    app.click(app.$('.add-btn[data-type="note"]'));
    app.type(app.$(".node.type-note .node-title"), "target block");
    search("target");
    app.key(app.$("#searchInput"), "Enter");

    expect(app.$("#searchOverlay").classList.contains("open")).toBe(false);
    expect(app.$(".node.search-hit")).toBeTruthy();
  });

  it("reports when nothing matches", () => {
    search("nothing-matches-this");
    expect(app.$("#resultsList .no-results")).toBeTruthy();
  });

  it("finds a ticket by its number (top-level field, not node.fields)", () => {
    app.click(app.$('.add-btn[data-type="ticket"]'));
    app.type(app.$('.node.type-ticket [data-fk="ticketNo"]'), "INC-9001");
    search("INC-9001");
    expect(results()).toHaveLength(1);
  });

  it("finds text typed into a list row", () => {
    app.click(app.$('.add-btn[data-type="list"]'));
    app.type(app.$(".node.type-list .list-input"), "buy milk");
    search("milk");
    expect(results()).toHaveLength(1);
  });

  it("finds text typed into a week ticket row", () => {
    app.click(app.$('.add-btn[data-type="week"]'));
    app.type(app.$(".node.type-week .tr-customer"), "Globex");
    search("Globex");
    expect(results()).toHaveLength(1);
  });

  /* KNOWN PRE-EXISTING BUG, pinned so the refactor cannot change it silently.
     nodeHaystack() indexes n.title, n.body, n.items, n.tickets and the explicit
     list [ticketNo, link, assigned, customer, weekLabel, <walk of n.fields>].
     It never reads n.bodyHtml. Note/question/ticket render through the custom
     -field path, so their body is written to the top-level bodyHtml property
     (bodyHtml is in BUILTIN_KEYS) and node.body is never populated -- leaving
     the most-typed content in the app unsearchable. Fix would be to read
     through fieldVal(node, key) rather than walking node.fields directly. */
  it("does NOT index a note's body text (known bug)", async () => {
    app.click(app.$('.add-btn[data-type="note"]'));
    const body = app.$(".node.type-note .cf-rich");
    app.typeRich(body, "zephyrquux");
    app.blur(body);
    await tick(20);

    search("zephyrquux");
    expect(results()).toHaveLength(0);
  });

  it("does NOT index a ticket's note text either (known bug, same cause)", async () => {
    app.click(app.$('.add-btn[data-type="ticket"]'));
    const body = app.$('.node.type-ticket [data-fk="bodyHtml"]');
    app.typeRich(body, "quuxzephyr");
    app.blur(body);
    await tick(20);

    search("quuxzephyr");
    expect(results()).toHaveLength(0);
  });

  it("does index a custom block's body text, which goes through node.fields", async () => {
    // contrast case: a user-defined type has no BUILTIN_KEYS collision, so its
    // values land in node.fields and the haystack walk picks them up.
    app.click(app.$("#designBlocksBtn"));
    app.click(app.$("#bdNewType"));
    app.click(app.$("#bdDone"));

    app.click(app.$("#customTypeBtns .add-btn"));
    const input = app.$(".node .cf-input");
    app.type(input, "discoverable");
    await tick(20);

    search("discoverable");
    expect(results()).toHaveLength(1);
  });
});
