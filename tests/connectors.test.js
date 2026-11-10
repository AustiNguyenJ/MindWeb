import { describe, it, expect } from "vitest";
import { createApp, exportJson, waitFor, tick, DEFAULT_ENTRY } from "./harness.js";

/* Flowchart-grade connectors: per-connection route, arrowheads, dash, colour
   and width, pinned sides, the style popover and in-place label editing. All of
   it exists only in the restructured app; the untouched original draws every
   connection as one grey straight line and edits labels through prompt().

   jsdom has no layout, so nothing here reads a measured pixel. Geometry is
   checked through attributes (path `d` strings, coordinates) computed from
   explicit node rectangles in seeded pages; the arithmetic itself is covered
   directly in connectorGeometry.test.js. */
const d = describe.skipIf(DEFAULT_ENTRY.includes("original"));

let app;

const base = { collapsed: false, body: "", bodyHtml: "", color: "#ffffff", border: true, title: "" };
const shapeNode = (id, x, y, kind = "rect", w = 160, h = 90) => ({ ...base, id, type: "shape", shape: kind, x, y, w, h });
const NODES = [
  shapeNode("a", 100, 100),                       // centre 180,145
  shapeNode("b", 500, 300),                       // centre 580,345
  shapeNode("c", 100, 520, "ellipse", 180, 100),
  { ...base, id: "l", type: "list", items: ["one", "two"], x: 700, y: 100, w: 230, h: 150 },
];
const link = (id, extra = {}) => ({ id, from: "a", to: "b", fromItem: null, toItem: null, label: "", ...extra });

function seed(nodes, connections) {
  return {
    "mindmap:index": JSON.stringify({
      version: 2,
      notebooks: [{ id: "nb_seed", name: "NB", collapsed: false }],
      boards: [{ id: "brd_s", name: "Seeded", description: "", notebookId: "nb_seed", order: 0, pinned: false }],
    }),
    "mindmap:board:brd_s": JSON.stringify({ id: "brd_s", name: "Seeded", nodes, connections }),
  };
}

async function boot(connections = [], nodes = NODES) {
  app = await createApp(undefined, { storage: seed(nodes, connections) });
  await waitFor(() => app.nodes().length === nodes.length, { label: "seeded blocks" });
  return app;
}

const vis = (id) => app.$(`#connSvg .visible[data-conn="${id}"]`);
const hit = (id) => app.$(`#connSvg .hit[data-conn="${id}"]`);
const attrs = (node) => Object.fromEntries([...node.attributes].map((a) => [a.name, a.value]));
const tag = (node) => node.tagName.toLowerCase();
const conns = async () => (await exportJson(app)).boards[0].connections;
const conn = async (id) => (await conns()).find((c) => c.id === id);
const nodeEl = (id) => app.$(`.node[data-id="${id}"]`);
const dot = (id, side) => nodeEl(id).querySelector(`.side-dot[data-side="${side}"]`);
const pop = () => app.$(".conn-pop");
const control = (act, val) => app.$(`.conn-pop [data-act="${act}"]` + (val !== undefined ? `[data-val="${val}"]` : ""));
const select = (id) => app.click(hit(id));
const dbl = (node) => app.pointer(node, "dblclick");
const editor = () => app.$(".conn-label-edit");
const blurFocus = () => app.document.activeElement?.blur?.();
const bar = (type) => app.$(`.add-btn[data-type="${type}"]`);

/** Press on `startEl`, release over `target` (what elementFromPoint will report). */
function dragFrom(startEl, target, init = {}) {
  app.pointer(startEl, "pointerdown", { button: 0 });
  app.window.__hitTarget = target;
  app.pointer(app.document, "pointerup", { button: 0, ...init });
  app.window.__hitTarget = null;
}

function importFile(payload) {
  const file = new app.window.File([JSON.stringify(payload)], "backup.json", { type: "application/json" });
  const input = app.$("#jsonFileInput");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new app.window.Event("change", { bubbles: true }));
}

const STYLED = {
  route: "elbow", startArrow: true, endArrow: false, dash: "dashed", color: "#d64545", width: 3.5,
  fromSide: "b", toSide: "t",
};
const STYLE_KEYS = ["route", "startArrow", "endArrow", "dash", "color", "width", "fromSide", "toSide"];
const styleOf = (c) => Object.fromEntries(STYLE_KEYS.filter((k) => k in c).map((k) => [k, c[k]]));

d("connectors: a default connection is unchanged", () => {
  it("is a <line> with exactly the attributes it always had", async () => {
    await boot([link("c1")]);
    const v = vis("c1"), h = hit("c1");
    expect(tag(v)).toBe("line");
    expect(attrs(v)).toEqual({
      class: "visible", "data-conn": "c1", x1: "260", y1: "185", x2: "500", y2: "305",
      stroke: "#9aa1ab", "stroke-width": "2", "marker-end": "url(#arrowHead)",
    });
    expect(tag(h)).toBe("line");
    expect(attrs(h)).toEqual({
      class: "hit", "data-conn": "c1", x1: "260", y1: "185", x2: "500", y2: "305",
      stroke: "transparent", "stroke-width": "14",
    });
  });

  it("draws and persists a connection saved with no item keys the same way", async () => {
    await boot([{ id: "c1", from: "a", to: "b" }]);
    expect(attrs(vis("c1")).x1).toBe("260");
    expect(attrs(vis("c1"))["marker-end"]).toBe("url(#arrowHead)");
  });

  it("shows nothing floating over it until it is selected", async () => {
    await boot([link("c1")]);
    expect(pop()).toBeNull();
    expect(app.$(".conn-end")).toBeNull();
    expect(app.$(".conn-label")).toBeNull();
    expect(app.$(".conn-label-edit")).toBeNull();
  });

  it("keeps the old selected look: accent stroke, 2.5 wide, no halo", async () => {
    await boot([link("c1")]);
    select("c1");
    expect(attrs(vis("c1")).class).toBe("visible selected");
    expect(attrs(vis("c1"))["stroke-width"]).toBe("2.5");
    expect(attrs(hit("c1")).class).toBe("hit");
  });

  it("ignores style values it does not understand instead of drawing them", async () => {
    await boot([link("c1", {
      route: "zigzag", startArrow: "yes", endArrow: 0, dash: 7, color: "red", width: -4,
      fromSide: "up", toSide: 3,
    })]);
    expect(attrs(vis("c1"))).toEqual({
      class: "visible", "data-conn": "c1", x1: "260", y1: "185", x2: "500", y2: "305",
      stroke: "#9aa1ab", "stroke-width": "2", "marker-end": "url(#arrowHead)",
    });
  });

  it("does not let a hostile colour reach an attribute", async () => {
    await boot([link("c1", { color: '#fff" onload="alert(1)' })]);
    expect(attrs(vis("c1")).stroke).toBe("#9aa1ab");
    expect(app.$$("#connSvg marker")).toHaveLength(1);
  });
});

d("connectors: routes", () => {
  it("draws an elbow as a path of right angles, hit target included", async () => {
    await boot([link("c1", { route: "elbow" })]);
    const path = "M260 145 L372 145 Q380 145 380 153 L380 337 Q380 345 388 345 L500 345";
    expect(tag(vis("c1"))).toBe("path");
    expect(attrs(vis("c1"))).toEqual({
      class: "visible", "data-conn": "c1", d: path, stroke: "#9aa1ab", "stroke-width": "2",
      fill: "none", "marker-end": "url(#arrowHead)",
    });
    expect(tag(hit("c1"))).toBe("path");
    expect(attrs(hit("c1"))).toEqual({
      class: "hit", "data-conn": "c1", d: path, stroke: "transparent", "stroke-width": "14", fill: "none",
    });
  });

  it("draws a curve as one smooth cubic Bezier, hit target included", async () => {
    await boot([link("c1", { route: "curve" })]);
    const dAttr = vis("c1").getAttribute("d");
    expect(tag(vis("c1"))).toBe("path");
    expect(dAttr).toMatch(/^M260 145 C[\d. ]+ 500 345$/);
    expect(dAttr.match(/C/g)).toHaveLength(1);
    expect(hit("c1").getAttribute("d")).toBe(dAttr);
    expect(vis("c1").getAttribute("fill")).toBe("none");
  });

  it("leaves and enters perpendicular to a pinned side", async () => {
    await boot([link("c1", { route: "elbow", fromSide: "b", toSide: "t" })]);
    expect(vis("c1").getAttribute("d")).toBe(
      "M180 190 L180 237 Q180 245 188 245 L572 245 Q580 245 580 253 L580 300");
  });

  it("pins a straight line to a side without changing it into anything else", async () => {
    await boot([link("c1", { fromSide: "b" })]);
    expect(tag(vis("c1"))).toBe("line");
    expect(attrs(vis("c1")).x1).toBe("180");
    expect(attrs(vis("c1")).y1).toBe("190");
  });

  it("attaches a pinned side at a diamond's vertex", async () => {
    const nodes = [shapeNode("a", 100, 100, "diamond", 180, 110), shapeNode("b", 500, 300)];
    await boot([link("c1", { fromSide: "r" })], nodes);
    expect(attrs(vis("c1")).x1).toBe("280");
    expect(attrs(vis("c1")).y1).toBe("155");
  });

  it("ignores a pinned side on a row end", async () => {
    const row = { id: "r1", from: "l", to: "b", fromItem: 1, toItem: null, label: "" };
    await boot([{ ...row }, { ...row, id: "r2", fromSide: "t", toSide: "b" }]);
    expect(vis("r2").getAttribute("x1")).toBe(vis("r1").getAttribute("x1"));
    expect(vis("r2").getAttribute("y1")).toBe(vis("r1").getAttribute("y1"));
  });

  it("puts the label at the middle of an elbow's middle segment", async () => {
    await boot([link("c1", { route: "elbow", label: "yes", fromSide: "r", toSide: "t" })]);
    // an L: 320 right then 155 down; halfway along is 237.5 into the first leg
    expect(app.$(".conn-label").style.left).toBe("497.5px");
    expect(app.$(".conn-label").style.top).toBe("145px");
  });

  it("puts the label at the middle of a straight line, as it always was", async () => {
    await boot([link("c1", { label: "yes" })]);
    expect(app.$(".conn-label").style.left).toBe("380px");
    expect(app.$(".conn-label").style.top).toBe("245px");
  });
});

d("connectors: arrowheads, dash, colour and width", () => {
  const marker = (id) => app.$(`#connSvg marker[id="${id}"]`);

  it("draws an arrowhead at the end only, by default", async () => {
    await boot([link("c1")]);
    expect(vis("c1").getAttribute("marker-end")).toBe("url(#arrowHead)");
    expect(vis("c1").hasAttribute("marker-start")).toBe(false);
  });

  it("adds a start arrowhead that points back along the line", async () => {
    await boot([link("c1", { startArrow: true })]);
    expect(vis("c1").getAttribute("marker-start")).toBe("url(#connArrow-start-9aa1ab)");
    expect(vis("c1").getAttribute("marker-end")).toBe("url(#arrowHead)");
    const m = marker("connArrow-start-9aa1ab");
    expect(m.getAttribute("orient")).toBe("auto");
    expect(m.querySelector("path").getAttribute("d")).toBe("M8,0 L0,4 L8,8 Z");   // tip at x=0
    expect(marker("arrowHead").querySelector("path").getAttribute("d")).toBe("M0,0 L8,4 L0,8 Z");   // tip at x=8
  });

  it("draws neither arrowhead, or only the start one, when asked", async () => {
    await boot([link("none", { endArrow: false }), link("start", { endArrow: false, startArrow: true }), link("both", { startArrow: true })]);
    expect(vis("none").hasAttribute("marker-end")).toBe(false);
    expect(vis("none").hasAttribute("marker-start")).toBe(false);
    expect(vis("start").hasAttribute("marker-end")).toBe(false);
    expect(vis("start").hasAttribute("marker-start")).toBe(true);
    expect(vis("both").hasAttribute("marker-end") && vis("both").hasAttribute("marker-start")).toBe(true);
  });

  it("aligns arrowheads with the route by using orient=auto on every marker", async () => {
    await boot([link("c1", { route: "elbow", startArrow: true, color: "#2f9e5f" }), link("c2", { route: "curve", startArrow: true, color: "#4757d1" })]);
    app.$$("#connSvg marker").forEach((m) => expect(m.getAttribute("orient")).toBe("auto"));
  });

  it("colours the line and its arrowheads, one marker per colour", async () => {
    await boot([link("c1", { color: "#d64545", startArrow: true }), link("c2", { color: "#D64545" })]);
    expect(attrs(vis("c1")).stroke).toBe("#d64545");
    expect(attrs(vis("c1")).class).toBe("visible colored");
    expect(vis("c1").getAttribute("marker-end")).toBe("url(#connArrow-end-d64545)");
    expect(vis("c1").getAttribute("marker-start")).toBe("url(#connArrow-start-d64545)");
    expect(marker("connArrow-end-d64545").querySelector("path").getAttribute("fill")).toBe("#d64545");
    expect(marker("connArrow-start-d64545").querySelector("path").getAttribute("fill")).toBe("#d64545");
    expect(app.$$('#connSvg marker[id="connArrow-end-d64545"]')).toHaveLength(1);
    // the default grey arrowhead is still the static one
    expect(marker("arrowHead")).not.toBeNull();
  });

  it("follows the theme: palette colours lift in dark mode, the default grey does not", async () => {
    await boot([link("c1", { color: "#d64545" }), link("c2")]);
    app.click(app.$("#themeToggleBtn"));
    expect(attrs(vis("c1")).stroke).toBe("#f07178");
    expect(vis("c1").getAttribute("marker-end")).toBe("url(#connArrow-end-f07178)");
    expect(marker("connArrow-end-f07178").querySelector("path").getAttribute("fill")).toBe("#f07178");
    expect(attrs(vis("c2")).stroke).toBe("#9aa1ab");
    app.click(app.$("#themeToggleBtn"));
    expect(attrs(vis("c1")).stroke).toBe("#d64545");
  });

  it("dashes and dots the visible stroke but never the click target", async () => {
    await boot([link("s"), link("dash", { dash: "dashed" }), link("dot", { dash: "dotted" })]);
    expect(vis("s").hasAttribute("stroke-dasharray")).toBe(false);
    expect(vis("dash").getAttribute("stroke-dasharray")).toBe("7 5");
    expect(vis("dash").hasAttribute("stroke-linecap")).toBe(false);
    expect(vis("dot").getAttribute("stroke-dasharray")).toBe("0.01 4.4");
    expect(vis("dot").getAttribute("stroke-linecap")).toBe("round");
    ["s", "dash", "dot"].forEach((id) => expect(hit(id).hasAttribute("stroke-dasharray")).toBe(false));
  });

  it("scales the line width, and the dash pattern with it", async () => {
    await boot([link("thin", { width: 1.5 }), link("thick", { width: 3.5, dash: "dashed" })]);
    expect(vis("thin").getAttribute("stroke-width")).toBe("1.5");
    expect(vis("thick").getAttribute("stroke-width")).toBe("3.5");
    expect(vis("thick").getAttribute("stroke-dasharray")).toBe("12.25 8.75");
    expect(hit("thick").getAttribute("stroke-width")).toBe("14");
    select("thick");
    expect(vis("thick").getAttribute("stroke-width")).toBe("4");
  });

  it("keeps a coloured line's own colour when selected, with a halo", async () => {
    await boot([link("c1", { color: "#4757d1" })]);
    select("c1");
    expect(attrs(vis("c1")).class).toBe("visible selected colored");
    expect(attrs(vis("c1")).stroke).toBe("#4757d1");
    expect(attrs(hit("c1")).class).toBe("hit halo");
  });
});

d("connectors: the style popover", () => {
  it("opens when a connection is selected, with every control", async () => {
    await boot([link("c1")]);
    select("c1");
    expect(pop()).not.toBeNull();
    expect(app.$$(".conn-pop")).toHaveLength(1);
    expect(pop().getAttribute("role")).toBe("toolbar");
    expect(app.$$('.conn-pop [data-act="route"]').map((b) => b.dataset.val)).toEqual(["straight", "elbow", "curve"]);
    expect(control("startArrow")).not.toBeNull();
    expect(control("endArrow")).not.toBeNull();
    expect(app.$$('.conn-pop [data-act="dash"]').map((b) => b.dataset.val)).toEqual(["solid", "dashed", "dotted"]);
    expect(app.$$('.conn-pop [data-act="width"]').map((b) => b.dataset.val)).toEqual(["1.5", "2", "3.5"]);
    expect(app.$$('.conn-pop [data-act="color"]').length).toBeGreaterThanOrEqual(6);
    expect(control("label")).not.toBeNull();
    expect(app.$(".conn-pop .conn-del")).not.toBeNull();
  });

  it("marks the current choices as pressed", async () => {
    await boot([link("c1", { route: "curve", startArrow: true, dash: "dotted", width: 3.5, color: "#2f9e5f" })]);
    select("c1");
    const on = (act, val) => control(act, val).getAttribute("aria-pressed");
    expect(on("route", "curve")).toBe("true");
    expect(on("route", "straight")).toBe("false");
    expect(on("startArrow")).toBe("true");
    expect(on("endArrow")).toBe("true");
    expect(on("dash", "dotted")).toBe("true");
    expect(on("width", "3.5")).toBe("true");
    expect(on("color", "#2f9e5f")).toBe("true");
    expect(on("color", "#9aa1ab")).toBe("false");
  });

  it("is gone once nothing is selected", async () => {
    await boot([link("c1")]);
    select("c1");
    app.pointer(app.$("#viewport"), "pointerdown", { button: 0 });   // empty canvas
    expect(pop()).toBeNull();
    expect(attrs(vis("c1")).class).toBe("visible");
  });

  it("closes on Escape", async () => {
    await boot([link("c1")]);
    select("c1");
    app.key(null, "Escape");
    expect(pop()).toBeNull();
    expect(app.$(".conn-end")).toBeNull();
  });

  it("closes when a block is selected instead", async () => {
    await boot([link("c1")]);
    select("c1");
    app.pointer(nodeEl("a"), "pointerdown", { button: 0 });
    expect(pop()).toBeNull();
  });

  it("does not let a press reach the canvas, so it cannot start a pan", async () => {
    await boot([link("c1")]);
    select("c1");
    let reached = false;
    app.document.addEventListener("pointerdown", () => { reached = true; });
    app.pointer(control("route", "elbow"), "pointerdown", { button: 0 });
    app.pointer(pop(), "pointerdown", { button: 0 });
    expect(reached).toBe(false);
    expect(app.$("#viewport").classList.contains("panning")).toBe(false);
    expect(app.$("#viewport").classList.contains("linking")).toBe(false);
  });

  it("changes the route, and straight is stored as no property at all", async () => {
    await boot([link("c1")]);
    select("c1");
    app.click(control("route", "elbow"));
    expect((await conn("c1")).route).toBe("elbow");
    expect(tag(vis("c1"))).toBe("path");
    expect(pop()).not.toBeNull();                         // still selected
    app.click(control("route", "curve"));
    expect((await conn("c1")).route).toBe("curve");
    app.click(control("route", "straight"));
    const c = await conn("c1");
    expect("route" in c).toBe(false);
    expect(Object.keys(c).sort()).toEqual(["from", "fromItem", "id", "label", "to", "toItem"]);
    expect(tag(vis("c1"))).toBe("line");
  });

  it("toggles each arrowhead, storing only the non-default state", async () => {
    await boot([link("c1")]);
    select("c1");
    app.click(control("startArrow"));
    expect((await conn("c1")).startArrow).toBe(true);
    expect(vis("c1").hasAttribute("marker-start")).toBe(true);
    app.click(control("startArrow"));
    expect("startArrow" in await conn("c1")).toBe(false);
    expect(vis("c1").hasAttribute("marker-start")).toBe(false);

    app.click(control("endArrow"));
    expect((await conn("c1")).endArrow).toBe(false);
    expect(vis("c1").hasAttribute("marker-end")).toBe(false);
    app.click(control("endArrow"));
    expect("endArrow" in await conn("c1")).toBe(false);
    expect(vis("c1").getAttribute("marker-end")).toBe("url(#arrowHead)");
  });

  it("sets dash, thickness and colour, and clears each when set back to its default", async () => {
    await boot([link("c1")]);
    select("c1");
    app.click(control("dash", "dashed"));
    app.click(control("width", "3.5"));
    app.click(control("color", "#8b5cf6"));
    let c = await conn("c1");
    expect(styleOf(c)).toEqual({ dash: "dashed", width: 3.5, color: "#8b5cf6" });
    expect(vis("c1").getAttribute("stroke")).toBe("#8b5cf6");
    expect(vis("c1").getAttribute("stroke-dasharray")).toBe("12.25 8.75");
    app.click(control("dash", "solid"));
    app.click(control("width", "2"));
    app.click(control("color", "#9aa1ab"));
    c = await conn("c1");
    expect(styleOf(c)).toEqual({});
    expect(attrs(vis("c1")).stroke).toBe("#9aa1ab");
  });

  it("keeps keyboard focus on the control that was used, though the popover is rebuilt", async () => {
    await boot([link("c1")]);
    select("c1");
    app.click(control("dash", "dotted"));
    expect(app.window.__focused.dataset.act).toBe("dash");
    expect(app.window.__focused.dataset.val).toBe("dotted");
    expect(app.window.__focused.isConnected).toBe(true);
  });

  it("still deletes with the red button", async () => {
    await boot([link("c1")]);
    select("c1");
    app.click(app.$(".conn-del"));
    expect(app.connCount()).toBe(0);
    expect(pop()).toBeNull();
    expect(await conns()).toHaveLength(0);
  });

  it("still deletes with the Delete key", async () => {
    await boot([link("c1")]);
    select("c1");
    blurFocus();
    app.key(null, "Delete");
    expect(app.connCount()).toBe(0);
  });

  it("does not delete the connection when Backspace edits its label", async () => {
    await boot([link("c1", { label: "x" })]);
    select("c1");
    app.click(control("label"));
    app.key(editor(), "Backspace");
    expect(app.connCount()).toBe(1);
  });

  it("does not offer a popover for a connection that is not selected", async () => {
    await boot([link("c1"), link("c2", { to: "c" })]);
    select("c1");
    select("c2");
    expect(app.$$(".conn-pop")).toHaveLength(1);
    expect(attrs(vis("c1")).class).toBe("visible");
    expect(attrs(vis("c2")).class).toBe("visible selected");
  });
});

d("connectors: editing a label in place", () => {
  it("opens an input on double-click instead of a prompt", async () => {
    await boot([link("c1")]);
    dbl(hit("c1"));
    expect(editor()).not.toBeNull();
    expect(app.window.__focused).toBe(editor());
    expect(app.rec.prompts).toHaveLength(0);
  });

  it("sits at the label's own spot", async () => {
    await boot([link("c1", { label: "yes" })]);
    select("c1");
    app.click(app.$(".conn-label"));
    expect(editor().style.left).toBe("380px");
    expect(editor().style.top).toBe("245px");
    expect(editor().value).toBe("yes");
  });

  it("commits on Enter", async () => {
    await boot([link("c1")]);
    dbl(hit("c1"));
    app.type(editor(), "Approved");
    app.key(editor(), "Enter");
    expect(editor()).toBeNull();
    expect(app.$(".conn-label").textContent).toBe("Approved");
    expect((await conn("c1")).label).toBe("Approved");
    expect(app.rec.prompts).toHaveLength(0);
  });

  it("commits on blur", async () => {
    await boot([link("c1")]);
    dbl(hit("c1"));
    app.type(editor(), "Blurred in");
    app.blur(editor());
    expect(editor()).toBeNull();
    expect((await conn("c1")).label).toBe("Blurred in");
  });

  it("cancels on Escape and leaves the connection selected", async () => {
    await boot([link("c1", { label: "keep" })]);
    select("c1");
    app.click(app.$(".conn-label"));
    app.type(editor(), "thrown away");
    app.key(editor(), "Escape");
    expect(editor()).toBeNull();
    expect(app.$(".conn-label").textContent).toBe("keep");
    expect((await conn("c1")).label).toBe("keep");
    expect(pop()).not.toBeNull();
    expect(attrs(vis("c1")).class).toBe("visible selected");
  });

  it("does not commit twice when Enter is followed by the blur it causes", async () => {
    await boot([link("c1")]);
    dbl(hit("c1"));
    const input = editor();
    app.type(input, "once");
    app.key(input, "Enter");
    app.blur(input);
    expect((await conn("c1")).label).toBe("once");
    expect(app.$$(".conn-label")).toHaveLength(1);
  });

  it("clears the label when emptied", async () => {
    await boot([link("c1", { label: "going" })]);
    select("c1");
    app.click(app.$(".conn-label"));
    app.type(editor(), "");
    app.key(editor(), "Enter");
    expect(app.$(".conn-label")).toBeNull();
    expect((await conn("c1")).label).toBe("");
  });

  it("trims the label", async () => {
    await boot([link("c1")]);
    dbl(hit("c1"));
    app.type(editor(), "   spaced   ");
    app.key(editor(), "Enter");
    expect((await conn("c1")).label).toBe("spaced");
  });

  it("selects on the first click of a label and edits on the second", async () => {
    await boot([link("c1", { label: "go" })]);
    app.click(app.$(".conn-label"));
    expect(pop()).not.toBeNull();
    expect(editor()).toBeNull();
    app.click(app.$(".conn-label"));
    expect(editor()).not.toBeNull();
  });

  it("opens from the popover's Label button", async () => {
    await boot([link("c1", { label: "go" })]);
    select("c1");
    app.click(control("label"));
    expect(editor().value).toBe("go");
    expect(app.window.__focused).toBe(editor());
  });

  it("keeps what was typed when the page redraws underneath it", async () => {
    await boot([link("c1")]);
    dbl(hit("c1"));
    const input = editor();
    app.type(input, "half-typed");
    app.click(app.$("#themeToggleBtn"));   // renders the whole page again
    expect(editor()).toBe(input);
    expect(editor().value).toBe("half-typed");
    app.click(app.$("#themeToggleBtn"));
  });

  it("never lets a stale editor outlive its connection", async () => {
    await boot([link("c1")]);
    dbl(hit("c1"));
    app.click(app.$(".conn-del"));
    expect(editor()).toBeNull();
    expect(app.connCount()).toBe(0);
  });

  it("draws the label on top of the line with its own background (not struck through)", async () => {
    await boot([link("c1", { label: "x" })]);
    expect(app.$(".conn-label").parentElement.id).toBe("canvasInner");
    expect(app.$(".conn-label").textContent).toBe("x");
  });
});

d("connectors: side dots", () => {
  it("puts four dots on every block, beside the original connection handle", async () => {
    await boot([]);
    app.nodes().forEach((n) => {
      expect([...n.querySelectorAll(".side-dot")].map((x) => x.dataset.side)).toEqual(["t", "r", "b", "l"]);
      expect(n.querySelectorAll(".conn-handle")).toHaveLength(1);
    });
  });

  it("pins the start by dragging from a dot and the end by dropping on one", async () => {
    await boot([]);
    dragFrom(dot("a", "b"), dot("b", "t"));
    const [c] = await conns();
    expect(c).toMatchObject({ from: "a", to: "b", fromItem: null, toItem: null, fromSide: "b", toSide: "t" });
    expect(attrs(vis(c.id)).class).toBe("visible");
  });

  it("starts the guide line at the dot's side", async () => {
    await boot([]);
    app.pointer(dot("a", "b"), "pointerdown", { button: 0 });
    const guide = app.$("#tempConnLine");
    expect(guide.getAttribute("x1")).toBe("180");
    expect(guide.getAttribute("y1")).toBe("190");
    expect(app.$("#viewport").classList.contains("linking")).toBe(true);
    app.pointer(app.document, "pointerup", { button: 0 });
  });

  it("leaves an end automatic when it is dropped on the block rather than a dot", async () => {
    await boot([]);
    dragFrom(dot("a", "r"), nodeEl("b"));
    const [c] = await conns();
    expect(c.fromSide).toBe("r");
    expect("toSide" in c).toBe(false);
  });

  it("cannot be dropped on its own block", async () => {
    await boot([]);
    dragFrom(dot("a", "r"), dot("a", "l"));
    expect(await conns()).toHaveLength(0);
  });

  it("pressing a dot does not start dragging the block", async () => {
    await boot([]);
    app.pointer(dot("a", "t"), "pointerdown", { button: 0, clientX: 0, clientY: 0 });
    app.pointer(app.document, "pointermove", { clientX: 80, clientY: 80 });
    expect(nodeEl("a").style.left).toBe("100px");
    app.pointer(app.document, "pointerup", { button: 0 });
  });

  it("Escape abandons a drag from a dot", async () => {
    await boot([]);
    app.pointer(dot("a", "t"), "pointerdown", { button: 0 });
    app.key(null, "Escape");
    expect(app.$("#tempConnLine")).toBeNull();
    expect(app.$("#viewport").classList.contains("linking")).toBe(false);
    app.window.__hitTarget = nodeEl("b");
    app.pointer(app.document, "pointerup", { button: 0 });
    app.window.__hitTarget = null;
    expect(await conns()).toHaveLength(0);
  });

  it("the original handle still links without pinning anything", async () => {
    await boot([]);
    dragFrom(nodeEl("a").querySelector(".conn-handle"), nodeEl("b"));
    const [c] = await conns();
    expect(c.fromItem).toBeNull();
    expect(c.toItem).toBeNull();
    expect("fromSide" in c || "toSide" in c).toBe(false);
  });

  it("keeps the pinned side on a block spawned from the drag by hotkey", async () => {
    await boot([]);
    app.pointer(dot("a", "r"), "pointerdown", { button: 0 });
    blurFocus();
    app.key(null, "d");                    // a diamond
    const cs = await conns();
    expect(cs).toHaveLength(1);
    expect(cs[0].fromSide).toBe("r");
    expect(cs[0].route).toBe("elbow");     // shape to shape
  });

  it("keeps the pinned side on a block chosen from the drop-on-canvas picker", async () => {
    await boot([]);
    app.pointer(dot("a", "b"), "pointerdown", { button: 0 });
    app.window.__hitTarget = null;
    app.pointer(app.document, "pointerup", { button: 0, clientX: 300, clientY: 300 });
    app.type(app.$("#pickerInput"), "Note");
    app.key(app.$("#pickerInput"), "Enter");
    const cs = await conns();
    expect(cs).toHaveLength(1);
    expect(cs[0].fromSide).toBe("b");
    expect("route" in cs[0]).toBe(false);   // a note is not a shape
  });
});

d("connectors: dragging a connection's end", () => {
  it("offers a handle on each whole-block end of the selected connection", async () => {
    await boot([link("c1")]);
    expect(app.$(".conn-end")).toBeNull();
    select("c1");
    const from = app.$('.conn-end[data-end="from"]'), to = app.$('.conn-end[data-end="to"]');
    expect(from.style.left).toBe("260px");
    expect(from.style.top).toBe("185px");
    expect(to.style.left).toBe("500px");
    expect(to.style.top).toBe("305px");
  });

  it("offers none on a row end, which has no side to choose", async () => {
    await boot([link("c1", { from: "l", fromItem: 1 })]);
    select("c1");
    expect(app.$('.conn-end[data-end="from"]')).toBeNull();
    expect(app.$('.conn-end[data-end="to"]')).not.toBeNull();
  });

  it("pins the end to a side dot of the block it is on", async () => {
    await boot([link("c1")]);
    select("c1");
    dragFrom(app.$('.conn-end[data-end="to"]'), dot("b", "l"));
    expect(await conn("c1")).toMatchObject({ to: "b", toItem: null, toSide: "l" });
    expect(attrs(vis("c1")).x2).toBe("500");
    expect(attrs(vis("c1")).y2).toBe("345");
    expect(pop()).not.toBeNull();          // still selected
  });

  it("pins the start end the same way", async () => {
    await boot([link("c1")]);
    select("c1");
    dragFrom(app.$('.conn-end[data-end="from"]'), dot("a", "t"));
    expect(await conn("c1")).toMatchObject({ from: "a", fromSide: "t" });
  });

  it("moves the end to another block's dot", async () => {
    await boot([link("c1")]);
    select("c1");
    dragFrom(app.$('.conn-end[data-end="to"]'), dot("c", "r"));
    expect(await conn("c1")).toMatchObject({ from: "a", to: "c", toItem: null, toSide: "r" });
  });

  it("goes back to automatic when dropped on the body of its own block", async () => {
    await boot([link("c1", { toSide: "l" })]);
    select("c1");
    dragFrom(app.$('.conn-end[data-end="to"]'), nodeEl("b"));
    expect("toSide" in await conn("c1")).toBe(false);
  });

  it("does nothing when dropped on the other end's block, on another block's body, or on empty canvas", async () => {
    await boot([link("c1", { toSide: "l" })]);
    select("c1");
    const before = await conn("c1");
    dragFrom(app.$('.conn-end[data-end="to"]'), dot("a", "r"));
    select("c1");
    dragFrom(app.$('.conn-end[data-end="to"]'), nodeEl("c"));
    select("c1");
    dragFrom(app.$('.conn-end[data-end="to"]'), null);
    expect(await conn("c1")).toEqual(before);
  });

  it("does not turn a hotkey into a newly connected block, as a fresh link drag does", async () => {
    await boot([link("c1")]);
    select("c1");
    app.pointer(app.$('.conn-end[data-end="to"]'), "pointerdown", { button: 0 });
    blurFocus();
    app.key(null, "d");                    // still just the ordinary spawn-at-cursor
    app.pointer(app.document, "pointerup", { button: 0 });
    expect(await conns()).toHaveLength(1);
    expect(await conn("c1")).toMatchObject({ from: "a", to: "b" });
  });

  it("does not pan the canvas, and Escape abandons the drag", async () => {
    await boot([link("c1")]);
    select("c1");
    app.pointer(app.$('.conn-end[data-end="to"]'), "pointerdown", { button: 0 });
    expect(app.$("#viewport").classList.contains("panning")).toBe(false);
    expect(app.$("#viewport").classList.contains("linking")).toBe(true);
    expect(app.$("#tempConnLine")).not.toBeNull();
    app.key(null, "Escape");
    expect(app.$("#tempConnLine")).toBeNull();
    app.window.__hitTarget = dot("b", "l");
    app.pointer(app.document, "pointerup", { button: 0 });
    app.window.__hitTarget = null;
    expect("toSide" in await conn("c1")).toBe(false);
  });
});

d("connectors: the default route for new connections", () => {
  const spawn2 = async (a, b) => {
    app = await createApp();
    app.click(bar(a));
    app.click(bar(b));
  };

  it("is an elbow between two whole shapes", async () => {
    await spawn2("shape_rect", "shape_diamond");
    dragFrom(app.$(".node.shape-rect .conn-handle"), app.$(".node.shape-diamond"));
    const [c] = await conns();
    expect(c.route).toBe("elbow");
    expect(tag(vis(c.id))).toBe("path");
  });

  it("is straight between a note and a shape, in either direction", async () => {
    await spawn2("note", "shape_rect");
    dragFrom(app.$(".node.type-note .conn-handle"), app.$(".node.type-shape"));
    dragFrom(app.$(".node.type-shape .conn-handle"), app.$(".node.type-note"));
    const cs = await conns();
    expect(cs).toHaveLength(2);
    cs.forEach((c) => expect("route" in c).toBe(false));
    expect(app.$$("#connSvg line.visible")).toHaveLength(2);
  });

  it("is straight between a shape and a text label", async () => {
    await spawn2("shape_rect", "label");
    dragFrom(app.$(".node.type-shape .conn-handle"), app.$(".node.type-label"));
    expect("route" in (await conns())[0]).toBe(false);
  });

  it("does not change a shape-to-shape connection that was saved without a route", async () => {
    await boot([link("c1")]);
    expect(tag(vis("c1"))).toBe("line");
    expect("route" in await conn("c1")).toBe(false);
  });

  it("applies to a block spawned from a shape by hotkey too", async () => {
    app = await createApp();
    app.click(bar("shape_rect"));
    app.pointer(app.$(".node.type-shape .conn-handle"), "pointerdown", { button: 0 });
    blurFocus();
    app.key(null, "o");                    // an ellipse
    expect((await conns())[0].route).toBe("elbow");
  });
});

d("connectors: persistence", () => {
  it("survives export and import", async () => {
    await boot([link("c1", { ...STYLED, label: "kept" })]);
    const dump = await exportJson(app);
    importFile(dump);
    await waitFor(() => app.$("#toast").textContent === "Imported", { label: "import to finish" });
    const after = await exportJson(app);
    const copy = after.boards.find((b) => b.id !== dump.boards[0].id);
    expect(copy.connections).toHaveLength(1);
    expect(styleOf(copy.connections[0])).toEqual(STYLED);
    expect(copy.connections[0].label).toBe("kept");
  });

  it("survives a page duplicate", async () => {
    await boot([link("c1", STYLED)]);
    const pageId = app.pages()[0].dataset.id;
    app.click(app.$(`.board-menu-btn[data-id="${pageId}"]`));
    app.click(app.$('#pageMenu [data-act="dupe"]'));
    await waitFor(() => app.pages().length === 2, { label: "duplicate" });
    const after = await exportJson(app);
    const copy = after.boards.find((b) => /copy$/.test(b.name));
    expect(styleOf(copy.connections[0])).toEqual(STYLED);
    expect(copy.connections[0].id).not.toBe("c1");
    expect(tag(vis(copy.connections[0].id))).toBe("path");
  });

  it("survives copy and paste of a cluster", async () => {
    await boot([link("c1", { ...STYLED, label: "x" })]);
    blurFocus();
    app.key(null, "a", { ctrlKey: true });
    app.key(null, "c", { ctrlKey: true });
    app.document.dispatchEvent(new app.window.Event("paste", { bubbles: true, cancelable: true }));
    const cs = await conns();
    expect(cs).toHaveLength(2);
    const pasted = cs.find((c) => c.id !== "c1");
    expect(styleOf(pasted)).toEqual(STYLED);
    expect(pasted.label).toBe("x");
    expect(pasted.from).not.toBe("a");
    expect(app.connCount()).toBe(2);
  });

  it("pastes an unstyled connection as the same six keys", async () => {
    await boot([link("c1")]);
    blurFocus();
    app.key(null, "a", { ctrlKey: true });
    app.key(null, "c", { ctrlKey: true });
    app.document.dispatchEvent(new app.window.Event("paste", { bubbles: true, cancelable: true }));
    const pasted = (await conns()).find((c) => c.id !== "c1");
    expect(Object.keys(pasted).sort()).toEqual(["from", "fromItem", "id", "label", "to", "toItem"]);
  });

  it("undoes and redoes a style change", async () => {
    app = await createApp();
    app.click(bar("shape_rect"));
    app.click(bar("shape_diamond"));
    dragFrom(app.$(".node.shape-rect .conn-handle"), app.$(".node.shape-diamond"));
    blurFocus();
    await tick(520);                       // let the link become its own history step
    const id = (await conns())[0].id;
    select(id);
    app.click(control("route", "straight"));
    app.click(control("dash", "dotted"));
    expect(styleOf((await conns())[0])).toEqual({ dash: "dotted" });

    blurFocus();
    app.key(null, "z", { ctrlKey: true });
    expect(styleOf((await conns())[0])).toEqual({ route: "elbow" });
    expect(tag(vis(id))).toBe("path");
    app.key(null, "z", { ctrlKey: true, shiftKey: true });
    expect(styleOf((await conns())[0])).toEqual({ dash: "dotted" });
    expect(tag(vis(id))).toBe("line");
  });

  it("is written to the page's stored file and read back from it", async () => {
    await boot([link("c1", STYLED), link("c2", { to: "c", route: "curve", label: "L" })]);
    app.click(bar("shape_rect"));          // any edit forces a save of the page
    const key = "mindmap:board:brd_s";
    await waitFor(() => JSON.parse(app.window.__storageMap.get(key)).nodes.length === NODES.length + 1,
      { label: "page saved", timeout: 4000 });
    const stored = JSON.parse(app.window.__storageMap.get(key)).connections;
    expect(styleOf(stored.find((c) => c.id === "c1"))).toEqual(STYLED);
    expect(stored.find((c) => c.id === "c2")).toMatchObject({ route: "curve", label: "L" });

    // ...and a fresh start from that stored file draws the same things
    const again = await createApp(undefined, { storage: Object.fromEntries(app.window.__storageMap) });
    app = again;
    await waitFor(() => app.connCount() === 2, { label: "reloaded connections" });
    expect(tag(vis("c1"))).toBe("path");
    expect(vis("c1").getAttribute("stroke")).toBe("#d64545");
    expect(vis("c1").getAttribute("stroke-dasharray")).toBe("12.25 8.75");
    expect(vis("c1").getAttribute("marker-start")).toBe("url(#connArrow-start-d64545)");
    expect(vis("c1").hasAttribute("marker-end")).toBe(false);
  });

  it("stores an unstyled connection with no style keys at all", async () => {
    await boot([]);
    dragFrom(nodeEl("a").querySelector(".conn-handle"), nodeEl("l"));     // a shape to a list
    const [c] = await conns();
    expect(Object.keys(c).sort()).toEqual(["from", "fromItem", "id", "label", "to", "toItem"]);
  });
});

d("connectors: redrawing while blocks move", () => {
  it("moves the same drawn elements rather than rebuilding them", async () => {
    await boot([link("c1", { route: "elbow", label: "go" })]);
    const v = vis("c1"), h = hit("c1");
    const dBefore = v.getAttribute("d");
    app.pointer(nodeEl("a"), "pointerdown", { button: 0, clientX: 0, clientY: 0 });   // selecting redraws the labels once
    const lbl = app.$(".conn-label");
    app.pointer(app.document, "pointermove", { clientX: 50, clientY: 30 });
    expect(vis("c1")).toBe(v);
    expect(hit("c1")).toBe(h);
    expect(app.$(".conn-label")).toBe(lbl);
    expect(v.getAttribute("d")).not.toBe(dBefore);
    expect(h.getAttribute("d")).toBe(v.getAttribute("d"));
    app.pointer(app.document, "pointerup", { button: 0, clientX: 50, clientY: 30 });
    expect(vis("c1")).toBe(v);
    // the block is now at 150,130: its right-hand side is x=310
    expect(v.getAttribute("d").startsWith("M310 175 L")).toBe(true);
  });

  it("keeps a straight line a straight line while it moves", async () => {
    await boot([link("c1")]);
    const v = vis("c1");
    app.pointer(nodeEl("a"), "pointerdown", { button: 0, clientX: 0, clientY: 0 });
    app.pointer(app.document, "pointermove", { clientX: 50, clientY: 30 });
    expect(vis("c1")).toBe(v);
    expect(tag(v)).toBe("line");
    expect(v.getAttribute("x1")).toBe("310");
    app.pointer(app.document, "pointerup", { button: 0, clientX: 50, clientY: 30 });
  });

  it("redraws a connection between two selected blocks that move together", async () => {
    await boot([link("c1")]);
    const v = vis("c1");
    blurFocus();
    app.key(null, "a", { ctrlKey: true });
    app.pointer(nodeEl("a"), "pointerdown", { button: 0, clientX: 0, clientY: 0 });
    app.pointer(app.document, "pointermove", { clientX: 50, clientY: 30 });
    app.pointer(app.document, "pointerup", { button: 0, clientX: 50, clientY: 30 });
    expect(vis("c1")).toBe(v);
    expect(attrs(v)).toMatchObject({ x1: "310", y1: "215", x2: "550", y2: "335" });
    expect(attrs(hit("c1"))).toMatchObject({ x1: "310", y1: "215", x2: "550", y2: "335" });
  });

  it("moves the label with its connection", async () => {
    await boot([link("c1", { label: "go" })]);
    app.pointer(nodeEl("a"), "pointerdown", { button: 0, clientX: 0, clientY: 0 });
    app.pointer(app.document, "pointermove", { clientX: 0, clientY: 100 });
    app.pointer(app.document, "pointerup", { button: 0, clientX: 0, clientY: 100 });
    const g = vis("c1");
    const mx = (parseFloat(g.getAttribute("x1")) + parseFloat(g.getAttribute("x2"))) / 2;
    const my = (parseFloat(g.getAttribute("y1")) + parseFloat(g.getAttribute("y2"))) / 2;
    expect(app.$(".conn-label").style.left).toBe(mx + "px");
    expect(app.$(".conn-label").style.top).toBe(my + "px");
  });

  it("redraws an elbow's route when a block moves so another side faces it", async () => {
    await boot([link("c1", { route: "elbow" })]);
    const before = vis("c1").getAttribute("d");
    app.pointer(nodeEl("b"), "pointerdown", { button: 0, clientX: 0, clientY: 0 });
    app.pointer(app.document, "pointermove", { clientX: -440, clientY: 300 });     // now below a
    app.pointer(app.document, "pointerup", { button: 0, clientX: -440, clientY: 300 });
    const after = vis("c1").getAttribute("d");
    expect(after).not.toBe(before);
    expect(after.startsWith("M180 190 L")).toBe(true);     // leaves a's bottom edge
  });
});

d("connectors: the popover stays one size on screen", () => {
  it("publishes the zoom to the canvas so the popover can scale itself back", async () => {
    await boot([link("c1")]);
    expect(app.$("#canvasInner").style.getPropertyValue("--zoom")).toBe("1");
    app.click(app.$("#zoomIn"));
    expect(app.$("#canvasInner").style.getPropertyValue("--zoom")).toBe("1.2");
    app.click(app.$("#zoomOut"));
    expect(parseFloat(app.$("#canvasInner").style.getPropertyValue("--zoom"))).toBeCloseTo(0.996, 3);
  });
});

d("connectors: popover accessibility", () => {
  it("only marks toggles and choices as pressed, not the Label and Delete actions", async () => {
    await boot([link("c1")]);
    select("c1");
    expect(control("label").hasAttribute("aria-pressed")).toBe(false);
    expect(app.$(".conn-pop .conn-del").hasAttribute("aria-pressed")).toBe(false);
    app.$$(".conn-pop button").forEach((b) => expect(b.getAttribute("aria-label") || b.textContent).toBeTruthy());
    app.$$('.conn-pop [data-act="route"], .conn-pop [data-act="dash"], .conn-pop [data-act="color"]')
      .forEach((b) => expect(["true", "false"]).toContain(b.getAttribute("aria-pressed")));
  });
});
