import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from extract import cut, write_module, APP

BS = chr(92)
NL = chr(10)

blocks = []

blocks.append(('''const IDX_KEY = "mindmap:index";
const COLORS = ["#ffffff","#fde68a","#bfdbfe","#bbf7d0","#fecaca","#e9d5ff"];
const DEFAULT_SIZE = { header:[220,50], note:[220,140], list:[230,150], question:[220,140],
                       image:[240,190], ticket:[262,190], week:[330,260] };
const HOTKEYS = { h:"header", n:"note", l:"list", q:"question", g:"image", t:"ticket", w:"week" };
''', ""))

keep_types_comment = '''/* Custom block types the user defines in the Block Designer. Each is a
   schema: a list of fields, plus a default width. Stored per-file so a
   board carries its own block library. Persisted under mindmap:types. */
'''
blocks.append((keep_types_comment + 'const TYPES_KEY = "mindmap:types";' + NL, keep_types_comment))

blocks.append(('const FIELD_KINDS = ["text","richtext","link","number","date","select","checkbox","group"];' + NL, ""))

blocks.append(('const RICH_OK_TAGS = ["B","STRONG","I","EM","U","A","UL","OL","LI","BR","DIV","P","SPAN","CODE"];' + NL +
               'const RICH_DROP_TAGS = ["SCRIPT","STYLE","IFRAME","OBJECT","EMBED","NOSCRIPT","TEMPLATE","SVG","MATH"];' + NL, ""))

blocks.append(('const COPY_ICON = "' + BS + 'u29C9";' + NL, ""))

blocks.append(('''/* window.storage caps each key near 5MB. A board with many images can exceed
   that; the write then fails and the old value stays, which shows as blank or
   stale containers. Warn loudly so the user can move to folder storage. */
const APP_KEY_LIMIT = 5 * 1024 * 1024;
''', ""))

keep_builtin_keys_comment = '''/* Built-in editable types keep their data in top-level node props; custom
   fields live in node.fields. These accessors hide that difference so one
   render engine serves both. */
'''
blocks.append((keep_builtin_keys_comment + 'const BUILTIN_KEYS = { bodyHtml:1, ticketNo:1, link:1, assigned:1, customer:1 };' + NL,
               keep_builtin_keys_comment))

blocks.append(('const HISTORY_LIMIT = 60;' + NL, ""))
blocks.append(('const TYPE_ACCENTS = ["#ffffff","#fde68a","#bfdbfe","#bbf7d0","#fecaca","#e9d5ff","#fed7aa","#c7d2fe"];' + NL, ""))
blocks.append(("// subfields can't themselves be groups (no nesting)" + NL +
               'const SUBFIELD_KINDS = ["text","richtext","link","number","date","checkbox"];' + NL, ""))

# the two built-in type tables plus the comment that explains them
src = open(APP, encoding="utf-8", newline="").read()
start = src.index("/* Built-in types that CAN be edited in the designer")
end = src.index("function seedBuiltinTypes(){")
blocks.append((src[start:end], ""))

body = cut(blocks)

# export every top-level declaration in the moved text
body = body.replace(NL + "const ", NL + "export const ")
if body.startswith("const "):
    body = "export " + body

header = '''/* Values that never change at runtime: keys, palettes, size defaults,
   hotkeys, the field-kind vocabulary, and the built-in block schemas.
   No imports, no state -- everything else may depend on this file. */

'''
write_module(os.path.join(os.path.dirname(APP), "constants.js"), header, body)
print("constants.js written,", len(body), "bytes")
