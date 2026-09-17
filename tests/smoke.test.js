import { describe, it, expect } from "vitest";
import { createApp } from "./harness.js";

describe("boot", () => {
  it("initializes with a default notebook, page and header node", async () => {
    const app = await createApp();

    expect(app.notebookNames()).toEqual(["My Notebook"]);
    expect(app.pages()).toHaveLength(1);
    expect(app.$("#boardTitle").value).toBe("My first mind map");

    // the seeded board carries exactly one header node
    expect(app.nodeTypes()).toEqual(["header"]);
    expect(app.$(".node .node-title").value).toBe("Central topic");

    // no folder / app storage available in jsdom, so it falls back to memory
    expect(app.$("#storageBar .sb-label").textContent).toBe("Not saving yet");
    expect(app.rec.consoleErrors).toEqual([]);
  });
});
