// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

/* The two places staged loading touches the rest of the app: a page whose
   blocks haven't arrived must never be saved, and the footer shows how far the
   background load has got. */

let state, persistBoard, updateStorageBar, setPending;
let setCalls;

beforeAll(async () => {
  document.body.innerHTML =
    '<div id="footerBar"><span id="footerLabel"></span>' +
    '<span id="footerLoad" hidden><span class="fl-bar"><span class="fl-fill"></span></span><span class="fl-text"></span></span>' +
    '<span id="footerSaved"></span></div>' +
    '<div id="toast"></div>' +
    '<div id="storageBar"><span class="sb-label"></span><span class="sb-sub"></span></div>';
  ({ state } = await import("../src/state.js"));
  ({ persistBoard, updateStorageBar } = await import("../src/storage.js"));
  ({ setPending } = await import("../src/pageLoader.js"));
});

beforeEach(() => {
  setCalls = [];
  window.storage = { set: vi.fn(async (k) => { setCalls.push(k); }), get: vi.fn(), delete: vi.fn() };
  state.backend = "app";
  state.boards = [{ id: "ready" }, { id: "late" }];
  state.boardsData = { ready: { nodes: [{ id: "x" }], connections: [] } };
  state.corruptBoards = new Set();
  setPending(["late"], async () => ({}));
});

describe("never saving a page that hasn't loaded", () => {
  it("skips a pending page entirely", async () => {
    await persistBoard("late");
    expect(setCalls).toEqual([]);
  });

  it("still saves a loaded page", async () => {
    await persistBoard("ready");
    expect(setCalls).toEqual(["mindmap:board:ready"]);
  });

  it("saves the page once it has loaded", async () => {
    state.boardsData.late = { nodes: [], connections: [] };
    state.pendingBoards.delete("late");
    await persistBoard("late");
    expect(setCalls).toEqual(["mindmap:board:late"]);
  });
});

describe("the footer's background-load progress", () => {
  const load = () => document.getElementById("footerLoad");

  it("is hidden when nothing is loading", () => {
    state.bgLoad = { active: false, total: 0, done: 0 };
    state.pendingBoards = new Set();
    updateStorageBar();
    expect(load().hidden).toBe(true);
  });

  it("shows how many pages have arrived", () => {
    state.pendingBoards = new Set(["a", "b"]);
    state.bgLoad = { active: true, total: 4, done: 2 };
    updateStorageBar();
    expect(load().hidden).toBe(false);
    expect(load().querySelector(".fl-text").textContent).toBe("Loading pages 2 / 4");
    expect(load().querySelector(".fl-fill").style.width).toBe("50%");
  });

  it("disappears again when the last page lands", () => {
    state.pendingBoards = new Set();
    state.bgLoad = { active: false, total: 4, done: 4 };
    updateStorageBar();
    expect(load().hidden).toBe(true);
  });
});
