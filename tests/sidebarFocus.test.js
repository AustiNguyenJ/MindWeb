import { describe, it, expect, beforeEach } from "vitest";
import { createApp, exportJson, tick, DEFAULT_ENTRY } from "./harness.js";

/* The sidebar's focus view: one notebook's level at a time (breadcrumb,
   sub-notebook rows, pages), a notebook switcher with the favorites in it, a
   page filter, and "Move to...". The untouched original shows the whole nested
   tree instead, so none of this exists there. */
const onBaseline = DEFAULT_ENTRY.includes("original");

/* A tree deep enough to need all of it:
 *
 *   Work: Work overview, Roadmap
 *     Projects: Project plan
 *       Alpha: Alpha spec (holds a note, "findme"), Alpha design
 *     Notes: Meeting notes
 *   Home: Home budget (holds a note, "budgetnote")
 *
 * The first page, "Work overview", is the one that opens. `collapsed` is set on
 * Work and Projects to prove the focus view never reads or rewrites it. */
function seedTree() {
  const nb = (id, name, parentId, order, collapsed = false) => ({ id, name, collapsed, parentId, order });
  const pg = (id, name, notebookId, order) => ({ id, name, description: "", notebookId, order, pinned: false });
  const note = (id, title) => ({ id, type: "note", x: 100, y: 100, w: 220, h: 140, title, bodyHtml: "", color: "#ffffff" });
  const boards = [
    [pg("p_over", "Work overview", "nb_work", 0), []],
    [pg("p_road", "Roadmap", "nb_work", 1), []],
    [pg("p_plan", "Project plan", "nb_proj", 0), []],
    [pg("p_spec", "Alpha spec", "nb_alpha", 0), [note("n_spec", "findme")]],
    [pg("p_desg", "Alpha design", "nb_alpha", 1), []],
    [pg("p_meet", "Meeting notes", "nb_notes", 0), []],
    [pg("p_bud", "Home budget", "nb_home", 0), [note("n_bud", "budgetnote")]],
  ];
  const seed = {
    "mindmap:index": JSON.stringify({
      version: 2,
      notebooks: [
        nb("nb_work", "Work", null, 0, true),
        nb("nb_proj", "Projects", "nb_work", 0, true),
        nb("nb_alpha", "Alpha", "nb_proj", 0),
        nb("nb_notes", "Notes", "nb_work", 1),
        nb("nb_home", "Home", null, 1),
      ],
      boards: boards.map(([b]) => b),
    }),
  };
  boards.forEach(([b, nodes]) => { seed["mindmap:board:" + b.id] = JSON.stringify({ nodes, connections: [] }); });
  return seed;
}

let app;
const boot = async () => { app = await createApp(undefined, { storage: seedTree() }); };

// ---- what's on screen ------------------------------------------------------
const crumbs = () => app.$$("#nbCrumbs .crumb").map((c) => c.textContent);
const subNames = () => app.$$("#notebookTree .sub-row .sub-name").map((n) => n.textContent);
const pageNames = () => app.$$("#notebookTree .board-item .bname").map((n) => n.textContent);
const openPageName = () => app.$("#boardTitle").value;
const toast = () => app.$("#toast").textContent;

const subRow = (name) => app.$$(".sub-row").find((r) => r.querySelector(".sub-name").textContent === name);
const pageRow = (name) => app.$$(".board-item").find((r) => r.querySelector(".bname")?.textContent === name);
const crumb = (name) => app.$$("#nbCrumbs .crumb[data-nb]").find((c) => c.textContent === name);
const drillTo = (name) => app.click(subRow(name));
const goUpTo = (name) => app.click(crumb(name));

// ---- the switcher ----------------------------------------------------------
const switcherOpen = () => !app.$("#nbSwitchPanel").hidden;
const openSwitcher = () => app.click(app.$("#nbSwitchBtn"));
const swRow = (name) => app.$$("#swTree .sw-nb").find((b) => b.querySelector(".nb-name").textContent === name);
const swNames = () => app.$$("#swTree .sw-nb .nb-name").map((n) => n.textContent);
const favNames = () => app.$$("#favList .fav-name").map((n) => n.textContent);
const outsideClick = () => app.pointer(app.$("#boardTitle"), "pointerdown", { button: 0 });

// ---- menus, filter, typing -------------------------------------------------
const pageMenu = (name) => {
  app.click(pageRow(name).querySelector(".board-menu-btn"));
  return app.$("#pageMenu");
};
const pageAct = (name, act) => app.click(pageMenu(name).querySelector(`[data-act="${act}"]`));
const nbMenuAct = (btnSelector, act) => {
  app.click(app.$(btnSelector));
  app.click(app.$(`#notebookMenu [data-act="${act}"]`));
};
const subMenuAct = (name, act) => nbMenuAct(`.sub-row[data-nb="${subRow(name).dataset.nb}"] .sub-menu-btn`, act);
const crumbMenuAct = (act) => nbMenuAct(".crumb-menu", act);
const setFilter = (text) => app.type(app.$("#pageFilter"), text);
const blurInput = (input) => input.dispatchEvent(new app.window.Event("blur"));
const confirmDelete = async () => { app.click(app.$("#confirmOkBtn")); await tick(10); };

function rename(inputSelector, name) {
  const input = app.$(inputSelector);
  input.value = name;
  blurInput(input);
}
function search(term) {
  app.document.activeElement?.blur?.();
  app.key(null, "F", { shiftKey: true });
  app.type(app.$("#searchInput"), term);
}
function ctrlClick(el) {
  el.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true, ctrlKey: true }));
}

// jsdom has neither DataTransfer nor DragEvent: a plain Event with a minimal
// fake dataTransfer carries the gesture (same approach as sidebar.test.js)
function fakeDataTransfer() {
  const data = new Map();
  return {
    setData: (k, v) => data.set(k, v),
    getData: (k) => data.get(k) ?? "",
    types: { includes: (k) => data.has(k) },
    effectAllowed: "", dropEffect: "",
  };
}
function fireDrag(el, type, dt, init = {}) {
  const e = new app.window.Event(type, { bubbles: true, cancelable: true });
  e.dataTransfer = dt;
  Object.assign(e, init);
  el.dispatchEvent(e);
}
/** `below` passes a clientY past the (zero-height, in jsdom) row's midpoint. */
function drag(sourceEl, targetEl, { below = false } = {}) {
  const dt = fakeDataTransfer();
  fireDrag(sourceEl, "dragstart", dt);
  fireDrag(targetEl, "dragover", dt, { clientY: below ? 1 : 0 });
  fireDrag(targetEl, "drop", dt, { clientY: below ? 1 : 0 });
  fireDrag(sourceEl, "dragend", dt);
}

const stripStamp = (dump) => ({ ...dump, exported: undefined });
const boardOf = (dump, id) => dump.boards.find((b) => b.id === id);
const notebookOf = (dump, id) => dump.notebooks.find((n) => n.id === id);

describe.skipIf(onBaseline)("focus view: one notebook level at a time", () => {
  beforeEach(boot);

  it("starts on the notebook of the open page", () => {
    expect(openPageName()).toBe("Work overview");
    expect(crumbs()).toEqual(["Work"]);
    expect(app.$("#nbSwitchLabel").textContent).toBe("Work");
  });

  it("shows the level's pages and its sub-notebooks, and nothing deeper", () => {
    expect(pageNames()).toEqual(["Work overview", "Roadmap"]);
    expect(subNames()).toEqual(["Projects", "Notes"]);
    expect(app.$$("#notebookTree .board-item")).toHaveLength(2);
  });

  it("draws each sub-notebook as a single row, with its page count and no nesting", () => {
    expect(app.$$("#notebookTree .sub-row")).toHaveLength(2);
    expect(app.$("#notebookTree .sub-row .sub-row")).toBeNull();
    expect(app.$("#notebookTree .sub-row .board-item")).toBeNull();
    // a row counts everything inside it, sub-notebooks included
    const counts = Object.fromEntries(app.$$(".sub-row").map((r) => [r.querySelector(".sub-name").textContent, r.querySelector(".sub-count").textContent]));
    expect(counts).toEqual({ Projects: "3", Notes: "1" });
    expect(subRow("Projects").title).toBe("3 pages · 1 sub-notebook");
    expect(subRow("Projects").querySelector(".sub-chev")).toBeTruthy();
  });

  it("drills into a sub-notebook on click, without opening a page", () => {
    drillTo("Projects");
    expect(crumbs()).toEqual(["Work", "Projects"]);
    expect(subNames()).toEqual(["Alpha"]);
    expect(pageNames()).toEqual(["Project plan"]);
    expect(openPageName()).toBe("Work overview");     // viewing is not opening
    expect(app.$$(".board-item.active")).toHaveLength(0);  // the open page is in another level
  });

  it("builds a breadcrumb for nested notebooks and drills back up through it", () => {
    drillTo("Projects");
    drillTo("Alpha");
    expect(crumbs()).toEqual(["Work", "Projects", "Alpha"]);
    expect(pageNames()).toEqual(["Alpha spec", "Alpha design"]);
    expect(subNames()).toEqual([]);

    goUpTo("Projects");
    expect(crumbs()).toEqual(["Work", "Projects"]);
    expect(subNames()).toEqual(["Alpha"]);

    goUpTo("Work");
    expect(crumbs()).toEqual(["Work"]);
    expect(subNames()).toEqual(["Projects", "Notes"]);
    expect(openPageName()).toBe("Work overview");
  });

  it("makes the ancestors buttons and the notebook in view plain, labelled text", () => {
    drillTo("Projects");
    drillTo("Alpha");
    expect(app.$$("#nbCrumbs .crumb[data-nb]").map((c) => c.tagName)).toEqual(["BUTTON", "BUTTON"]);
    const here = app.$("#nbCrumbs .crumb.current");
    expect(here.tagName).toBe("SPAN");
    expect(here.getAttribute("aria-current")).toBe("location");
  });

  it("keeps the switcher button on the top-level notebook at any depth", () => {
    drillTo("Projects");
    drillTo("Alpha");
    expect(app.$("#nbSwitchLabel").textContent).toBe("Work");
  });

  it("marks and opens a page from the level without moving the view", () => {
    app.click(pageRow("Roadmap"));
    expect(openPageName()).toBe("Roadmap");
    expect(crumbs()).toEqual(["Work"]);
    expect(pageRow("Roadmap").classList.contains("active")).toBe(true);
    expect(pageRow("Roadmap").getAttribute("aria-current")).toBe("page");
  });

  it("says so when a notebook has no pages", () => {
    expect(app.$(".nb-emptypages")).toBeNull();
    app.click(app.$("#newNotebookBtn"));
    rename(".sub-name input", "Empty");
    drillTo("Empty");
    expect(pageNames()).toEqual([]);
    expect(app.$("#notebookTree .nb-emptypages").textContent).toBe("No pages yet");
  });
});

describe.skipIf(onBaseline)("focus view: following the open page", () => {
  beforeEach(boot);

  it("follows a search jump into another notebook", () => {
    expect(crumbs()).toEqual(["Work"]);
    search("findme");
    app.key(app.$("#searchInput"), "Enter");
    expect(openPageName()).toBe("Alpha spec");
    expect(crumbs()).toEqual(["Work", "Projects", "Alpha"]);
    expect(pageRow("Alpha spec").classList.contains("active")).toBe(true);
  });

  it("jumps back to the open page's notebook after wandering off", () => {
    drillTo("Projects");
    drillTo("Alpha");
    search("budgetnote");
    app.key(app.$("#searchInput"), "Enter");
    expect(openPageName()).toBe("Home budget");
    expect(crumbs()).toEqual(["Home"]);
  });

  it("follows a favorite opened from the switcher", () => {
    drillTo("Projects");
    drillTo("Alpha");
    app.click(pageRow("Alpha spec"));
    pageAct("Alpha spec", "pin");
    goUpTo("Work");                       // wander back up; the open page stays in Alpha
    expect(crumbs()).toEqual(["Work"]);
    app.click(pageRow("Roadmap"));        // open something else, in Work
    expect(openPageName()).toBe("Roadmap");

    openSwitcher();
    app.click(app.$(".fav-item"));
    expect(openPageName()).toBe("Alpha spec");
    expect(crumbs()).toEqual(["Work", "Projects", "Alpha"]);
    expect(switcherOpen()).toBe(false);
  });

  it("puts a new page in the notebook in view and stays there", () => {
    drillTo("Notes");
    app.click(app.$("#newBoardBtn"));
    expect(crumbs()).toEqual(["Work", "Notes"]);
    expect(pageNames()).toEqual(["Meeting notes", "Untitled page"]);
    expect(openPageName()).toBe("Untitled page");
    expect(app.document.activeElement.id).toBe("boardTitle");
  });

  it("follows the next open page when the open page is deleted", async () => {
    search("findme");
    app.key(app.$("#searchInput"), "Enter");
    expect(crumbs()).toEqual(["Work", "Projects", "Alpha"]);

    pageAct("Alpha spec", "del");
    await confirmDelete();

    // the app falls back to the first page, which lives in Work
    expect(openPageName()).toBe("Work overview");
    expect(crumbs()).toEqual(["Work"]);
  });

  it("keeps the view where it is when a page elsewhere is deleted", async () => {
    drillTo("Projects");
    pageAct("Project plan", "del");
    await confirmDelete();
    expect(crumbs()).toEqual(["Work", "Projects"]);
    expect(openPageName()).toBe("Work overview");
  });

  it("follows a duplicate, which opens next to its original", () => {
    app.click(pageRow("Roadmap"));
    pageAct("Roadmap", "dupe");
    expect(openPageName()).toBe("Roadmap copy");
    expect(crumbs()).toEqual(["Work"]);
    expect(pageNames()).toContain("Roadmap copy");
  });
});

describe.skipIf(onBaseline)("focus view: the notebook switcher", () => {
  beforeEach(boot);

  it("starts closed", () => {
    expect(switcherOpen()).toBe(false);
    expect(app.$("#nbSwitchBtn").getAttribute("aria-expanded")).toBe("false");
  });

  it("opens and closes from its button", () => {
    openSwitcher();
    expect(switcherOpen()).toBe(true);
    expect(app.$("#nbSwitchBtn").getAttribute("aria-expanded")).toBe("true");
    openSwitcher();
    expect(switcherOpen()).toBe(false);
    expect(app.$("#nbSwitchBtn").getAttribute("aria-expanded")).toBe("false");
  });

  it("lists every notebook as an indented tree, with the one in view marked", () => {
    openSwitcher();
    expect(swNames()).toEqual(["Work", "Projects", "Alpha", "Notes", "Home"]);
    const depths = app.$$("#swTree .sw-nb").map((b) => b.getAttribute("style").match(/--depth:(\d+)/)[1]);
    expect(depths).toEqual(["0", "1", "2", "1", "0"]);
    expect(app.$$("#swTree .sw-nb.active").map((b) => b.querySelector(".nb-name").textContent)).toEqual(["Work"]);
    expect(app.$$("#swTree .sw-count").map((c) => c.textContent)).toEqual(["2", "1", "2", "1", "1"]);
  });

  it("closes on a click outside it, but not on a click inside", () => {
    openSwitcher();
    app.pointer(app.$("#swTree"), "pointerdown", { button: 0 });
    expect(switcherOpen()).toBe(true);
    outsideClick();
    expect(switcherOpen()).toBe(false);
    expect(app.$("#nbSwitchBtn").getAttribute("aria-expanded")).toBe("false");
  });

  it("closes when focus moves on to something outside it", () => {
    openSwitcher();
    app.$("#pageFilter").focus();
    expect(switcherOpen()).toBe(false);
  });

  it("stays open while focus moves between its own entries and its button", () => {
    openSwitcher();
    swRow("Notes").focus();
    app.$("#nbSwitchBtn").focus();
    expect(switcherOpen()).toBe(true);
  });

  it("closes on Escape and hands focus back to its button", () => {
    openSwitcher();
    app.key(null, "Escape");
    expect(switcherOpen()).toBe(false);
    expect(app.document.activeElement.id).toBe("nbSwitchBtn");
  });

  it("uses Escape for itself, leaving the canvas selection alone", async () => {
    app = await createApp();
    app.click(app.$('.add-btn[data-type="note"]'));
    expect(app.$$(".node.selected")).toHaveLength(1);

    openSwitcher();
    app.key(null, "Escape");
    expect(switcherOpen()).toBe(false);
    expect(app.$$(".node.selected")).toHaveLength(1);

    // with nothing of the sidebar's open, Escape still deselects as it always did
    app.key(null, "Escape");
    expect(app.$$(".node.selected")).toHaveLength(0);
  });

  it("views a chosen notebook without opening a page, and closes", () => {
    openSwitcher();
    app.click(swRow("Alpha"));
    expect(crumbs()).toEqual(["Work", "Projects", "Alpha"]);
    expect(pageNames()).toEqual(["Alpha spec", "Alpha design"]);
    expect(openPageName()).toBe("Work overview");
    expect(switcherOpen()).toBe(false);

    openSwitcher();
    app.click(swRow("Home"));
    expect(crumbs()).toEqual(["Home"]);
    expect(app.$("#nbSwitchLabel").textContent).toBe("Home");
  });

  it("keeps the favorites out of the main column and hides them until something is pinned", () => {
    expect(app.$("#nbSwitchPanel #favWrap")).toBeTruthy();
    expect(app.$("#listWrap > #favWrap")).toBeNull();
    expect(app.$("#favWrap").style.display).toBe("none");
  });

  it("lists pinned pages from every notebook, labelled with their notebook", () => {
    pageAct("Roadmap", "pin");
    drillTo("Notes");
    pageAct("Meeting notes", "pin");
    goUpTo("Work");

    openSwitcher();
    expect(app.$("#favWrap").style.display).not.toBe("none");
    expect(app.$("#favCount").textContent).toBe("2");
    expect(favNames()).toEqual(["Roadmap", "Meeting notes"]);
    expect(app.$$("#favList .fav-nb").map((n) => n.textContent)).toEqual(["Work", "Notes"]);
  });

  it("opens a favorite on click, viewing its notebook and closing the panel", () => {
    drillTo("Notes");
    pageAct("Meeting notes", "pin");
    goUpTo("Work");
    openSwitcher();
    app.click(app.$(".fav-item"));
    expect(openPageName()).toBe("Meeting notes");
    expect(crumbs()).toEqual(["Work", "Notes"]);
    expect(switcherOpen()).toBe(false);
  });

  it("unpins from the star in the panel and stays open", () => {
    pageAct("Roadmap", "pin");
    openSwitcher();
    app.click(app.$(".fav-unstar"));
    expect(toast()).toBe("Unpinned");
    expect(app.$("#favWrap").style.display).toBe("none");
    expect(switcherOpen()).toBe(true);
    expect(pageNames()).toEqual(["Roadmap", "Work overview"]);   // unpinning leaves it where pinning raised it
  });

  it("collapses and re-expands the favorites section", () => {
    pageAct("Roadmap", "pin");
    openSwitcher();
    app.click(app.$("#favHead"));
    expect(app.$("#favWrap").classList.contains("collapsed")).toBe(true);
    app.click(app.$("#favHead"));
    expect(app.$("#favWrap").classList.contains("collapsed")).toBe(false);
  });

  it("creates a top-level notebook, views it and starts naming it", async () => {
    drillTo("Projects");
    openSwitcher();
    app.click(app.$("#swNewTopBtn"));
    expect(switcherOpen()).toBe(false);
    expect(app.$(".crumb.current input").value).toBe("New Notebook");   // named in the breadcrumb
    expect(app.$("#nbSwitchLabel").textContent).toBe("New Notebook");
    expect(app.$$("#nbCrumbs .crumb")).toHaveLength(1);                  // top level: nothing above it

    rename(".crumb.current input", "Archive");
    expect(crumbs()).toEqual(["Archive"]);
    await tick(10);
    const dump = await exportJson(app);
    expect(dump.notebooks.find((n) => n.name === "Archive").parentId).toBeNull();
  });

  it("is reachable and walkable from the keyboard", () => {
    expect(app.$("#nbSwitchBtn").tagName).toBe("BUTTON");
    openSwitcher();
    // focus lands on the notebook in view, and the arrows walk the entries
    expect(app.document.activeElement).toBe(swRow("Work"));
    app.key(app.document.activeElement, "ArrowDown");
    expect(app.document.activeElement).toBe(swRow("Projects"));
    app.key(app.document.activeElement, "ArrowUp");
    app.key(app.document.activeElement, "ArrowUp");
    expect(app.document.activeElement).toBe(app.$("#swNewTopBtn"));   // wraps round
  });

  it("opens a favorite from the keyboard", () => {
    drillTo("Notes");
    pageAct("Meeting notes", "pin");
    goUpTo("Work");
    openSwitcher();
    const fav = app.$(".fav-item");
    expect(fav.getAttribute("tabindex")).toBe("0");
    app.key(fav, "Enter");
    expect(openPageName()).toBe("Meeting notes");
  });

  it("lives inside the sidebar, so resizing the sidebar resizes it", () => {
    expect(app.$("#sidebar").contains(app.$("#nbSwitchPanel"))).toBe(true);
  });
});

describe.skipIf(onBaseline)("focus view: the page filter", () => {
  beforeEach(boot);

  it("narrows the level's pages as you type, ignoring case", () => {
    setFilter("ROAD");
    expect(pageNames()).toEqual(["Roadmap"]);
    setFilter("map");
    expect(pageNames()).toEqual(["Roadmap"]);   // any substring, not only a prefix
    setFilter("");
    expect(pageNames()).toEqual(["Work overview", "Roadmap"]);
  });

  it("says so when nothing matches", () => {
    setFilter("zzz");
    expect(pageNames()).toEqual([]);
    const empty = app.$("#notebookTree .nb-emptypages.no-match");
    expect(empty.textContent).toBe("No pages match");
    // and an empty level without a filter says something else
    setFilter("");
    expect(app.$(".no-match")).toBeNull();
  });

  it("treats a blank filter as no filter", () => {
    setFilter("   ");
    expect(pageNames()).toEqual(["Work overview", "Roadmap"]);
    expect(subNames()).toEqual(["Projects", "Notes"]);
  });

  it("searches the whole notebook subtree, labelling results from sub-notebooks", () => {
    setFilter("alpha");
    expect(pageNames()).toEqual(["Alpha spec", "Alpha design"]);
    expect(app.$$("#notebookTree .board-item .bnb").map((n) => n.textContent)).toEqual(["Alpha", "Alpha"]);

    setFilter("o");
    // pages in the viewed notebook itself carry no label; the rest name theirs
    const labelled = Object.fromEntries(app.$$(".board-item").map((r) => [r.querySelector(".bname").textContent, r.querySelector(".bnb")?.textContent ?? null]));
    expect(labelled["Work overview"]).toBeNull();
    expect(labelled["Roadmap"]).toBeNull();
    expect(labelled["Project plan"]).toBe("Projects");
    expect(labelled["Meeting notes"]).toBe("Notes");
  });

  it("stays inside the notebook in view", () => {
    setFilter("budget");
    expect(pageNames()).toEqual([]);              // Home is not under Work
    setFilter("");
    drillTo("Projects");
    setFilter("overview");
    expect(pageNames()).toEqual([]);              // nor is Work's own page under Projects
    setFilter("spec");
    expect(pageNames()).toEqual(["Alpha spec"]);
  });

  it("lists the results flat, hiding the sub-notebook rows until the filter is cleared", () => {
    setFilter("a");
    expect(subNames()).toEqual([]);
    setFilter("");
    expect(subNames()).toEqual(["Projects", "Notes"]);
  });

  it("clears with its x button, which gives focus back to the box", () => {
    expect(app.$("#pageFilterClear").hidden).toBe(true);
    setFilter("road");
    expect(app.$("#pageFilterClear").hidden).toBe(false);
    app.click(app.$("#pageFilterClear"));
    expect(app.$("#pageFilter").value).toBe("");
    expect(app.$("#pageFilterClear").hidden).toBe(true);
    expect(pageNames()).toEqual(["Work overview", "Roadmap"]);
    expect(app.document.activeElement).toBe(app.$("#pageFilter"));
  });

  it("clears on Escape and leaves the canvas selection alone", async () => {
    app = await createApp();
    app.click(app.$('.add-btn[data-type="note"]'));
    expect(app.$$(".node.selected")).toHaveLength(1);

    setFilter("first");
    expect(app.$$(".board-item")).toHaveLength(1);
    app.key(app.$("#pageFilter"), "Escape");
    expect(app.$("#pageFilter").value).toBe("");
    expect(app.$$(".node.selected")).toHaveLength(1);   // the filter took the Escape

    // an Escape in the empty box carries on to the usual deselect
    app.key(app.$("#pageFilter"), "Escape");
    expect(app.$$(".node.selected")).toHaveLength(0);
  });

  it("is not the global search", () => {
    setFilter("findme");
    expect(app.$("#searchOverlay").classList.contains("open")).toBe(false);
    expect(app.$("#searchInput").value).toBe("");
    expect(pageNames()).toEqual([]);              // it matches page names, not block text
  });

  it("is cleared by moving to another notebook", () => {
    setFilter("a");
    openSwitcher();
    app.click(swRow("Notes"));
    expect(app.$("#pageFilter").value).toBe("");
    expect(pageNames()).toEqual(["Meeting notes"]);

    setFilter("meet");
    goUpTo("Work");
    expect(app.$("#pageFilter").value).toBe("");
  });

  it("keeps the filter and the view when a result is opened", () => {
    setFilter("alpha");
    app.click(pageRow("Alpha spec"));
    expect(openPageName()).toBe("Alpha spec");
    expect(app.$("#pageFilter").value).toBe("alpha");
    expect(crumbs()).toEqual(["Work"]);
    expect(pageNames()).toEqual(["Alpha spec", "Alpha design"]);
    expect(pageRow("Alpha spec").classList.contains("active")).toBe(true);
  });

  it("gives way when the open page changes to one the filter cannot see", () => {
    setFilter("alpha");
    search("budgetnote");
    app.key(app.$("#searchInput"), "Enter");
    expect(openPageName()).toBe("Home budget");
    expect(app.$("#pageFilter").value).toBe("");
    expect(crumbs()).toEqual(["Home"]);
  });

  it("is cleared when a new page is made, so the page is not hidden by it", () => {
    setFilter("road");
    app.click(app.$("#newBoardBtn"));
    expect(app.$("#pageFilter").value).toBe("");
    expect(pageNames()).toContain("Untitled page");
  });

  it("offers no drag handles on a filtered list, whose order is not one list", () => {
    expect(app.$$(".board-item[draggable]")).toHaveLength(2);
    setFilter("a");
    expect(app.$$(".board-item").length).toBeGreaterThan(0);
    expect(app.$$(".board-item[draggable]")).toHaveLength(0);
  });

  it("is reachable from the keyboard", () => {
    expect(app.$("#pageFilter").tagName).toBe("INPUT");
    expect(app.$("#pageFilter").getAttribute("tabindex")).toBeNull();   // in the natural tab order
    expect(app.$("#pageFilter").getAttribute("aria-label")).toBeTruthy();
  });
});

describe.skipIf(onBaseline)("focus view: making pages and notebooks", () => {
  beforeEach(boot);

  it("puts + New page in the notebook in view, not the open page's", async () => {
    drillTo("Projects");
    expect(app.$("#newBoardBtn").title).toContain("Projects");
    app.click(app.$("#newBoardBtn"));
    expect(crumbs()).toEqual(["Work", "Projects"]);
    expect(pageNames()).toEqual(["Project plan", "Untitled page"]);
    await tick(10);
    const dump = await exportJson(app);
    expect(dump.boards.find((b) => b.name === "Untitled page").notebookId).toBe("nb_proj");
  });

  it("puts + Notebook inside the notebook in view and starts naming it", async () => {
    drillTo("Projects");
    expect(app.$("#newNotebookBtn").title).toContain("Projects");
    app.click(app.$("#newNotebookBtn"));
    expect(crumbs()).toEqual(["Work", "Projects"]);          // the view stays put
    expect(subNames()).toEqual(["Alpha", ""]);               // the new row holds the rename box
    expect(app.$(".sub-row .sub-name input")).toBeTruthy();

    rename(".sub-name input", "Beta");
    expect(subNames()).toEqual(["Alpha", "Beta"]);
    await tick(10);
    const dump = await exportJson(app);
    expect(dump.notebooks.find((n) => n.name === "Beta").parentId).toBe("nb_proj");
  });

  it("makes a sub-notebook of a row from the row's menu, and shows it", () => {
    subMenuAct("Notes", "newSub");
    expect(crumbs()).toEqual(["Work", "Notes"]);             // the view moves in to where it was made
    expect(app.$(".sub-row .sub-name input")).toBeTruthy();
    rename(".sub-name input", "Minutes");
    expect(subNames()).toEqual(["Minutes"]);
  });

  it("makes a page in a row's notebook from the row's menu, opens it and follows it there", () => {
    subMenuAct("Notes", "newPage");
    expect(crumbs()).toEqual(["Work", "Notes"]);
    expect(openPageName()).toBe("Untitled page");
    expect(pageNames()).toEqual(["Meeting notes", "Untitled page"]);
  });

  it("makes a page or sub-notebook in the notebook in view from the breadcrumb's menu", () => {
    drillTo("Notes");
    crumbMenuAct("newPage");
    expect(pageNames()).toEqual(["Meeting notes", "Untitled page"]);
    crumbMenuAct("newSub");
    rename(".sub-name input", "Minutes");
    expect(crumbs()).toEqual(["Work", "Notes"]);
    expect(subNames()).toEqual(["Minutes"]);
  });

  it("clears a filter when a notebook is made", () => {
    setFilter("road");
    app.click(app.$("#newNotebookBtn"));
    expect(app.$("#pageFilter").value).toBe("");
    expect(subNames()).toEqual(["Projects", "Notes", ""]);
  });

  it("renames a sub-notebook by double-click, and the notebook in view the same way", () => {
    subRow("Notes").dispatchEvent(new app.window.MouseEvent("dblclick", { bubbles: true }));
    rename(".sub-name input", "Minutes");
    expect(subNames()).toEqual(["Projects", "Minutes"]);

    app.$(".crumb.current").dispatchEvent(new app.window.MouseEvent("dblclick", { bubbles: true }));
    rename(".crumb.current input", "Office");
    expect(crumbs()).toEqual(["Office"]);
    expect(app.$("#nbSwitchLabel").textContent).toBe("Office");
  });

  it("puts a notebook's name back when its rename is abandoned with Escape", () => {
    subRow("Notes").dispatchEvent(new app.window.MouseEvent("dblclick", { bubbles: true }));
    const input = app.$(".sub-name input");
    input.value = "Scribbles";
    app.key(input, "Escape");
    expect(subNames()).toEqual(["Projects", "Notes"]);
  });

  it("renames a page from its menu and by double-click", () => {
    pageAct("Roadmap", "rename");
    const input = app.$(".board-item input");
    input.value = "Plan";
    blurInput(input);
    expect(pageNames()).toEqual(["Work overview", "Plan"]);

    pageRow("Work overview").dispatchEvent(new app.window.MouseEvent("dblclick", { bubbles: true }));
    rename(".board-item input", "Overview");
    expect(pageNames()).toEqual(["Overview", "Plan"]);
  });
});

describe.skipIf(onBaseline)("focus view: deleting notebooks", () => {
  beforeEach(boot);

  it("moves the view to the parent when the notebook in view is deleted", async () => {
    drillTo("Projects");
    drillTo("Alpha");
    crumbMenuAct("del");
    expect(app.$("#confirmOverlay").classList.contains("open")).toBe(true);
    await confirmDelete();

    expect(crumbs()).toEqual(["Work", "Projects"]);
    expect(subNames()).toEqual([]);
    expect(pageNames()).toEqual(["Project plan", "Alpha spec", "Alpha design"]);   // its pages moved up
  });

  it("moves the view to another top-level notebook when a top-level one is deleted", async () => {
    openSwitcher();
    app.click(swRow("Home"));
    crumbMenuAct("del");
    await confirmDelete();
    expect(crumbs()).toEqual(["Work"]);
    expect(pageNames()).toEqual(["Work overview", "Home budget", "Roadmap"]);   // renumbered by their old order values
  });

  it("promotes a deleted row's sub-notebooks and pages into the level in view", async () => {
    subMenuAct("Projects", "del");
    await confirmDelete();
    expect(crumbs()).toEqual(["Work"]);
    expect(subNames()).toEqual(["Alpha", "Notes"]);
    expect(pageNames()).toEqual(["Work overview", "Project plan", "Roadmap"]);
  });

  it("changes nothing when the delete is cancelled", async () => {
    drillTo("Notes");
    crumbMenuAct("del");
    app.click(app.$("#confirmCancelBtn"));
    await tick(10);
    expect(crumbs()).toEqual(["Work", "Notes"]);
    expect(pageNames()).toEqual(["Meeting notes"]);
  });

  it("drops a deleted page's row", async () => {
    pageAct("Roadmap", "del");
    await confirmDelete();
    expect(pageNames()).toEqual(["Work overview"]);
  });
});

describe.skipIf(onBaseline)("focus view: pinning", () => {
  beforeEach(boot);

  it("floats a pinned page to the top of its level, and back on unpin", () => {
    pageAct("Roadmap", "pin");
    expect(pageNames()).toEqual(["Roadmap", "Work overview"]);
    expect(pageRow("Roadmap").querySelector(".pin-ico")).toBeTruthy();
    expect(toast()).toBe("Pinned to top");

    pageAct("Roadmap", "pin");
    expect(toast()).toBe("Unpinned");
    expect(pageNames()).toEqual(["Roadmap", "Work overview"]);   // unpinning leaves it where it had risen to
    expect(app.$(".pin-ico")).toBeNull();
  });

  it("offers Unpin from the menu of a pinned page", () => {
    pageAct("Roadmap", "pin");
    const label = pageMenu("Roadmap").querySelector('[data-act="pin"]').textContent;
    expect(label).toBe("Unpin from top");
  });

  it("only reorders the level the page is in", () => {
    drillTo("Projects");
    drillTo("Alpha");
    pageAct("Alpha design", "pin");
    expect(pageNames()).toEqual(["Alpha design", "Alpha spec"]);
    goUpTo("Work");
    expect(pageNames()).toEqual(["Work overview", "Roadmap"]);
  });
});

describe.skipIf(onBaseline)("focus view: selecting several pages", () => {
  beforeEach(boot);

  it("selects with ctrl-click and deletes the pages in view together", async () => {
    drillTo("Projects");
    drillTo("Alpha");
    ctrlClick(pageRow("Alpha spec"));
    ctrlClick(pageRow("Alpha design"));
    expect(app.$$(".board-item.multi-selected")).toHaveLength(2);
    expect(app.$("#multiSelectBar").style.display).not.toBe("none");
    expect(app.$("#multiSelectCount").textContent).toBe("2 pages selected");

    app.click(app.$("#multiSelectDeleteBtn"));
    expect(app.$("#confirmTitle").textContent).toBe("Delete 2 pages?");
    await confirmDelete();
    expect(pageNames()).toEqual([]);
    expect(app.$(".nb-emptypages").textContent).toBe("No pages yet");
    expect(app.$("#multiSelectBar").style.display).toBe("none");
    expect(openPageName()).toBe("Work overview");
    expect(crumbs()).toEqual(["Work", "Projects", "Alpha"]);   // the view stays on the emptied notebook
  });

  it("selects a range with shift-click", () => {
    app.click(app.$("#newBoardBtn"));
    app.click(app.$("#newBoardBtn"));
    const items = app.$$(".board-item");
    expect(items).toHaveLength(4);
    app.click(items[0]);
    items[2].dispatchEvent(new app.window.MouseEvent("click", { bubbles: true, shiftKey: true }));
    expect(app.$$(".board-item.multi-selected")).toHaveLength(3);
  });

  it("lets go of the selection when the view moves to another notebook", () => {
    ctrlClick(pageRow("Roadmap"));
    ctrlClick(pageRow("Work overview"));
    expect(app.$("#multiSelectBar").style.display).not.toBe("none");

    drillTo("Notes");
    expect(app.$("#multiSelectBar").style.display).toBe("none");
    goUpTo("Work");
    expect(app.$$(".board-item.multi-selected")).toHaveLength(0);
    expect(app.$("#multiSelectBar").style.display).toBe("none");
  });

  it("lets go of pages that a filter hides, so the bar never acts on unseen pages", () => {
    ctrlClick(pageRow("Roadmap"));
    ctrlClick(pageRow("Work overview"));
    expect(app.$("#multiSelectCount").textContent).toBe("2 pages selected");
    setFilter("road");
    expect(app.$("#multiSelectBar").style.display).toBe("none");
    setFilter("");
    // only the page that stayed in sight is still selected
    expect(app.$$(".board-item.multi-selected .bname").map((n) => n.textContent)).toEqual(["Roadmap"]);
  });

  it("cancels from the bar", () => {
    ctrlClick(pageRow("Roadmap"));
    ctrlClick(pageRow("Work overview"));
    app.click(app.$("#multiSelectClearBtn"));
    expect(app.$$(".board-item.multi-selected")).toHaveLength(0);
    expect(app.$("#multiSelectBar").style.display).toBe("none");
  });
});

describe.skipIf(onBaseline)("focus view: drag and drop", () => {
  beforeEach(boot);

  it("reorders pages within the list in view", async () => {
    drillTo("Projects");
    drillTo("Alpha");
    expect(pageNames()).toEqual(["Alpha spec", "Alpha design"]);
    drag(pageRow("Alpha design"), pageRow("Alpha spec"));            // above it
    expect(pageNames()).toEqual(["Alpha design", "Alpha spec"]);
    drag(pageRow("Alpha design"), pageRow("Alpha spec"), { below: true });   // below it
    expect(pageNames()).toEqual(["Alpha spec", "Alpha design"]);

    await tick(10);
    const dump = await exportJson(app);
    expect(boardOf(dump, "p_spec").order).toBe(0);
    expect(boardOf(dump, "p_desg").order).toBe(1);
  });

  it("moves a page into a sub-notebook when it is dropped on that row", async () => {
    drag(pageRow("Roadmap"), subRow("Notes"));
    expect(pageNames()).toEqual(["Work overview"]);
    expect(subRow("Notes").querySelector(".sub-count").textContent).toBe("2");
    expect(crumbs()).toEqual(["Work"]);                              // dropping does not navigate

    drillTo("Notes");
    expect(pageNames()).toEqual(["Meeting notes", "Roadmap"]);
    await tick(10);
    expect(boardOf(await exportJson(app), "p_road").notebookId).toBe("nb_notes");
  });

  it("lights up the row a page is held over, and clears it after", () => {
    const dt = fakeDataTransfer();
    fireDrag(pageRow("Roadmap"), "dragstart", dt);
    fireDrag(subRow("Notes"), "dragover", dt);
    expect(subRow("Notes").classList.contains("drop-into")).toBe(true);
    fireDrag(pageRow("Roadmap"), "dragend", dt);
    expect(app.$$(".drop-into")).toHaveLength(0);
  });

  it("reorders sub-notebook rows among their siblings", async () => {
    expect(subNames()).toEqual(["Projects", "Notes"]);
    drag(subRow("Projects"), subRow("Notes"), { below: true });
    expect(subNames()).toEqual(["Notes", "Projects"]);
    await tick(10);
    const dump = await exportJson(app);
    expect(notebookOf(dump, "nb_notes").order).toBe(0);
    expect(notebookOf(dump, "nb_proj").order).toBe(1);
  });

  it("nests a notebook when its row is dropped on the middle of another", async () => {
    drag(subRow("Notes"), subRow("Projects"));
    expect(subNames()).toEqual(["Projects"]);
    drillTo("Projects");
    expect(subNames()).toEqual(["Alpha", "Notes"]);
    await tick(10);
    expect(notebookOf(await exportJson(app), "nb_notes").parentId).toBe("nb_proj");
  });

  it("refuses to drop a notebook on itself", async () => {
    drag(subRow("Notes"), subRow("Notes"));
    expect(subNames()).toEqual(["Projects", "Notes"]);
  });

  it("lifts a page out to an ancestor when it is dropped on that crumb", async () => {
    drillTo("Projects");
    drillTo("Alpha");
    drag(pageRow("Alpha spec"), crumb("Projects"));
    expect(pageNames()).toEqual(["Alpha design"]);
    goUpTo("Projects");
    expect(pageNames()).toEqual(["Project plan", "Alpha spec"]);
    await tick(10);
    expect(boardOf(await exportJson(app), "p_spec").notebookId).toBe("nb_proj");
  });

  it("lifts a sub-notebook out to an ancestor when its row is dropped on that crumb", async () => {
    drillTo("Projects");
    drag(subRow("Alpha"), crumb("Work"));
    expect(subNames()).toEqual([]);
    goUpTo("Work");
    expect(subNames()).toEqual(["Projects", "Notes", "Alpha"]);   // added after its new siblings
    await tick(10);
    expect(notebookOf(await exportJson(app), "nb_alpha").parentId).toBe("nb_work");
  });

  it("moves a multi-selection when it is dropped on a crumb", () => {
    drillTo("Projects");
    drillTo("Alpha");
    ctrlClick(pageRow("Alpha spec"));
    ctrlClick(pageRow("Alpha design"));
    drag(pageRow("Alpha spec"), crumb("Work"));
    expect(pageNames()).toEqual([]);
    goUpTo("Work");
    expect(pageNames()).toEqual(["Work overview", "Roadmap", "Alpha spec", "Alpha design"]);
    expect(app.$("#multiSelectBar").style.display).toBe("none");
  });

  it("lights up the crumb a page is held over", () => {
    drillTo("Projects");
    const dt = fakeDataTransfer();
    fireDrag(pageRow("Project plan"), "dragstart", dt);
    fireDrag(crumb("Work"), "dragover", dt);
    expect(crumb("Work").classList.contains("drop-into")).toBe(true);
    fireDrag(crumb("Work"), "dragleave", dt);
    expect(crumb("Work").classList.contains("drop-into")).toBe(false);
  });
});

describe.skipIf(onBaseline)("focus view: Move to...", () => {
  beforeEach(boot);

  const picker = () => app.$("#moveToPicker");
  const pickerRows = () => app.$$("#moveToPicker .sw-nb");
  const pickerRow = (name) => pickerRows().find((b) => b.textContent.startsWith(name));
  const pickerNames = () => pickerRows().map((b) => b.querySelector(".nb-name")?.textContent ?? b.textContent);

  it("moves a page to a notebook that is nowhere on screen", async () => {
    pageAct("Roadmap", "move");
    expect(picker().querySelector(".mp-title").textContent).toBe("Move page to…");
    // the whole tree, with the page's own notebook greyed out
    expect(pickerNames()).toEqual(["Work", "Projects", "Alpha", "Notes", "Home"]);
    expect(pickerRow("Work").disabled).toBe(true);
    expect(pickerRow("Work").classList.contains("active")).toBe(true);
    expect(pickerRow("Home").disabled).toBe(false);

    app.click(pickerRow("Home"));
    expect(picker()).toBeNull();
    expect(pageNames()).toEqual(["Work overview"]);
    expect(toast()).toBe("Moved page to “Home”");
    expect(crumbs()).toEqual(["Work"]);                        // the view stays
    expect(openPageName()).toBe("Work overview");
    await tick(10);
    expect(boardOf(await exportJson(app), "p_road").notebookId).toBe("nb_home");
  });

  it("moves the open page without following it", () => {
    pageAct("Work overview", "move");
    app.click(pickerRow("Alpha"));
    expect(openPageName()).toBe("Work overview");
    expect(crumbs()).toEqual(["Work"]);
    expect(pageNames()).toEqual(["Roadmap"]);
  });

  it("moves a whole selection when the page is part of one", () => {
    ctrlClick(pageRow("Roadmap"));
    ctrlClick(pageRow("Work overview"));
    pageAct("Roadmap", "move");
    expect(picker().querySelector(".mp-title").textContent).toBe("Move 2 pages to…");
    expect(pickerRow("Work").disabled).toBe(false);   // each may be anywhere, so nothing is greyed
    app.click(pickerRow("Notes"));
    expect(pageNames()).toEqual([]);
    expect(toast()).toBe("Moved 2 pages to “Notes”");
    expect(app.$("#multiSelectBar").style.display).toBe("none");
    drillTo("Notes");
    expect(pageNames()).toEqual(["Meeting notes", "Work overview", "Roadmap"]);
  });

  it("closes on Escape and on a click outside, and moves nothing", async () => {
    pageAct("Roadmap", "move");
    app.key(null, "Escape");
    expect(picker()).toBeNull();

    pageAct("Roadmap", "move");
    await tick(5);
    app.pointer(picker(), "pointerdown", { button: 0 });
    expect(picker()).toBeTruthy();
    outsideClick();
    expect(picker()).toBeNull();
    expect(pageNames()).toEqual(["Work overview", "Roadmap"]);
  });

  it("starts on the first choice and is walkable from the keyboard", () => {
    pageAct("Roadmap", "move");
    expect(app.document.activeElement).toBe(pickerRow("Projects"));    // Work itself is greyed out
    app.key(app.document.activeElement, "ArrowDown");
    expect(app.document.activeElement).toBe(pickerRow("Alpha"));
    app.key(app.document.activeElement, "ArrowUp");
    app.key(app.document.activeElement, "ArrowUp");
    expect(app.document.activeElement).toBe(pickerRow("Home"));       // wraps
  });

  it("moves a notebook under another, and shows the new path", async () => {
    drillTo("Projects");
    crumbMenuAct("move");
    expect(picker().querySelector(".mp-title").textContent).toBe("Move notebook to…");
    app.click(pickerRow("Home"));
    expect(crumbs()).toEqual(["Home", "Projects"]);
    expect(app.$("#nbSwitchLabel").textContent).toBe("Home");
    expect(toast()).toBe("Moved “Projects” to “Home”");
    await tick(10);
    expect(notebookOf(await exportJson(app), "nb_proj").parentId).toBe("nb_home");
  });

  it("moves a notebook to the top level", async () => {
    drillTo("Projects");
    crumbMenuAct("move");
    app.click(pickerRow("Top level"));
    expect(crumbs()).toEqual(["Projects"]);
    expect(toast()).toBe("Moved “Projects” to the top level");
    await tick(10);
    expect(notebookOf(await exportJson(app), "nb_proj").parentId).toBeNull();
  });

  it("works from a sub-notebook's own row too", () => {
    subMenuAct("Notes", "move");
    app.click(pickerRow("Alpha"));
    expect(subNames()).toEqual(["Projects"]);
    drillTo("Projects");
    drillTo("Alpha");
    expect(crumbs()).toEqual(["Work", "Projects", "Alpha"]);
    expect(subNames()).toEqual(["Notes"]);
  });

  it("greys out the notebook itself, everything inside it, and where it already is", () => {
    subMenuAct("Projects", "move");
    expect(pickerRow("Top level").disabled).toBe(false);
    expect(pickerRow("Work").disabled).toBe(true);        // its current parent
    expect(pickerRow("Projects").disabled).toBe(true);    // itself
    expect(pickerRow("Alpha").disabled).toBe(true);       // inside it
    expect(pickerRow("Notes").disabled).toBe(false);
    expect(pickerRow("Home").disabled).toBe(false);
    expect(pickerRows().filter((b) => b.disabled).map((b) => b.querySelector(".nb-name").textContent)).toEqual(["Work", "Projects", "Alpha"]);
  });

  it("greys out the top level for a notebook that is already there", () => {
    openSwitcher();
    app.click(swRow("Home"));
    crumbMenuAct("move");
    expect(pickerRow("Top level").disabled).toBe(true);
    expect(pickerRow("Top level").classList.contains("active")).toBe(true);
    expect(pickerRow("Home").disabled).toBe(true);
    expect(pickerRow("Work").disabled).toBe(false);
  });
});

describe.skipIf(onBaseline)("focus view: menus and the keyboard", () => {
  beforeEach(boot);

  it("keeps every page action in the page menu", () => {
    const labels = [...pageMenu("Roadmap").querySelectorAll(".pm-item")].map((b) => b.textContent);
    expect(labels).toEqual(["Open", "Pin to top", "Rename", "Duplicate page", "Move to…", "Delete page"]);
    app.click(app.$('#pageMenu [data-act="open"]'));
    expect(openPageName()).toBe("Roadmap");
  });

  it("opens a sub-notebook's menu from right-click, its button, and the Menu key", () => {
    subRow("Notes").dispatchEvent(new app.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(app.$("#notebookMenu")).toBeTruthy();
    app.key(null, "Escape");
    expect(app.$("#notebookMenu")).toBeNull();                       // Escape closes it, too

    app.click(subRow("Notes").querySelector(".sub-menu-btn"));
    expect(app.$("#notebookMenu")).toBeTruthy();
    const labels = [...app.$$("#notebookMenu .pm-item")].map((b) => b.textContent);
    expect(labels).toEqual(["New page here", "New sub-notebook here", "Rename", "Move to…", "Delete notebook"]);
    app.key(null, "Escape");

    app.key(subRow("Notes"), "ContextMenu");
    expect(app.$("#notebookMenu")).toBeTruthy();
  });

  it("opens the page menu from the Menu key and Shift+F10", () => {
    app.key(pageRow("Roadmap"), "ContextMenu");
    expect(app.$("#pageMenu")).toBeTruthy();
    app.key(null, "Escape");
    app.key(pageRow("Roadmap"), "F10", { shiftKey: true });
    expect(app.$("#pageMenu")).toBeTruthy();
  });

  it("lands focus in an opened menu and walks it with the arrows", () => {
    pageMenu("Roadmap");
    const items = app.$$("#pageMenu .pm-item");
    expect(app.document.activeElement).toBe(items[0]);
    app.key(items[0], "ArrowDown");
    expect(app.document.activeElement).toBe(items[1]);
    app.key(items[1], "ArrowUp");
    app.key(items[0], "ArrowUp");
    expect(app.document.activeElement).toBe(items[items.length - 1]);
  });

  it("drills in with Enter or Space on a sub-notebook row", () => {
    app.key(subRow("Notes"), "Enter");
    expect(crumbs()).toEqual(["Work", "Notes"]);
    goUpTo("Work");
    app.key(subRow("Projects"), " ");
    expect(crumbs()).toEqual(["Work", "Projects"]);
  });

  it("opens a page with Enter on its row, and keeps focus on the row", () => {
    const row = pageRow("Roadmap");
    expect(row.getAttribute("tabindex")).toBe("0");
    row.focus();
    app.key(row, "Enter");
    expect(openPageName()).toBe("Roadmap");
    expect(app.document.activeElement.dataset.id).toBe(row.dataset.id);
    expect(app.document.activeElement.isConnected).toBe(true);
  });

  it("moves focus to the new level's first row after drilling in from the keyboard", () => {
    const row = subRow("Projects");
    row.focus();
    app.key(row, "Enter");
    expect(app.document.activeElement).toBe(subRow("Alpha"));
  });

  it("walks the rows with the arrow keys", () => {
    const rows = [...app.$$("#notebookTree .sub-row, #notebookTree .board-item")];
    expect(rows).toHaveLength(4);
    rows[0].focus();
    app.key(rows[0], "ArrowDown");
    expect(app.document.activeElement).toBe(rows[1]);
    app.key(rows[1], "ArrowDown");
    expect(app.document.activeElement).toBe(rows[2]);
    app.key(rows[2], "ArrowUp");
    expect(app.document.activeElement).toBe(rows[1]);
  });

  it("keeps focus in the breadcrumb after drilling up through it", () => {
    drillTo("Projects");
    const up = crumb("Work");
    up.focus();
    app.click(up);
    expect(app.document.activeElement).toBe(app.$("#nbCrumbs .crumb.current"));
  });

  it("makes every part of the sidebar's list a tab stop", () => {
    expect(app.$$("#nbCrumbs button").length).toBeGreaterThan(0);
    expect(app.$$(".sub-row").every((r) => r.getAttribute("tabindex") === "0")).toBe(true);
    expect(app.$$(".board-item").every((r) => r.getAttribute("tabindex") === "0")).toBe(true);
    expect(app.$("#nbSwitchBtn").tagName).toBe("BUTTON");
  });

  it("does not let typing in the filter or arrowing a row trigger the canvas shortcuts", () => {
    const before = app.nodes().length;
    app.$("#pageFilter").focus();
    app.key(app.$("#pageFilter"), "n");
    pageRow("Roadmap").focus();
    app.key(pageRow("Roadmap"), "ArrowDown");
    expect(app.nodes().length).toBe(before);
  });
});

describe.skipIf(onBaseline)("focus view: the stored data is never touched by looking around", () => {
  beforeEach(boot);

  function wander() {
    openSwitcher();
    app.click(swRow("Alpha"));
    goUpTo("Projects");
    goUpTo("Work");
    drillTo("Notes");
    goUpTo("Work");
    setFilter("alpha");
    setFilter("");
    openSwitcher();
    app.click(swRow("Home"));
    openSwitcher();
    outsideClick();
    app.key(null, "Escape");
    openSwitcher();
    app.click(swRow("Work"));
    ctrlClick(pageRow("Work overview"));
    ctrlClick(pageRow("Roadmap"));
    app.click(app.$("#multiSelectClearBtn"));
  }

  it("exports identically before and after navigating", async () => {
    const before = stripStamp(await exportJson(app));
    wander();
    const after = stripStamp(await exportJson(app));
    expect(after).toEqual(before);
  });

  it("queues no save for navigation, but does for a real edit", async () => {
    await tick(700);                                 // let anything from boot settle
    const writes = [];
    const realSet = app.window.storage.set;
    app.window.storage.set = (k, v, ...rest) => { writes.push(k); return realSet(k, v, ...rest); };

    wander();
    await tick(700);                                 // longer than the save debounce
    expect(writes).toEqual([]);

    app.type(app.$("#boardTitle"), "Renamed");
    await tick(700);
    expect(writes.length).toBeGreaterThan(0);        // so the probe does see saves
  });

  it("leaves each notebook's collapsed flag exactly as it was found", async () => {
    const flags = async () => Object.fromEntries((await exportJson(app)).notebooks.map((n) => [n.id, n.collapsed]));
    const before = await flags();
    expect(before).toEqual({ nb_work: true, nb_proj: true, nb_alpha: false, nb_notes: false, nb_home: false });

    // including the actions that used to expand a notebook as a side effect
    drag(pageRow("Roadmap"), subRow("Projects"));
    app.click(app.$("#newBoardBtn"));
    drillTo("Projects");
    app.click(app.$("#newNotebookBtn"));
    rename(".sub-name input", "Beta");
    goUpTo("Work");
    drag(subRow("Notes"), subRow("Projects"));
    const after = await flags();
    const beta = (await exportJson(app)).notebooks.find((n) => n.name === "Beta").id;
    expect(after).toEqual({ ...before, [beta]: false });
  });
});
