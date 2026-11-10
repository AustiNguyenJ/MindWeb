// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { state } from "../src/state.js";
import {
  setPending, loadBoards, ensureBoardLoaded, startBackgroundLoad, whenAllLoaded,
  isBoardReady, pendingCount, backgroundOrder, onLoadProgress,
} from "../src/pageLoader.js";

/* The staged-loading engine, driven with a fake backend. The cloud query layer
   itself can't run here (no network), so this pins the behaviour around it:
   ordering, de-duplication, failure handling and the "never save a page that
   hasn't loaded" rule. */

const page = (tag) => ({ nodes: [{ id: "n-" + tag }], connections: [] });

function fakeBackend({ failIds = new Set(), delay = 0 } = {}) {
  const calls = [];
  const loader = vi.fn(async (ids) => {
    calls.push([...ids]);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const out = {};
    ids.forEach((id) => { if (!failIds.has(id)) out[id] = page(id); });
    return out;
  });
  return { loader, calls, failIds };
}

function setup(ids, backend) {
  state.boards = ids.map((id, i) => ({ id, name: id, notebookId: i < 2 ? "nbA" : "nbB" }));
  state.boardsData = {};
  state.failedBoards = new Set();
  setPending(ids, backend.loader);
}

beforeEach(() => { state.boards = []; state.boardsData = {}; });

describe("loading pages in stages", () => {
  it("marks every page pending until its blocks arrive", async () => {
    const be = fakeBackend();
    setup(["a", "b", "c"], be);
    expect(pendingCount()).toBe(3);
    expect(isBoardReady("a")).toBe(false);

    await loadBoards(["a"]);
    expect(isBoardReady("a")).toBe(true);
    expect(isBoardReady("b")).toBe(false);
    expect(state.boardsData.a.nodes[0].id).toBe("n-a");
    expect(state.boardsData.b).toBeUndefined();   // never an empty stand-in
  });

  it("fetches a page once even when asked twice at the same time", async () => {
    const be = fakeBackend({ delay: 5 });
    setup(["a", "b"], be);
    await Promise.all([loadBoards(["a"]), loadBoards(["a"]), ensureBoardLoaded("a")]);
    expect(be.calls).toEqual([["a"]]);
  });

  it("leaves a page that failed pending, and retries it next time", async () => {
    const be = fakeBackend({ failIds: new Set(["b"]) });
    setup(["a", "b"], be);
    await loadBoards(["a", "b"]);
    expect(isBoardReady("a")).toBe(true);
    expect(isBoardReady("b")).toBe(false);
    expect(state.failedBoards.has("b")).toBe(true);
    expect(state.boardsData.b).toBeUndefined();   // not an empty page that could be saved

    be.failIds.clear();
    expect(await ensureBoardLoaded("b")).toBe(true);
    expect(state.failedBoards.has("b")).toBe(false);
  });

  it("treats a loader that throws as a failure, not a crash", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    setup(["a"], { loader: async () => { throw new Error("network"); } });
    await loadBoards(["a"]);
    expect(isBoardReady("a")).toBe(false);
    err.mockRestore();
  });

  it("does not bring back a page deleted while its fetch was in flight", async () => {
    const be = fakeBackend({ delay: 5 });
    setup(["a", "b"], be);
    const p = loadBoards(["b"]);
    state.boards = state.boards.filter((b) => b.id !== "b");
    state.pendingBoards.delete("b");
    await p;
    expect(state.boardsData.b).toBeUndefined();
  });
});

describe("the background pass", () => {
  it("fills in the rest in small batches and reports progress", async () => {
    const be = fakeBackend();
    const ids = ["a", "b", "c", "d", "e", "f", "g"];
    setup(ids, be);
    await loadBoards(["a"]);                       // the page shown first
    const seen = [];
    onLoadProgress(() => seen.push(state.bgLoad.done));
    const done = vi.fn();
    await startBackgroundLoad(ids.slice(1), done);

    expect(pendingCount()).toBe(0);
    expect(be.calls.slice(1).every((c) => c.length <= 5)).toBe(true);
    expect(state.bgLoad.done).toBe(7);
    expect(state.bgLoad.active).toBe(false);
    expect(seen[seen.length - 1]).toBe(7);
    expect(done).toHaveBeenCalledOnce();
  });

  it("lets a page jump the queue while the background pass is running", async () => {
    const be = fakeBackend({ delay: 5 });
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    setup(ids, be);
    const bg = startBackgroundLoad(ids);
    expect(await ensureBoardLoaded("h")).toBe(true);   // asked for out of order
    expect(isBoardReady("h")).toBe(true);
    await bg;
    expect(pendingCount()).toBe(0);
    // h was fetched once, not again by the background pass
    expect(be.calls.flat().filter((id) => id === "h")).toHaveLength(1);
  });

  it("skips pages that are already loaded", async () => {
    const be = fakeBackend();
    setup(["a", "b", "c"], be);
    await loadBoards(["b"]);
    await startBackgroundLoad(["a", "b", "c"]);
    expect(be.calls.flat().filter((id) => id === "b")).toHaveLength(1);
  });

  it("opens with the current notebook's pages first", () => {
    const be = fakeBackend();
    setup(["a", "b", "c", "d"], be);   // a,b in nbA; c,d in nbB
    state.pendingBoards.delete("c");              // c is the page that is open
    expect(backgroundOrder("c")).toEqual(["d", "a", "b"]);
  });
});

describe("waiting for everything", () => {
  it("resolves true at once when nothing is pending", async () => {
    setup([], fakeBackend());
    expect(await whenAllLoaded()).toBe(true);
  });

  it("waits for the background pass and then reports success", async () => {
    const be = fakeBackend({ delay: 2 });
    setup(["a", "b", "c"], be);
    startBackgroundLoad(["a", "b", "c"]);
    expect(await whenAllLoaded()).toBe(true);
    expect(pendingCount()).toBe(0);
  });

  it("reports false when a page still cannot be loaded", async () => {
    const be = fakeBackend({ failIds: new Set(["b"]) });
    setup(["a", "b"], be);
    expect(await whenAllLoaded()).toBe(false);
    expect(isBoardReady("b")).toBe(false);
  });
});
