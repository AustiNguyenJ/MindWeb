/* Values that never change at runtime: keys, palettes, size defaults,
   hotkeys, the field-kind vocabulary, and the built-in block schemas.
   No imports, no state -- everything else may depend on this file. */

export const IDX_KEY = "mindmap:index";
export const COLORS = ["#ffffff","#fde68a","#bfdbfe","#bbf7d0","#fecaca","#e9d5ff"];
export const DEFAULT_SIZE = { header:[220,50], note:[220,140], list:[230,150], question:[220,140],
                       image:[240,190], ticket:[262,190], week:[330,260] };
export const HOTKEYS = { h:"header", n:"note", l:"list", q:"question", g:"image", t:"ticket", w:"week" };
/* Custom block types the user defines in the Block Designer. Each is a
   schema: a list of fields, plus a default width. Stored per-file so a
   board carries its own block library. Persisted under mindmap:types. */
export const TYPES_KEY = "mindmap:types";
export const FIELD_KINDS = ["text","richtext","link","number","date","select","checkbox","group"];
export const RICH_OK_TAGS = ["B","STRONG","I","EM","U","A","UL","OL","LI","BR","DIV","P","SPAN","CODE"];
export const RICH_DROP_TAGS = ["SCRIPT","STYLE","IFRAME","OBJECT","EMBED","NOSCRIPT","TEMPLATE","SVG","MATH"];
export const COPY_ICON = "\u29C9";
/* window.storage caps each key near 5MB. A board with many images can exceed
   that; the write then fails and the old value stays, which shows as blank or
   stale containers. Warn loudly so the user can move to folder storage. */
export const APP_KEY_LIMIT = 5 * 1024 * 1024;
export const BUILTIN_KEYS = { bodyHtml:1, ticketNo:1, link:1, assigned:1, customer:1 };
export const HISTORY_LIMIT = 60;
export const TYPE_ACCENTS = ["#ffffff","#fde68a","#bfdbfe","#bbf7d0","#fecaca","#e9d5ff","#fed7aa","#c7d2fe"];
// subfields can't themselves be groups (no nesting)
export const SUBFIELD_KINDS = ["text","richtext","link","number","date","checkbox"];
/* Built-in types that CAN be edited in the designer are expressed as the same
   schema format and seeded into customTypes on first run. Their ids match the
   original type names so existing nodes keep working. The repeating-row types
   (list, week) and the structural ones (header, image) stay hardcoded and are
   shown in the designer as read-only. */
export const EDITABLE_BUILTINS = {
  note: { id:"note", name:"Note", accent:"#ffffff", width:220, builtin:true,
    fields:[ {key:"bodyHtml", label:"Notes", kind:"richtext", placeholder:"Notes...", options:""} ] },
  question: { id:"question", name:"Question", accent:"#ffffff", width:220, builtin:true,
    fields:[ {key:"bodyHtml", label:"Question", kind:"richtext", placeholder:"What are we not sure about?", options:""} ] },
  ticket: { id:"ticket", name:"Ticket", accent:"#ffffff", width:262, builtin:true,
    fields:[
      {key:"ticketNo", label:"No.", kind:"text", placeholder:"INC-0000", options:""},
      {key:"link", label:"Link", kind:"link", placeholder:"Paste URL", options:""},
      {key:"assigned", label:"Assigned", kind:"text", placeholder:"Assigned to", options:""},
      {key:"customer", label:"Customer", kind:"text", placeholder:"Customer", options:""},
      {key:"bodyHtml", label:"Notes", kind:"richtext", placeholder:"Notes...", options:""}
    ] }
};
export const PROTECTED_BUILTINS = {
  list: { name:"List", accent:"#ffffff", note:"Repeating lines, each with its own branch point." },
  week: { name:"Week", accent:"#ffffff", note:"Repeating ticket rows plus a shared notes area." },
  header: { name:"Header", accent:"#4757d1", note:"A plain title divider." },
  image: { name:"Image", accent:"#bfdbfe", note:"A single pasted or uploaded image." }
};

