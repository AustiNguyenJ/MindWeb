// @vitest-environment jsdom
// cloud.js pulls in dom.js, which reads document.getElementById at module
// scope -- these two functions never touch the DOM themselves, but a plain
// "node" environment (this project's default) has no `document` for the
// import to see.
import { describe, it, expect } from "vitest";
import { withBuiltinExtras, splitBuiltinExtras } from "../src/cloud.js";

/* Guards the cloud-backend fix: built-in node properties that have no
   dedicated Supabase column (ticketNo/link/assigned/customer/items/tickets/
   weekLabel/image) must round-trip through the same `fields` jsonb column
   custom block types already use, without disturbing a genuine custom field
   of the same node. */

describe("cloud built-in field extras", () => {
  it("packs every present built-in-only property into fields.__builtin", () => {
    const node = { id: "n1", type: "ticket", title: "T-1", bodyHtml: "<p>note</p>",
      ticketNo: "TK-42", link: "https://example.com", assigned: "Ada", customer: "Acme" };
    const packed = withBuiltinExtras({}, node);
    expect(packed.__builtin).toEqual({
      ticketNo: "TK-42", link: "https://example.com", assigned: "Ada", customer: "Acme",
    });
  });

  it("leaves fields untouched when the node has no such properties", () => {
    const node = { id: "n2", type: "note", title: "Plain note" };
    const packed = withBuiltinExtras({ someCustomKey: "value" }, node);
    expect(packed).toEqual({ someCustomKey: "value" });
    expect(packed.__builtin).toBeUndefined();
  });

  it("does not collide with a real Designer-defined custom field also named e.g. 'items'", () => {
    const node = { id: "n3", type: "list", items: ["a", "b"] };
    const packed = withBuiltinExtras({ items: "a user's own custom field value" }, node);
    // the user's genuine custom field survives at the top level of `fields`
    expect(packed.items).toBe("a user's own custom field value");
    // the built-in list rows are namespaced separately, not overwriting it
    expect(packed.__builtin.items).toEqual(["a", "b"]);
  });

  it("round-trips: split recovers the same extras and restores plain fields", () => {
    const node = { id: "n4", type: "week", weekLabel: "Mon 1 - Sun 7", tickets: [{ no: "1" }] };
    const packed = withBuiltinExtras({ myCustomField: "kept" }, node);
    const { fields, extras } = splitBuiltinExtras(packed);
    expect(fields).toEqual({ myCustomField: "kept" });
    expect(extras).toEqual({ weekLabel: "Mon 1 - Sun 7", tickets: [{ no: "1" }] });
  });

  it("splitBuiltinExtras is a no-op on fields with no __builtin key", () => {
    const { fields, extras } = splitBuiltinExtras({ a: 1 });
    expect(fields).toEqual({ a: 1 });
    expect(extras).toEqual({});
  });

  it("splitBuiltinExtras tolerates a missing/null fields value", () => {
    const { fields, extras } = splitBuiltinExtras(undefined);
    expect(fields).toEqual({});
    expect(extras).toEqual({});
  });

  it("covers image data the same way as the other built-ins", () => {
    const node = { id: "n5", type: "image", image: "data:image/jpeg;base64,AAAA" };
    const packed = withBuiltinExtras({}, node);
    const { extras } = splitBuiltinExtras(packed);
    expect(extras.image).toBe("data:image/jpeg;base64,AAAA");
  });
});
