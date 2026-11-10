// @vitest-environment jsdom
// cloud.js pulls in dom.js, which reads document.getElementById at module
// scope; the functions under test never touch the DOM themselves.
import { describe, it, expect } from "vitest";
import { state } from "../src/state.js";
import { packConnLabel, unpackConnLabel, connToRow, connFromRow, cloudPersistBoard } from "../src/cloud.js";

/* The connections table has fixed columns (id, board_id, from_node, from_item,
   to_node, to_item, label) and cannot be migrated from here, so a connection's
   style rides inside the label column as a marked JSON envelope. These tests
   pin both directions of that encoding, and that a row written before it
   existed still loads as a plain, default-styled connection. */

const ROW_COLUMNS = ["board_id", "from_item", "from_node", "id", "label", "to_item", "to_node"];
const plain = { id: "c1", from: "a", to: "b", fromItem: null, toItem: null, label: "" };
const styled = {
  ...plain, label: "yes",
  route: "elbow", startArrow: true, endArrow: false, dash: "dashed", color: "#d64545", width: 3.5,
  fromSide: "b", toSide: "l",
};
const STYLE = {
  route: "elbow", startArrow: true, endArrow: false, dash: "dashed", color: "#d64545", width: 3.5,
  fromSide: "b", toSide: "l",
};
// whatever precedes the JSON in an envelope is its marker
const MARK = packConnLabel(styled).slice(0, packConnLabel(styled).indexOf("{"));

describe("cloud connection label encoding", () => {
  it("stores a default-styled connection's label as plain text, exactly as before", () => {
    expect(packConnLabel({ ...plain, label: "yes" })).toBe("yes");
  });

  it("stores no label as null, as before", () => {
    expect(packConnLabel(plain)).toBeNull();
    expect(packConnLabel({ ...plain, label: undefined })).toBeNull();
  });

  it("wraps a styled connection's label and style in a marked envelope", () => {
    const raw = packConnLabel(styled);
    expect(typeof raw).toBe("string");
    expect(raw).not.toBe("yes");
    const json = raw.slice(raw.indexOf("{"));
    expect(JSON.parse(json)).toEqual({ label: "yes", ...STYLE });
  });

  it("round-trips every style property and the label", () => {
    expect(unpackConnLabel(packConnLabel(styled))).toEqual({ label: "yes", ...STYLE });
  });

  it("round-trips a styled connection that has no label", () => {
    const c = { ...plain, route: "curve" };
    expect(unpackConnLabel(packConnLabel(c))).toEqual({ label: "", route: "curve" });
  });

  it("writes only the properties that differ from the default", () => {
    const raw = packConnLabel({ ...plain, label: "x", dash: "dotted", route: "straight", width: 2, endArrow: true });
    expect(JSON.parse(raw.slice(raw.indexOf("{")))).toEqual({ label: "x", dash: "dotted" });
  });

  it("reads an old row (plain text label) as that label with default styling", () => {
    expect(unpackConnLabel("yes")).toEqual({ label: "yes" });
    expect(unpackConnLabel("")).toEqual({ label: "" });
  });

  it("reads a null label column as an empty label", () => {
    expect(unpackConnLabel(null)).toEqual({ label: "" });
    expect(unpackConnLabel(undefined)).toEqual({ label: "" });
  });

  it("does not mistake an ordinary JSON-looking label for an envelope", () => {
    expect(unpackConnLabel('{"label":"x","route":"elbow"}')).toEqual({ label: '{"label":"x","route":"elbow"}' });
  });

  it("round-trips a label that itself begins with the marker", () => {
    const sneaky = MARK + "typed by someone";
    const raw = packConnLabel({ ...plain, label: sneaky });
    expect(raw).not.toBe(sneaky);
    expect(unpackConnLabel(raw)).toEqual({ label: sneaky });
  });

  it("keeps the text of a damaged envelope rather than losing it", () => {
    const good = packConnLabel(styled);
    const damaged = good.slice(0, good.length - 5);
    expect(unpackConnLabel(damaged)).toEqual({ label: damaged });
    const notAnObject = good.slice(0, good.indexOf("{")) + "5";
    expect(unpackConnLabel(notAnObject)).toEqual({ label: notAnObject });
  });

  it("sanitises what it reads, so a hand-edited row cannot inject a bad value", () => {
    const raw = MARK + JSON.stringify({ label: "x", route: "zigzag", color: "url(#evil)", width: 999, dash: "dashed", fromSide: "up" });
    expect(unpackConnLabel(raw)).toEqual({ label: "x", dash: "dashed" });
  });

  it("tolerates an envelope whose label is missing or the wrong type", () => {
    expect(unpackConnLabel(MARK + JSON.stringify({ route: "elbow" }))).toEqual({ label: "", route: "elbow" });
    expect(unpackConnLabel(MARK + JSON.stringify({ label: 5, route: "elbow" }))).toEqual({ label: "", route: "elbow" });
  });
});

describe("cloud connection rows", () => {
  it("writes only the existing columns", () => {
    expect(Object.keys(connToRow(styled, "brd")).sort()).toEqual(ROW_COLUMNS);
    expect(Object.keys(connToRow(plain, "brd")).sort()).toEqual(ROW_COLUMNS);
  });

  it("writes a default-styled connection as the same row it always was", () => {
    expect(connToRow({ ...plain, label: "yes" }, "brd")).toEqual({
      id: "c1", board_id: "brd", from_node: "a", from_item: null, to_node: "b", to_item: null, label: "yes",
    });
    expect(connToRow(plain, "brd").label).toBeNull();
  });

  it("loads an old row with default styling and exactly the keys it always had", () => {
    const c = connFromRow({ id: "c1", board_id: "brd", from_node: "a", from_item: "g:k:2", to_node: "b", to_item: null, label: "yes" });
    expect(c).toEqual({ id: "c1", from: "a", fromItem: "g:k:2", to: "b", toItem: null, label: "yes" });
    expect(Object.keys(c).sort()).toEqual(["from", "fromItem", "id", "label", "to", "toItem"]);
  });

  it("loads a null label as an empty one", () => {
    expect(connFromRow({ id: "c1", from_node: "a", to_node: "b", from_item: null, to_item: null, label: null }).label).toBe("");
  });

  it("round-trips a styled connection through a row", () => {
    const row = connToRow(styled, "brd");
    const back = connFromRow(row);
    expect(back).toEqual({ id: "c1", from: "a", fromItem: null, to: "b", toItem: null, label: "yes", ...STYLE });
  });

  it("round-trips through a JSON serialisation too, as the network would", () => {
    const back = connFromRow(JSON.parse(JSON.stringify(connToRow(styled, "brd"))));
    expect(back).toMatchObject(STYLE);
    expect(back.label).toBe("yes");
  });
});

describe("cloudPersistBoard", () => {
  it("sends the encoded label in the connections upsert", async () => {
    const upserts = [];
    const builder = (table) => {
      const b = {
        select: () => b, eq: () => b, in: () => b, delete: () => b,
        upsert: (rows) => { upserts.push({ table, rows }); return Promise.resolve({ error: null }); },
        then: (resolve) => resolve({ data: [] }),
      };
      return b;
    };
    state.supabaseClient = { from: builder };
    state.supabaseSession = null;
    state.boardsData = { brd: { nodes: [], connections: [styled, { ...plain, id: "c2", label: "no" }] } };
    try {
      await cloudPersistBoard("brd");
    } finally {
      state.supabaseClient = null;
    }
    const conns = upserts.find((u) => u.table === "connections");
    expect(conns.rows).toHaveLength(2);
    expect(unpackConnLabel(conns.rows[0].label)).toEqual({ label: "yes", ...STYLE });
    expect(conns.rows[1].label).toBe("no");
    conns.rows.forEach((r) => expect(Object.keys(r).sort()).toEqual(ROW_COLUMNS));
  });
});
