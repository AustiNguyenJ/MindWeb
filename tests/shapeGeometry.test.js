// @vitest-environment jsdom
// connections.js and toolbarConfig.js pull in dom.js, which reads
// document.getElementById at module scope; the functions under test are pure,
// but the imports need a document to exist.
import { describe, it, expect } from "vitest";
import { edgePoint } from "../src/connections.js";
import { defaultToolbarConfig, normalizeToolbarConfig } from "../src/toolbarConfig.js";
import { PARALLELOGRAM_SKEW, ROUNDED_RADIUS } from "../src/constants.js";

const shape = (kind, w = 200, h = 100) => ({ type: "shape", shape: kind, x: 1000, y: 500, w, h });
const centre = (n) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [3, 1], [1, 3], [-2, 5], [-7, -2], [0.3, -4], [5, -5], [100, 1], [1, 100]];

/** Signed distance helper: how far a point is from the rectangle's boundary. */
function onRectBoundary(n, p) {
  const eps = 1e-6;
  const inX = p.x >= n.x - eps && p.x <= n.x + n.w + eps;
  const inY = p.y >= n.y - eps && p.y <= n.y + n.h + eps;
  const onX = Math.abs(p.x - n.x) < eps || Math.abs(p.x - (n.x + n.w)) < eps;
  const onY = Math.abs(p.y - n.y) < eps || Math.abs(p.y - (n.y + n.h)) < eps;
  return inX && inY && (onX || onY);
}

describe("edgePoint: plain blocks are unchanged", () => {
  for (const type of ["note", "header", "image", "list", "label", "ct_x", "shape"]) {
    it(`${type} still meets the bounding rectangle`, () => {
      const n = { type, x: 1000, y: 500, w: 200, h: 100 };
      if (type === "shape") n.shape = "rect";
      for (const [dx, dy] of DIRS) {
        const p = edgePoint(n, dx, dy);
        expect(onRectBoundary(n, p), `${type} dir ${dx},${dy}`).toBe(true);
      }
    });
  }

  it("returns the centre for a zero direction, for shapes too", () => {
    for (const kind of ["rect", "ellipse", "diamond"]) {
      const n = shape(kind);
      expect(edgePoint(n, 0, 0)).toEqual(centre(n));
    }
  });

  it("gives exactly the old arithmetic for a rectangle", () => {
    const n = { type: "note", x: 10, y: 20, w: 200, h: 100 };
    // dir (450,400): sx = 100/450, sy = 50/400 -> s = 0.125
    expect(edgePoint(n, 450, 400)).toEqual({ x: 110 + 450 * 0.125, y: 70 + 400 * 0.125 });
  });

  it("treats a shape with an unknown kind, or no size, as a rectangle", () => {
    const odd = { type: "shape", shape: "bogus", x: 0, y: 0, w: 200, h: 100 };
    expect(onRectBoundary(odd, edgePoint(odd, 3, 1))).toBe(true);
    const flat = { type: "shape", shape: "ellipse", x: 0, y: 0, w: 0, h: 0 };
    expect(edgePoint(flat, 1, 1)).toEqual({ x: 0, y: 0 });
  });
});

describe("edgePoint: ellipse", () => {
  it("lands on the outline in every direction", () => {
    const n = shape("ellipse");
    const c = centre(n);
    for (const [dx, dy] of DIRS) {
      const p = edgePoint(n, dx, dy);
      expect(((p.x - c.x) / 100) ** 2 + ((p.y - c.y) / 50) ** 2, `dir ${dx},${dy}`).toBeCloseTo(1, 9);
      // and stays on the requested ray
      expect((p.x - c.x) * dy - (p.y - c.y) * dx).toBeCloseTo(0, 6);
    }
  });

  it("hits the axis extremes exactly", () => {
    const n = shape("ellipse");
    const c = centre(n);
    expect(edgePoint(n, 1, 0)).toEqual({ x: c.x + 100, y: c.y });
    expect(edgePoint(n, 0, -1)).toEqual({ x: c.x, y: c.y - 50 });
  });

  it("is strictly inside the bounding box on a diagonal (the rectangle rule would not be)", () => {
    const n = shape("ellipse");
    const p = edgePoint(n, 450, 400);
    // a rectangle would give (+56.25, +50) from the centre
    expect(p.x - 1100).toBeCloseTo(49.03, 2);
    expect(p.y - 550).toBeCloseTo(43.58, 2);
  });
});

describe("edgePoint: diamond", () => {
  it("lands on the four edges in every direction", () => {
    const n = shape("diamond", 180, 110);
    const c = centre(n);
    for (const [dx, dy] of DIRS) {
      const p = edgePoint(n, dx, dy);
      expect(Math.abs(p.x - c.x) / 90 + Math.abs(p.y - c.y) / 55, `dir ${dx},${dy}`).toBeCloseTo(1, 9);
    }
  });

  it("meets the vertices on the axes", () => {
    const n = shape("diamond");
    const c = centre(n);
    expect(edgePoint(n, 1, 0)).toEqual({ x: c.x + 100, y: c.y });
    expect(edgePoint(n, -1, 0)).toEqual({ x: c.x - 100, y: c.y });
    expect(edgePoint(n, 0, 1)).toEqual({ x: c.x, y: c.y + 50 });
  });

  it("hits the edge midpoint on the 45-degree-of-the-diamond diagonal", () => {
    const n = shape("diamond");
    const c = centre(n);
    // direction (hw, hh) points at the middle of the upper-right edge
    const p = edgePoint(n, 100, 50);
    expect(p.x).toBeCloseTo(c.x + 50, 9);
    expect(p.y).toBeCloseTo(c.y + 25, 9);
  });
});

describe("edgePoint: parallelogram", () => {
  const n = shape("parallelogram");
  const k = PARALLELOGRAM_SKEW * n.w;

  it("meets the slanted sides at mid height", () => {
    const c = centre(n);
    expect(edgePoint(n, 1, 0).x).toBeCloseTo(c.x + 100 - k / 2, 9);
    expect(edgePoint(n, -1, 0).x).toBeCloseTo(c.x - 100 + k / 2, 9);
  });

  it("meets the flat top and bottom", () => {
    const c = centre(n);
    expect(edgePoint(n, 0, 1).y).toBeCloseTo(c.y + 50, 9);
    expect(edgePoint(n, 0, -1).y).toBeCloseTo(c.y - 50, 9);
  });

  it("always lands on the outline", () => {
    const c = centre(n);
    for (const [dx, dy] of DIRS) {
      const p = edgePoint(n, dx, dy);
      const rx = p.x - c.x, ry = p.y - c.y;
      const onTopBottom = Math.abs(Math.abs(ry) - 50) < 1e-6;
      // slanted sides: right goes (hw,-hh)->(hw-k,hh), left (-hw+k,-hh)->(-hw,hh)
      const sideX = (y) => 100 - k * (y + 50) / 100;
      const onRight = Math.abs(rx - sideX(ry)) < 1e-6;
      const onLeft = Math.abs(rx + sideX(-ry)) < 1e-6;
      expect(onTopBottom || onRight || onLeft, `dir ${dx},${dy} -> ${rx},${ry}`).toBe(true);
      expect(Math.abs(rx)).toBeLessThanOrEqual(100 + 1e-6);
      expect(Math.abs(ry)).toBeLessThanOrEqual(50 + 1e-6);
    }
  });
});

describe("edgePoint: terminator and rounded box", () => {
  it("terminator: flat sides and round caps", () => {
    const n = shape("terminator", 200, 60);
    const c = centre(n);
    expect(edgePoint(n, 1, 0)).toEqual({ x: c.x + 100, y: c.y });
    expect(edgePoint(n, 0, 1)).toEqual({ x: c.x, y: c.y + 30 });
    // a steep ray exits through the flat bottom
    const steep = edgePoint(n, 1, 20);
    expect(steep.y - c.y).toBeCloseTo(30, 9);
    // a shallow diagonal exits through the cap, whose radius is half the height
    for (const [dx, dy] of [[10, 1], [-10, 2], [10, -3], [-20, -5]]) {
      const p = edgePoint(n, dx, dy);
      const capCentreX = c.x + Math.sign(dx) * (100 - 30);
      expect(Math.hypot(p.x - capCentreX, p.y - c.y), `dir ${dx},${dy}`).toBeCloseTo(30, 9);
    }
  });

  it("terminator pulled in from the bounding corner", () => {
    const n = shape("terminator", 200, 60);
    const corner = { x: n.x + n.w, y: n.y + n.h };
    const p = edgePoint(n, n.w, n.h); // aimed straight at the bounding-box corner
    expect(Math.hypot(corner.x - p.x, corner.y - p.y)).toBeGreaterThan(5);
  });

  it("rounded box: flat sides unchanged, corners cut by the radius", () => {
    const n = shape("rounded", 200, 100);
    const c = centre(n);
    expect(edgePoint(n, 1, 0)).toEqual({ x: c.x + 100, y: c.y });
    expect(edgePoint(n, 0, -1)).toEqual({ x: c.x, y: c.y - 50 });
    const p = edgePoint(n, n.w, n.h);
    const cornerCentre = { x: c.x + 100 - ROUNDED_RADIUS, y: c.y + 50 - ROUNDED_RADIUS };
    expect(Math.hypot(p.x - cornerCentre.x, p.y - cornerCentre.y)).toBeCloseTo(ROUNDED_RADIUS, 9);
  });

  it("rounded box: matches the rectangle away from the corners", () => {
    const n = shape("rounded", 200, 100);
    const rect = { ...n, shape: "rect" };
    for (const [dx, dy] of [[10, 1], [10, -2], [-10, 3], [1, 5], [-1, -5]]) {
      expect(edgePoint(n, dx, dy)).toEqual(edgePoint(rect, dx, dy));
    }
  });

  it("a very small rounded box clamps its radius instead of misbehaving", () => {
    const n = shape("rounded", 20, 20);
    const c = centre(n);
    for (const [dx, dy] of DIRS) {
      const p = edgePoint(n, dx, dy);
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      expect(Math.abs(p.x - c.x)).toBeLessThanOrEqual(10 + 1e-6);
      expect(Math.abs(p.y - c.y)).toBeLessThanOrEqual(10 + 1e-6);
    }
  });
});

describe("toolbar config: old saved configs gain the new ids", () => {
  const NEW_IDS = ["shape_rect", "shape_rounded", "shape_ellipse", "shape_diamond", "shape_parallelogram", "shape_terminator", "label"];
  const oldConfig = () => ({
    order: ["note", "question", "list", "ticket", "week", "header", "image"],
    onBar: { note: true, question: false, list: true, ticket: true, week: true, header: true, image: true },
    hotkeys: { header: "h", note: "n", list: "l", question: "q", ticket: "t", week: "w", image: "g" },
  });

  it("defaults include every new id, on the bar, with distinct hotkeys", () => {
    const cfg = defaultToolbarConfig();
    for (const id of NEW_IDS) {
      expect(cfg.order).toContain(id);
      expect(cfg.onBar[id]).toBe(true);
      expect(cfg.hotkeys[id]).toMatch(/^[a-z]$/);
    }
    const keys = Object.values(cfg.hotkeys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps every existing entry, in its saved order, and appends the new ones", () => {
    const out = normalizeToolbarConfig(oldConfig());
    expect(out.order.slice(0, 7)).toEqual(oldConfig().order);
    for (const id of NEW_IDS) expect(out.order).toContain(id);
    expect(out.onBar.question).toBe(false);
    for (const id of NEW_IDS) expect(out.onBar[id]).toBe(true);
    expect(out.hotkeys).toMatchObject(oldConfig().hotkeys);
    expect(out.hotkeys.shape_diamond).toBe("d");
    expect(out.hotkeys.label).toBe("a");
  });

  it("respects a user's remapped existing hotkey", () => {
    const cfg = oldConfig();
    cfg.hotkeys.note = "x";
    const out = normalizeToolbarConfig(cfg);
    expect(out.hotkeys.note).toBe("x");
  });

  it("does not give a new type a default hotkey the saved config already uses", () => {
    const cfg = oldConfig();
    cfg.hotkeys.ct_custom = "d";
    cfg.hotkeys.note = "R";
    const out = normalizeToolbarConfig(cfg);
    expect(out.hotkeys.ct_custom).toBe("d");
    expect(out.hotkeys.shape_diamond).toBeUndefined();
    expect(out.hotkeys.shape_rect).toBeUndefined();
    expect(out.hotkeys.shape_ellipse).toBe("o");
  });

  it("keeps a custom type's saved entries", () => {
    const cfg = oldConfig();
    cfg.order.push("ct_abc");
    cfg.onBar.ct_abc = false;
    const out = normalizeToolbarConfig(cfg);
    expect(out.order).toContain("ct_abc");
    expect(out.onBar.ct_abc).toBe(false);
  });

  it("does not add duplicate order entries on a config that already has the new ids", () => {
    const once = normalizeToolbarConfig(oldConfig());
    const twice = normalizeToolbarConfig(once);
    expect(twice.order).toEqual(once.order);
    expect(new Set(twice.order).size).toBe(twice.order.length);
  });

  it("falls back to the defaults for junk, and for a missing order", () => {
    expect(normalizeToolbarConfig(null)).toEqual(defaultToolbarConfig());
    expect(normalizeToolbarConfig("x")).toEqual(defaultToolbarConfig());
    const noOrder = normalizeToolbarConfig({ onBar: { note: false } });
    expect(noOrder.order).toEqual(defaultToolbarConfig().order);
    expect(noOrder.onBar.note).toBe(false);
  });
});
