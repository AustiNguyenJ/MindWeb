// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* The sidebar next to staged loading (pageLoader.js): a page whose blocks have
   not arrived yet is "pending" and can't be opened. Choosing it must still
   show its notebook, and open it the moment it arrives -- and only if nothing
   else has been asked for in the meantime. This drives the real sidebar
   modules against index.html's markup with a fake loader, because the only
   real source of pending pages is the cloud backend, which the suite never
   reaches. */

let state, sidebar, switcher, loader;

beforeAll(async () => {
  // keep the cloud client out of it, as in the rest of the suite
  vi.stubEnv("VITE_SUPABASE_URL", "");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
  // modules read their elements when first imported, so the markup goes in first
  const html = readFileSync(resolve(__dirname, "../index.html"), "utf8");
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  state = (await import("../src/state.js")).state;
  loader = await import("../src/pageLoader.js");
  sidebar = await import("../src/sidebar.js");
  switcher = await import("../src/notebookSwitcher.js");
  const { seedBuiltinTypes } = await import("../src/blockTypes.js");
  seedBuiltinTypes();
  sidebar.initSidebar();
});

const empty = () => ({ nodes: [], connections: [] });
const crumbs = () => [...document.querySelectorAll("#nbCrumbs .crumb")].map((c) => c.textContent);
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  state.notebooks = [
    { id: "nbA", name: "Alpha", collapsed: false, parentId: null, order: 0 },
    { id: "nbB", name: "Beta", collapsed: false, parentId: "nbA", order: 0 },
  ];
  state.boards = [
    { id: "p1", name: "Ready page", description: "", notebookId: "nbA", order: 0, pinned: false },
    { id: "p2", name: "Slow page", description: "", notebookId: "nbB", order: 0, pinned: true },
    { id: "p3", name: "Other page", description: "", notebookId: "nbA", order: 1, pinned: false },
  ];
  state.boardsData = { p1: empty(), p3: empty() };
  state.currentBoardId = "p1";
  state.failedBoards = new Set();
  document.getElementById("nbSwitchPanel").hidden = true;
  // the module remembers the page it last followed; a fresh render re-syncs from p1
  sidebar.renderBoardList();
});

function pend(delay = 0, fail = false) {
  loader.setPending(["p2"], async (ids) => {
    if (delay) await tick(delay);
    const out = {};
    ids.forEach((id) => { if (!fail) out[id] = empty(); });
    return out;
  });
}

describe("choosing a page that has not loaded yet", () => {
  it("shows its notebook straight away and opens it on arrival", async () => {
    pend(5);
    expect(crumbs()).toEqual(["Alpha"]);

    document.getElementById("nbSwitchBtn").click();
    document.querySelector("#favList .fav-item").click();
    expect(crumbs()).toEqual(["Alpha", "Beta"]);            // the notebook is visible now
    expect(state.currentBoardId).toBe("p1");                  // the page is not open yet
    expect(document.getElementById("toast").textContent).toContain("Loading");

    await tick(30);
    expect(state.currentBoardId).toBe("p2");
    expect(crumbs()).toEqual(["Alpha", "Beta"]);
    expect(document.querySelector(".board-item.active .bname").textContent).toBe("Slow page");
  });

  it("does not open it if something else was chosen while it loaded", async () => {
    pend(20);
    sidebar.viewNotebook("nbB");
    document.querySelector(".board-item").click();          // the pending page, from the list
    expect(state.currentBoardId).toBe("p1");

    sidebar.viewNotebook("nbA");
    document.querySelectorAll(".board-item")[1].click();    // a ready page, chosen meanwhile
    expect(state.currentBoardId).toBe("p3");

    await tick(50);
    expect(state.currentBoardId).toBe("p3");                  // the late arrival did not take over
    expect(crumbs()).toEqual(["Alpha"]);
  });

  it("stays on the open page, with a message, if the page never arrives", async () => {
    pend(0, true);
    sidebar.viewNotebook("nbB");
    document.querySelector(".board-item").click();
    await tick(30);
    expect(state.currentBoardId).toBe("p1");
    expect(document.getElementById("toast").textContent).toContain("Couldn't load");
    expect(crumbs()).toEqual(["Alpha", "Beta"]);
  });

  it("lists pending pages like any other, and the switcher counts them", () => {
    pend(0);
    sidebar.renderBoardList();
    sidebar.viewNotebook("nbB");
    expect([...document.querySelectorAll(".board-item .bname")].map((n) => n.textContent)).toEqual(["Slow page"]);
    expect(switcher.isSwitcherOpen()).toBe(false);
    expect([...document.querySelectorAll("#swTree .sw-count")].map((c) => c.textContent)).toEqual(["2", "1"]);
  });
});
