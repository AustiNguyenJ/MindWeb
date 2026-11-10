/* Values that never change at runtime: keys, palettes, size defaults,
   hotkeys, the field-kind vocabulary, and the built-in block schemas.
   No imports, no state -- everything else may depend on this file. */

export const IDX_KEY = "mindmap:index";
export const COLORS = ["#ffffff","#fde68a","#bfdbfe","#bbf7d0","#fecaca","#e9d5ff"];
export const DEFAULT_SIZE = { header:[220,50], note:[220,140], list:[230,150], question:[220,140],
                       image:[240,190], ticket:[262,190], week:[330,260], label:[180,36] };
/* Flowchart shapes. All six are one structural block type, "shape", told apart
   by node.shape; the quick bar, hotkeys and connection-drop picker address
   them by the pseudo-type ids in SHAPE_SPAWN, which createNode() translates
   (see nodes.js). The shape's text lives in node.title, so search, export and
   the cloud title column carry it with no extra plumbing. */
export const SHAPE_KINDS = ["rect","rounded","ellipse","diamond","parallelogram","terminator"];
export const SHAPE_SPAWN = {
  shape_rect:"rect", shape_rounded:"rounded", shape_ellipse:"ellipse",
  shape_diamond:"diamond", shape_parallelogram:"parallelogram", shape_terminator:"terminator",
};
export const SHAPE_SIZE = { rect:[160,90], rounded:[160,90], ellipse:[170,100],
                            diamond:[180,110], parallelogram:[190,90], terminator:[160,64] };
/* Geometry shared by how a shape is drawn (nodeElement.js / styles.css) and
   where a connection meets it (connections.js edgePoint). Change one and the
   other drifts: the arrow would stop short of, or poke into, the outline. */
export const PARALLELOGRAM_SKEW = 0.2;   // top/bottom edge offset, as a fraction of width
export const ROUNDED_RADIUS = 14;        // px
/* Connector styling (connStyle.js). Every property is optional on a stored
   connection and absent means the default below, so a connection saved before
   these existed renders exactly as it always did. */
export const CONN_ROUTES = ["straight","elbow","curve"];
export const CONN_DASHES = ["solid","dashed","dotted"];
export const CONN_SIDES = ["t","r","b","l"];
export const CONN_COLOR_DEFAULT = "#9aa1ab";
export const CONN_WIDTH_DEFAULT = 2;
export const CONN_WIDTHS = { thin:1.5, normal:CONN_WIDTH_DEFAULT, thick:3.5 };
/* Line colours are mid-tones that read on both the light and the dark canvas,
   unlike COLORS, whose pastels are fill colours and vanish as a 2px line.
   CONN_COLOR_DARK_MAP lifts the darker ones for dark mode, the same job
   COLOR_DARK_MAP does for block fills (themedConnColor in util.js). */
export const CONN_COLORS = [CONN_COLOR_DEFAULT, "#374151", "#4757d1", "#d64545", "#2f9e5f", "#d98a00", "#8b5cf6"];
export const CONN_COLOR_DARK_MAP = {
  "#374151": "#d1d5db",
  "#4757d1": "#7c89e8",
  "#d64545": "#f07178",
  "#2f9e5f": "#4ec58a",
  "#d98a00": "#f0b429",
  "#8b5cf6": "#b794f6",
};
export const CONN_ELBOW_GAP = 28;       // px a same-side elbow runs out before turning back
export const CONN_ELBOW_RADIUS = 8;     // px, rounded elbow corners
export const HOTKEYS = { h:"header", n:"note", l:"list", q:"question", g:"image", t:"ticket", w:"week" };
/* Quick-access toolbar + hotkeys, user-configurable via the Toolbar settings
   modal. Global by default; a board may opt into its own copy (see
   toolbarConfig.js). BUILTIN_TOOLBAR_META supplies the swatch colour and
   label for each built-in that can appear on the bar -- everything else
   (custom ct_* types) gets its accent/name from state.customTypes instead. */
export const TOOLBAR_KEY = "mindmap:toolbar";
export const BUILTIN_TOOLBAR_META = {
  header:   { label:"Header",   accent:"#4757d1", section:"blocks" },
  note:     { label:"Note",     accent:"#e5e7eb", section:"blocks" },
  list:     { label:"List",     accent:"#fde68a", section:"blocks" },
  question: { label:"Question", accent:"#e9d5ff", section:"blocks" },
  ticket:   { label:"Ticket",   accent:"#bbf7d0", section:"blocks" },
  week:     { label:"Week",     accent:"#fecaca", section:"blocks" },
  image:    { label:"Image",    accent:"#bfdbfe", section:"blocks" },
  shape_rect:          { label:"Rectangle",     accent:"#bfdbfe", section:"shapes" },
  shape_rounded:       { label:"Rounded box",   accent:"#bbf7d0", section:"shapes" },
  shape_ellipse:       { label:"Ellipse",       accent:"#fde68a", section:"shapes" },
  shape_diamond:       { label:"Diamond",       accent:"#fecaca", section:"shapes" },
  shape_parallelogram: { label:"Parallelogram", accent:"#e9d5ff", section:"shapes" },
  shape_terminator:    { label:"Terminator",    accent:"#fed7aa", section:"shapes" },
  label:               { label:"Text label",    accent:"#9aa1ab", section:"shapes" },
};
/* The quick bar's collapsible groups. Custom block types always sit in
   "blocks". Which groups are folded is a per-viewer UI preference kept in
   localStorage (toolbar.js), not part of the shared toolbar config. */
export const TOOLBAR_SECTIONS = [
  { id:"blocks", label:"Blocks" },
  { id:"shapes", label:"Shapes" },
];
export const TOOLBAR_SECTIONS_KEY = "mindmap-toolbar-sections";
/* image can't be spawned mid-connection-drag (it needs an async file picker,
   and there's no synchronous node to attach the in-progress connection to). */
export const NO_CONNECT_SPAWN = { image:1 };
/* Custom block types the user defines in the Block Designer. Each is a
   schema: a list of fields, plus a default width. Stored per-file so a
   board carries its own block library. Persisted under mindmap:types. */
export const TYPES_KEY = "mindmap:types";
export const FIELD_KINDS = ["text","richtext","link","number","date","select","checkbox","group"];
export const RICH_OK_TAGS = ["B","STRONG","I","EM","U","S","STRIKE","A","UL","OL","LI","BR","DIV","P","SPAN","CODE"];
export const RICH_DROP_TAGS = ["SCRIPT","STYLE","IFRAME","OBJECT","EMBED","NOSCRIPT","TEMPLATE","SVG","MATH"];
/* The inline style properties a rich-text SPAN is allowed to carry, and the
   value shape each accepts -- everything else is stripped on sanitize. This
   is what lets font size survive a save/reload without opening a path for
   arbitrary CSS (e.g. position/url()) to come along. */
export const RICH_STYLE_PROPS = {
  "font-size": /^\d{1,3}px$/,
};
/* Font-size steps for the rich-text toolbar's grow/shrink buttons and the
   matching Ctrl/Cmd+Shift+] / [ shortcut. null means "no override" -- the
   block's own default size -- so a fresh document never carries a font-size
   style until the user actually changes it. */
export const FONT_SIZES = [11, 13, 16, 20, 28];
export const COPY_ICON = "\u29C9";
/* window.storage caps each key near 5MB. A board with many images can exceed
   that; the write then fails and the old value stays, which shows as blank or
   stale containers. Warn loudly so the user can move to folder storage. */
export const APP_KEY_LIMIT = 5 * 1024 * 1024;
export const BUILTIN_KEYS = { bodyHtml:1, ticketNo:1, link:1, assigned:1, customer:1 };
export const HISTORY_LIMIT = 60;
export const TYPE_ACCENTS = ["#ffffff","#fde68a","#bfdbfe","#bbf7d0","#fecaca","#e9d5ff","#fed7aa","#c7d2fe"];
/* Node fill colours are stored as light pastel hex values chosen from COLORS /
   TYPE_ACCENTS above -- picked once and kept in board data, not tied to the
   theme. In dark mode they're swapped for these deeper counterparts so node
   text (which follows --ink) stays readable; see themedNodeColor() in
   util.js, the single place that applies this map. */
export const COLOR_DARK_MAP = {
  "#ffffff": "var(--surface)",
  "#fde68a": "#4a3f1a",
  "#bfdbfe": "#1f3a56",
  "#bbf7d0": "#1c3a2a",
  "#fecaca": "#4a2020",
  "#e9d5ff": "#3a2a52",
  "#fed7aa": "#4a341c",
  "#c7d2fe": "#262c52",
};
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

