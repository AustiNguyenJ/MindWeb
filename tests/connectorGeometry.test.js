// @vitest-environment jsdom
// connections.js pulls in dom.js, which reads document.getElementById at module
// scope. Everything under test here is arithmetic on explicit rectangles and
// points (jsdom has no layout to measure), but the import needs a document.
import { describe, it, expect, beforeEach } from "vitest";
import { state } from "../src/state.js";
import { edgePoint, anchorPoint, sidePoint, connGeometry, connLine } from "../src/connections.js";
import {
  SIDE_VEC, autoSide, elbowPoints, roundedPath, polylineMid, curveGeometry, routeGeometry,
} from "../src/connRoutes.js";
import {
  CONN_STYLE_KEYS, sanitizeConnStyle, connStyleOf, setConnStyle, dashArray, themedConnColor,
} from "../src/connStyle.js";
import { PARALLELOGRAM_SKEW } from "../src/constants.js";
import { boardPayload, parseBoardText } from "../src/storage.js";

const P = (x, y) => ({ x, y });
const segs = (pts) => pts.slice(1).map((p, i) => ({ dx: p.x - pts[i].x, dy: p.y - pts[i].y }));
const dir = (s) => ({ x: Math.sign(s.dx), y: Math.sign(s.dy) });

describe("autoSide", () => {
  const r = { x: 0, y: 0, w: 100, h: 50 };
  it("picks the side that faces the target", () => {
    expect(autoSide(r, 500, 25)).toBe("r");
    expect(autoSide(r, -400, 25)).toBe("l");
    expect(autoSide(r, 50, 400)).toBe("b");
    expect(autoSide(r, 50, -300)).toBe("t");
  });
  it("weighs the rectangle's own proportions, like the straight line's clip", () => {
    // equal offsets on a wide, short box: the top/bottom edge is reached first
    expect(autoSide(r, 150, 125)).toBe("b");
    // ...and on a tall, narrow one it is the left/right edge
    expect(autoSide({ x: 0, y: 0, w: 50, h: 100 }, 125, 150)).toBe("r");
  });
  it("defaults to the right side when the target is the centre", () => {
    expect(autoSide(r, 50, 25)).toBe("r");
  });
});

describe("elbowPoints", () => {
  it("is an L (one bend, two segments) when one side is horizontal and the other vertical", () => {
    expect(elbowPoints(P(0, 0), "r", P(100, 80), "t")).toEqual([P(0, 0), P(100, 0), P(100, 80)]);
    expect(elbowPoints(P(0, 0), "b", P(100, 80), "l")).toEqual([P(0, 0), P(0, 80), P(100, 80)]);
  });

  it("is a Z through the halfway line when the sides face each other", () => {
    expect(elbowPoints(P(0, 0), "r", P(100, 50), "l")).toEqual([P(0, 0), P(50, 0), P(50, 50), P(100, 50)]);
    expect(elbowPoints(P(0, 0), "b", P(60, 100), "t")).toEqual([P(0, 0), P(0, 50), P(60, 50), P(60, 100)]);
  });

  it("is a C that runs out past both points when the sides face the same way", () => {
    expect(elbowPoints(P(0, 0), "r", P(0, 50), "r")).toEqual([P(0, 0), P(28, 0), P(28, 50), P(0, 50)]);
    expect(elbowPoints(P(0, 0), "l", P(0, 50), "l")).toEqual([P(0, 0), P(-28, 0), P(-28, 50), P(0, 50)]);
    expect(elbowPoints(P(0, 0), "b", P(40, 0), "b")).toEqual([P(0, 0), P(0, 28), P(40, 28), P(40, 0)]);
    expect(elbowPoints(P(0, 0), "t", P(40, 0), "t")).toEqual([P(0, 0), P(0, -28), P(40, -28), P(40, 0)]);
  });

  it("collapses to one straight segment when the points line up", () => {
    expect(elbowPoints(P(0, 40), "r", P(100, 40), "l")).toEqual([P(0, 40), P(100, 40)]);
    expect(elbowPoints(P(30, 0), "b", P(30, 90), "t")).toEqual([P(30, 0), P(30, 90)]);
  });

  it("keeps a point where the path doubles back, so the arrow still points into the block", () => {
    const pts = elbowPoints(P(0, 0), "r", P(100, 0), "r");
    expect(pts).toEqual([P(0, 0), P(128, 0), P(100, 0)]);
  });

  it("uses only horizontal and vertical segments, 2 to 3 of them, for every pair of sides", () => {
    const sides = Object.keys(SIDE_VEC);
    const targets = [P(100, 80), P(-100, 80), P(100, -80), P(-100, -80), P(37, 211), P(-250, 13)];
    for (const s1 of sides) for (const s2 of sides) for (const t of targets) {
      const pts = elbowPoints(P(0, 0), s1, t, s2);
      expect(pts[0]).toEqual(P(0, 0));
      expect(pts[pts.length - 1]).toEqual(t);
      const ss = segs(pts);
      expect(ss.length, `${s1}->${s2} ${t.x},${t.y}`).toBeGreaterThanOrEqual(2);
      expect(ss.length, `${s1}->${s2} ${t.x},${t.y}`).toBeLessThanOrEqual(3);
      ss.forEach((s) => expect(s.dx === 0 || s.dy === 0).toBe(true));
    }
  });

  it("leaves and arrives perpendicular to the sides when the target lies ahead", () => {
    const cases = [
      ["r", "l", P(200, 70)], ["l", "r", P(-200, 70)], ["b", "t", P(70, 200)], ["t", "b", P(70, -200)],
      ["r", "t", P(200, 90)], ["r", "b", P(200, -90)], ["l", "t", P(-200, 90)], ["b", "l", P(90, 200)],
      ["b", "r", P(-90, 200)], ["t", "l", P(90, -200)],
    ];
    for (const [s1, s2, t] of cases) {
      const ss = segs(elbowPoints(P(0, 0), s1, t, s2));
      expect(dir(ss[0]), `${s1}->${s2} leaves`).toEqual(SIDE_VEC[s1]);
      const into = SIDE_VEC[s2];
      expect(dir(ss[ss.length - 1]), `${s1}->${s2} arrives`).toEqual({ x: -into.x || 0, y: -into.y || 0 });
    }
  });

  it("honours a custom gap", () => {
    expect(elbowPoints(P(0, 0), "r", P(0, 50), "r", 10)).toEqual([P(0, 0), P(10, 0), P(10, 50), P(0, 50)]);
  });
});

describe("roundedPath", () => {
  it("draws a plain segment as a move and a line", () => {
    expect(roundedPath([P(0, 0), P(100, 0)])).toBe("M0 0 L100 0");
  });

  it("rounds every bend with a quadratic corner and leaves the last segment straight", () => {
    const pts = [P(0, 0), P(50, 0), P(50, 50), P(100, 50)];
    expect(roundedPath(pts, 8)).toBe("M0 0 L42 0 Q50 0 50 8 L50 42 Q50 50 58 50 L100 50");
  });

  it("never rounds by more than half of a neighbouring segment", () => {
    expect(roundedPath([P(0, 0), P(10, 0), P(10, 100)], 8)).toBe("M0 0 L5 0 Q10 0 10 5 L10 100");
  });

  it("ends on the final segment's own heading, so an arrowhead lines up with it", () => {
    const d = roundedPath([P(0, 0), P(80, 0), P(80, 60)], 8);
    expect(d.endsWith("L80 60")).toBe(true);
    // the corner's exit point sits on the same vertical as the end point
    expect(d).toContain("Q80 0 80 8");
  });
});

describe("polylineMid", () => {
  it("is the middle of the middle segment for a three-segment route", () => {
    expect(polylineMid([P(0, 0), P(50, 0), P(50, 100), P(100, 100)])).toEqual(P(50, 50));
    expect(polylineMid([P(0, 0), P(10, 0), P(10, 80), P(100, 80)])).toEqual(P(10, 40));
  });
  it("is halfway along the length for one and two segments", () => {
    expect(polylineMid([P(0, 0), P(100, 40)])).toEqual(P(50, 20));
    expect(polylineMid([P(0, 0), P(100, 0), P(100, 40)])).toEqual(P(70, 0));
  });
});

describe("curveGeometry", () => {
  it("is a cubic Bezier with handles pushed straight out of each side", () => {
    const c = curveGeometry(P(0, 0), "r", P(200, 0), "l");
    expect(c.d).toBe("M0 0 C80 0 120 0 200 0");
    expect(c.mid).toEqual(P(100, 0));
  });

  it("arrives heading into the block: the end tangent opposes the side's outward direction", () => {
    for (const s2 of ["t", "r", "b", "l"]) {
      const c = curveGeometry(P(0, 0), "r", P(300, 200), s2);
      const v = SIDE_VEC[s2];
      const tx = 300 - c.c2.x, ty = 200 - c.c2.y;
      expect(Math.sign(tx) || 0).toBe(-v.x || 0);
      expect(Math.sign(ty) || 0).toBe(-v.y || 0);
    }
  });

  it("keeps the handles between 30 and 160 px", () => {
    expect(curveGeometry(P(0, 0), "r", P(20, 0), "l").c1.x).toBe(30);
    expect(curveGeometry(P(0, 0), "r", P(2000, 0), "l").c1.x).toBe(160);
  });

  it("works vertically too", () => {
    expect(curveGeometry(P(0, 0), "b", P(0, 100), "t").d).toBe("M0 0 C0 40 0 60 0 100");
  });

  it("routeGeometry dispatches on the route", () => {
    expect(routeGeometry("curve", P(0, 0), "r", P(200, 0), "l").d).toContain(" C");
    const e = routeGeometry("elbow", P(0, 0), "r", P(100, 50), "l");
    expect(e.d).toContain(" Q");
    expect(e.mid).toEqual(P(50, 25));
    expect(e.points).toHaveLength(4);
  });
});

describe("connector style properties", () => {
  it("resolves a bare connection to today's look", () => {
    expect(connStyleOf({ id: "c", from: "a", to: "b", fromItem: null, toItem: null, label: "" })).toEqual({
      route: "straight", startArrow: false, endArrow: true, dash: "solid",
      color: "#9aa1ab", width: 2, fromSide: null, toSide: null,
    });
  });

  it("stores nothing for a value equal to its default", () => {
    expect(sanitizeConnStyle({
      route: "straight", startArrow: false, endArrow: true, dash: "solid",
      color: "#9AA1AB", width: 2, fromSide: null, toSide: null,
    })).toEqual({});
  });

  it("keeps valid non-default values, lower-casing the colour", () => {
    expect(sanitizeConnStyle({
      route: "curve", startArrow: true, endArrow: false, dash: "dotted",
      color: "#D64545", width: 3.5, fromSide: "b", toSide: "l", label: "ignored", id: "x",
    })).toEqual({
      route: "curve", startArrow: true, endArrow: false, dash: "dotted",
      color: "#d64545", width: 3.5, fromSide: "b", toSide: "l",
    });
  });

  it("drops anything invalid rather than passing it to the page", () => {
    expect(sanitizeConnStyle({
      route: "zigzag", startArrow: "yes", endArrow: 0, dash: 5, color: "red", width: -3,
      fromSide: "top", toSide: "x",
    })).toEqual({});
    for (const color of ["#12", "#12345g", "url(#x)", "#ff0000; x", 5, null]) {
      expect(sanitizeConnStyle({ color }), String(color)).toEqual({});
    }
    for (const width of [0, 0.2, 13, NaN, Infinity, "3", null]) {
      expect(sanitizeConnStyle({ width }), String(width)).toEqual({});
    }
    expect(sanitizeConnStyle(null)).toEqual({});
    expect(sanitizeConnStyle("elbow")).toEqual({});
  });

  it("setConnStyle edits in place and removes a property set back to its default", () => {
    const c = { id: "c", from: "a", to: "b", fromItem: null, toItem: null, label: "hi" };
    setConnStyle(c, { route: "elbow", dash: "dashed", fromSide: "r" });
    expect(c).toEqual({ id: "c", from: "a", to: "b", fromItem: null, toItem: null, label: "hi", route: "elbow", dash: "dashed", fromSide: "r" });
    setConnStyle(c, { route: "straight", fromSide: null });
    expect(c.route).toBeUndefined();
    expect("fromSide" in c).toBe(false);
    expect(c.dash).toBe("dashed");
    setConnStyle(c, { dash: "solid" });
    expect(Object.keys(c).sort()).toEqual(["from", "fromItem", "id", "label", "to", "toItem"]);
    CONN_STYLE_KEYS.forEach((k) => expect(k in c).toBe(false));
  });

  it("scales dash patterns with the line width", () => {
    expect(dashArray("solid", 2)).toBeNull();
    expect(dashArray("dashed", 2)).toBe("7 5");
    expect(dashArray("dotted", 2)).toBe("0.01 4.4");
    expect(dashArray("dashed", 3.5)).toBe("12.25 8.75");
  });

  it("lifts palette colours in dark mode and leaves the default grey alone", () => {
    expect(themedConnColor("#374151", false)).toBe("#374151");
    expect(themedConnColor("#374151", true)).toBe("#d1d5db");
    expect(themedConnColor("#9aa1ab", true)).toBe("#9aa1ab");
    expect(themedConnColor("#123456", true)).toBe("#123456");
  });
});

describe("pinned sides and connection geometry", () => {
  const shape = (id, x, y, kind = "rect", w = 160, h = 90) => ({ id, type: "shape", shape: kind, x, y, w, h });
  const A = shape("a", 100, 100);      // centre 180,145
  const B = shape("b", 500, 300);      // centre 580,345
  const conn = (extra = {}) => ({ id: "c", from: "a", to: "b", fromItem: null, toItem: null, label: "", ...extra });

  beforeEach(() => {
    state.currentBoardId = "p";
    state.boardsData = { p: { nodes: [A, B], connections: [] } };
    state.itemOffsets = {};
    state.groupOffsets = {};
  });

  describe("sidePoint", () => {
    it("is the middle of a plain block's edge", () => {
      expect(sidePoint(A, "t")).toEqual(P(180, 100));
      expect(sidePoint(A, "r")).toEqual(P(260, 145));
      expect(sidePoint(A, "b")).toEqual(P(180, 190));
      expect(sidePoint(A, "l")).toEqual(P(100, 145));
    });

    it("is a diamond's vertex and an ellipse's extreme", () => {
      for (const kind of ["diamond", "ellipse"]) {
        const n = shape("s", 100, 100, kind, 180, 110);
        expect(sidePoint(n, "t")).toEqual(P(190, 100));
        expect(sidePoint(n, "r")).toEqual(P(280, 155));
        expect(sidePoint(n, "b")).toEqual(P(190, 210));
        expect(sidePoint(n, "l")).toEqual(P(100, 155));
      }
    });

    it("is the middle of a parallelogram's slanted sides, and the top and bottom centres", () => {
      const n = shape("s", 100, 100, "parallelogram", 200, 100);
      const k = PARALLELOGRAM_SKEW * 200;
      const r = sidePoint(n, "r"), l = sidePoint(n, "l");
      expect(r.x).toBeCloseTo(300 - k / 2, 9);
      expect(r.y).toBeCloseTo(150, 9);
      expect(l.x).toBeCloseTo(100 + k / 2, 9);
      expect(sidePoint(n, "t").x).toBeCloseTo(200, 9);
      expect(sidePoint(n, "t").y).toBeCloseTo(100, 9);
      expect(sidePoint(n, "b").y).toBeCloseTo(200, 9);
    });

    it("is the middle of a rounded box's and terminator's flat sides", () => {
      for (const kind of ["rounded", "terminator"]) {
        const n = shape("s", 100, 100, kind, 160, 64);
        expect(sidePoint(n, "t")).toEqual(P(180, 100));
        expect(sidePoint(n, "r")).toEqual(P(260, 132));
        expect(sidePoint(n, "b")).toEqual(P(180, 164));
        expect(sidePoint(n, "l")).toEqual(P(100, 132));
      }
    });
  });

  describe("straight", () => {
    // the rule the line has always followed, spelled out independently
    const legacy = (a, b) => {
      const p1 = anchorPoint(a, null, b.x + b.w / 2, b.y + b.h / 2);
      const p2 = anchorPoint(b, null, p1.x, p1.y);
      return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
    };

    it("is exactly the old centre-aimed line when nothing is pinned or styled", () => {
      const kinds = ["rect", "rounded", "ellipse", "diamond", "parallelogram", "terminator"];
      const offsets = [[400, 200], [-400, 200], [400, -200], [-400, -200], [0, 300], [300, 0], [-30, 250], [90, -260]];
      for (const k1 of kinds) for (const k2 of kinds) for (const [dx, dy] of offsets) {
        const a = shape("a", 100, 100, k1, 170, 100), b = shape("b", 100 + dx, 100 + dy, k2, 150, 80);
        state.boardsData.p.nodes = [a, b];
        const g = connGeometry(conn());
        expect(g.route).toBe("straight");
        expect({ x1: g.p1.x, y1: g.p1.y, x2: g.p2.x, y2: g.p2.y }, `${k1}>${k2} ${dx},${dy}`).toEqual(legacy(a, b));
        expect(connLine(conn())).toEqual(legacy(a, b));
      }
    });

    it("matches the numbers worked out by hand", () => {
      expect(connLine(conn())).toEqual({ x1: 260, y1: 185, x2: 500, y2: 305 });
    });

    it("puts a pinned start on that side's midpoint and aims the other end at it", () => {
      const g = connGeometry(conn({ fromSide: "b" }));
      expect(g.p1).toEqual(P(180, 190));
      expect(g.p2).toEqual(P(500, 314));
    });

    it("puts a pinned end on that side's midpoint and aims the start at it", () => {
      const g = connGeometry(conn({ toSide: "l" }));
      expect(g.p2).toEqual(P(500, 345));
      expect(g.p1).toEqual(P(252, 190));
    });

    it("joins two pinned sides exactly", () => {
      const g = connGeometry(conn({ fromSide: "r", toSide: "t" }));
      expect(g.p1).toEqual(P(260, 145));
      expect(g.p2).toEqual(P(580, 300));
    });

    it("labels the midpoint of the line", () => {
      expect(connGeometry(conn()).mid).toEqual(P(380, 245));
    });

    it("returns null when an end is missing", () => {
      expect(connGeometry(conn({ to: "gone" }))).toBeNull();
      expect(connLine(conn({ from: "gone" }))).toBeNull();
    });
  });

  describe("rows keep their own attach rule", () => {
    const list = { id: "l", type: "list", x: 100, y: 100, w: 200, h: 120, items: ["", ""] };
    beforeEach(() => {
      state.boardsData.p.nodes = [list, B];
      state.itemOffsets = { l: [30, 60] };
    });

    it("ignores a side set on a row end, for any route", () => {
      for (const route of [undefined, "elbow", "curve"]) {
        const plain = connGeometry({ ...conn({ from: "l", fromItem: 1, route }) });
        const pinned = connGeometry({ ...conn({ from: "l", fromItem: 1, route, fromSide: "t", toSide: "b" }) });
        expect(pinned.p1).toEqual(P(300, 160));
        expect(pinned.p1).toEqual(plain.p1);
        // toSide still applies: the far end is a whole block
        expect(pinned.p2).not.toEqual(plain.p2);
      }
    });

    it("ignores a side on both ends when both are rows", () => {
      const other = { id: "m", type: "list", x: 600, y: 100, w: 200, h: 120, items: [""] };
      state.boardsData.p.nodes = [list, other];
      state.itemOffsets = { l: [30, 60], m: [40] };
      const a = connGeometry({ id: "c", from: "l", to: "m", fromItem: 0, toItem: 0, label: "" });
      const b = connGeometry({ id: "c", from: "l", to: "m", fromItem: 0, toItem: 0, label: "", fromSide: "t", toSide: "t" });
      expect(b).toEqual(a);
    });

    it("an elbow leaves a row by the edge facing the other block", () => {
      const g = connGeometry(conn({ from: "l", fromItem: 1, route: "elbow" }));
      expect(g.p1).toEqual(P(300, 160));
      expect(g.d).toBe("M300 160 L392 160 Q400 160 400 168 L400 337 Q400 345 408 345 L500 345");
    });
  });

  describe("elbow", () => {
    it("meets the facing sides at their midpoints and runs a Z between them", () => {
      const g = connGeometry(conn({ route: "elbow" }));
      expect(g.route).toBe("elbow");
      expect(g.p1).toEqual(P(260, 145));
      expect(g.p2).toEqual(P(500, 345));
      expect(g.d).toBe("M260 145 L372 145 Q380 145 380 153 L380 337 Q380 345 388 345 L500 345");
      expect(g.mid).toEqual(P(380, 245));
    });

    it("leaves and enters perpendicular to a pinned side", () => {
      const g = connGeometry(conn({ route: "elbow", fromSide: "b", toSide: "t" }));
      expect(g.p1).toEqual(P(180, 190));
      expect(g.p2).toEqual(P(580, 300));
      expect(g.d).toBe("M180 190 L180 237 Q180 245 188 245 L572 245 Q580 245 580 253 L580 300");
    });

    it("runs out and back for two sides facing the same way", () => {
      const g = connGeometry(conn({ route: "elbow", fromSide: "r", toSide: "r" }));
      // out past the farther of the two points by the gap, then back in
      expect(g.d.startsWith("M260 145 L")).toBe(true);
      expect(g.d.endsWith("L660 345")).toBe(true);
      expect(g.d).toContain("688");
    });

    it("pins one end and chooses the facing side for the other", () => {
      const g = connGeometry(conn({ route: "elbow", fromSide: "t" }));
      expect(g.p1).toEqual(P(180, 100));
      expect(g.p2).toEqual(P(500, 345));
    });

    it("attaches at a diamond's vertex", () => {
      const dia = shape("a", 100, 100, "diamond", 180, 110);
      state.boardsData.p.nodes = [dia, B];
      const g = connGeometry(conn({ route: "elbow", fromSide: "b" }));
      expect(g.p1).toEqual(P(190, 210));
    });
  });

  describe("curve", () => {
    it("is a cubic Bezier between the same side midpoints", () => {
      const g = connGeometry(conn({ route: "curve" }));
      expect(g.route).toBe("curve");
      expect(g.p1).toEqual(P(260, 145));
      expect(g.p2).toEqual(P(500, 345));
      expect(g.d.startsWith("M260 145 C")).toBe(true);
      expect(g.d.endsWith(" 500 345")).toBe(true);
    });
  });

  it("edgePoint itself is untouched by pinning", () => {
    expect(edgePoint(A, 1, 0)).toEqual(sidePoint(A, "r"));
  });
});

describe("stored page files", () => {
  const plainConn = { id: "p1", from: "a", to: "b", fromItem: null, toItem: null, label: "" };
  const styledConn = {
    id: "s1", from: "a", to: "b", fromItem: 2, toItem: "g:steps:1", label: "yes",
    route: "curve", startArrow: true, endArrow: false, dash: "dotted", color: "#2f9e5f", width: 1.5,
    fromSide: "l", toSide: "t",
  };

  it("carry every style property through the page payload and back", () => {
    state.boards = [{ id: "p", name: "P" }];
    state.boardsData = { p: { nodes: [], connections: [plainConn, styledConn] } };
    const res = parseBoardText(boardPayload("p"));
    expect(res.ok).toBe(true);
    expect(res.data.connections).toEqual([plainConn, styledConn]);
  });

  it("leave a plain connection with no style keys in the file", () => {
    state.boards = [{ id: "p", name: "P" }];
    state.boardsData = { p: { nodes: [], connections: [plainConn] } };
    const stored = JSON.parse(boardPayload("p")).connections[0];
    expect(Object.keys(stored).sort()).toEqual(["from", "fromItem", "id", "label", "to", "toItem"]);
  });
});
