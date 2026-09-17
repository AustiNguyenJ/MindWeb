import { describe, it, expect, beforeEach } from "vitest";
import { createApp, tick } from "./harness.js";

let app;
beforeEach(async () => { app = await createApp(); });

const pageNames = () => app.$$(".board-item .bname").map((e) => e.textContent);
const menuFor = (pageId) => {
  app.click(app.$(`.board-menu-btn[data-id="${pageId}"]`));
  return app.$("#pageMenu");
};
const pageIdAt = (i) => app.$$(".board-item")[i].dataset.id;

describe("notebooks", () => {
  it("adds a notebook and drops straight into renaming it", () => {
    app.click(app.$("#newNotebookBtn"));
    expect(app.$$(".nb")).toHaveLength(2);

    const input = app.$(".nb-name input");
    expect(input).toBeTruthy();
    input.value = "Operations";
    input.dispatchEvent(new app.window.Event("blur"));

    expect(app.notebookNames()).toEqual(["My Notebook", "Operations"]);
  });

  it("collapses and expands on a header click", () => {
    const head = app.$(".nb-head");
    app.click(head);
    expect(app.$(".nb").classList.contains("collapsed")).toBe(true);
    app.click(app.$(".nb-head"));
    expect(app.$(".nb").classList.contains("collapsed")).toBe(false);
  });

  it("adds a page into the notebook whose + was clicked", () => {
    app.click(app.$("#newNotebookBtn"));
    app.$(".nb-name input").dispatchEvent(new app.window.Event("blur"));

    app.click(app.$$(".nb-add-page")[1]);
    expect(app.$$(".nb")[1].querySelectorAll(".board-item")).toHaveLength(1);
  });

  it("renames from the pencil button", () => {
    app.click(app.$(".nb-rename"));
    const input = app.$(".nb-name input");
    input.value = "Renamed";
    input.dispatchEvent(new app.window.Event("blur"));
    expect(app.notebookNames()).toEqual(["Renamed"]);
  });

  it("refuses to delete the last remaining notebook", () => {
    app.click(app.$(".nb-del-btn"));
    expect(app.$("#toast").textContent).toBe("Keep at least one notebook");
    expect(app.$$(".nb")).toHaveLength(1);
  });

  it("moves orphaned pages to another notebook when one is deleted", () => {
    app.click(app.$("#newNotebookBtn"));
    app.$(".nb-name input").dispatchEvent(new app.window.Event("blur"));
    app.click(app.$$(".nb-add-page")[1]);
    expect(app.$$(".board-item")).toHaveLength(2);

    app.click(app.$$(".nb-del-btn")[1]);
    expect(app.$$(".nb")).toHaveLength(1);
    expect(app.$$(".board-item")).toHaveLength(2); // both pages survived
  });
});

describe("pages", () => {
  it("creates a page and focuses its title for renaming", () => {
    app.click(app.$("#newBoardBtn"));
    expect(app.pages()).toHaveLength(2);
    expect(app.$("#boardTitle").value).toBe("Untitled page");
    expect(app.document.activeElement.id).toBe("boardTitle");
  });

  it("keeps the sidebar name in step with the header title", () => {
    app.type(app.$("#boardTitle"), "Renamed from header");
    expect(pageNames()).toEqual(["Renamed from header"]);
  });

  it("renames inline on double-click", () => {
    const item = app.$(".board-item");
    item.dispatchEvent(new app.window.MouseEvent("dblclick", { bubbles: true }));
    const input = item.querySelector("input");
    input.value = "Double-clicked";
    input.dispatchEvent(new app.window.Event("blur"));
    expect(pageNames()).toEqual(["Double-clicked"]);
  });

  it("switches the canvas when another page is opened", () => {
    app.click(app.$('.add-btn[data-type="note"]'));
    expect(app.nodes()).toHaveLength(2);

    app.click(app.$("#newBoardBtn"));
    expect(app.nodes()).toHaveLength(0);

    app.click(app.$$(".board-item")[0]);
    expect(app.nodes()).toHaveLength(2);
  });

  it("refuses to delete the only page", () => {
    app.click(app.$("#toast"));
    const menu = menuFor(pageIdAt(0));
    app.click(menu.querySelector('[data-act="del"]'));
    expect(app.$("#toast").textContent).toBe("Can't delete your only page");
    expect(app.pages()).toHaveLength(1);
  });

  it("deletes a page once there is more than one", () => {
    app.click(app.$("#newBoardBtn"));
    expect(app.pages()).toHaveLength(2);

    const menu = menuFor(pageIdAt(1));
    app.click(menu.querySelector('[data-act="del"]'));
    expect(app.pages()).toHaveLength(1);
  });
});

describe("the page context menu", () => {
  it("offers open, pin, rename, duplicate and delete", () => {
    const menu = menuFor(pageIdAt(0));
    const labels = [...menu.querySelectorAll(".pm-item")].map((b) => b.textContent);
    expect(labels).toEqual(["Open", "Pin to top", "Rename", "Duplicate page", "Delete page"]);
  });

  it("opens on right-click too", () => {
    app.$(".board-item").dispatchEvent(
      new app.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true })
    );
    expect(app.$("#pageMenu")).toBeTruthy();
  });

  it("closes on Escape", () => {
    menuFor(pageIdAt(0));
    app.key(null, "Escape");
    expect(app.$("#pageMenu")).toBeNull();
  });

  it("duplicates a whole page, blocks and connections included", async () => {
    app.click(app.$('.add-btn[data-type="note"]'));
    app.type(app.$(".node.type-note .node-title"), "Original content");
    await tick(20);

    const menu = menuFor(pageIdAt(0));
    app.click(menu.querySelector('[data-act="dupe"]'));

    expect(app.pages()).toHaveLength(2);
    expect(pageNames()).toContain("My first mind map copy");
    // the copy is opened, and carries the same blocks
    expect(app.$(".node.type-note .node-title").value).toBe("Original content");
  });

  it("gives the duplicate fresh block ids so the pages are independent", async () => {
    app.click(app.$('.add-btn[data-type="note"]'));
    await tick(20);
    const menu = menuFor(pageIdAt(0));
    app.click(menu.querySelector('[data-act="dupe"]'));

    app.type(app.$(".node.type-note .node-title"), "Only on the copy");
    app.click(app.$$(".board-item")[0]);      // back to the original
    expect(app.$(".node.type-note .node-title").value).not.toBe("Only on the copy");
  });
});

describe("pinning and favorites", () => {
  it("hides the favorites strip until something is pinned", () => {
    expect(app.$("#favWrap").style.display).toBe("none");
  });

  it("pins a page, showing it in favorites with a star", () => {
    const menu = menuFor(pageIdAt(0));
    app.click(menu.querySelector('[data-act="pin"]'));

    expect(app.$("#favWrap").style.display).not.toBe("none");
    expect(app.$("#favCount").textContent).toBe("1");
    expect(app.$(".fav-item .fav-name").textContent).toBe("My first mind map");
    expect(app.$(".board-item .pin-ico")).toBeTruthy();
    expect(app.$("#toast").textContent).toBe("Pinned to top");
  });

  it("unpins from the star in the favorites row", () => {
    app.click(menuFor(pageIdAt(0)).querySelector('[data-act="pin"]'));
    app.click(app.$(".fav-unstar"));
    expect(app.$("#favWrap").style.display).toBe("none");
    expect(app.$("#toast").textContent).toBe("Unpinned");
  });

  it("sorts pinned pages above unpinned ones", () => {
    app.click(app.$("#newBoardBtn"));
    app.type(app.$("#boardTitle"), "Second");
    expect(pageNames()).toEqual(["My first mind map", "Second"]);

    // pin the second page; it should jump to the top of its notebook
    app.click(menuFor(pageIdAt(1)).querySelector('[data-act="pin"]'));
    expect(pageNames()).toEqual(["Second", "My first mind map"]);
  });

  it("opens a page from the favorites strip", () => {
    app.click(app.$('.add-btn[data-type="note"]'));
    app.click(menuFor(pageIdAt(0)).querySelector('[data-act="pin"]'));
    app.click(app.$("#newBoardBtn"));
    expect(app.nodes()).toHaveLength(0);

    app.click(app.$(".fav-item"));
    expect(app.nodes()).toHaveLength(2);
  });

  it("collapses the favorites strip", () => {
    app.click(menuFor(pageIdAt(0)).querySelector('[data-act="pin"]'));
    app.click(app.$("#favHead"));
    expect(app.$("#favWrap").classList.contains("collapsed")).toBe(true);
  });
});
