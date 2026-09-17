import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from extract import APP

NL = chr(10)

lines = open(APP, encoding="utf-8", newline="").read().split(NL)


def grab(a, b):
    """1-indexed inclusive line range -> text, and blank it out of `lines`."""
    out = lines[a - 1:b]
    for i in range(a - 1, b):
        lines[i] = None
    return NL.join(out)


# sanity-check every boundary before touching anything
assert lines[45].startswith("function looksRich("), lines[45]
assert lines[155].startswith("function uid("), lines[155]
assert lines[243].startswith("function escapeAttr("), lines[243]
assert lines[295].startswith("/* True when focus is anywhere"), lines[295]
assert lines[307] == "}", repr(lines[307])

is_text_entry = grab(296, 308)
core = grab(156, 244)
looks_rich = grab(46, 46)

body = NL.join([core, "", looks_rich, "", is_text_entry]) + NL

# export each top-level function
body = body.replace(NL + "function ", NL + "export function ")
if body.startswith("function "):
    body = "export " + body

header = '''import { RICH_OK_TAGS, RICH_DROP_TAGS } from "./constants.js";

/* Small, dependency-free helpers: ids, HTML escaping and sanitising, rich-text
   coercion, URL handling, and a couple of DOM predicates. Nothing here reads
   application state. */

'''

open(os.path.join(os.path.dirname(APP), "util.js"), "w", encoding="utf-8", newline="").write(header + body)

rest = NL.join(l for l in lines if l is not None)
# collapse the 3+ blank runs the cuts leave behind
while NL * 4 in rest:
    rest = rest.replace(NL * 4, NL * 3)

imp = 'import {' + NL + \
      '  uid, escapeHtml, escapeAttr, sanitizeHtml, plainToHtml, richToText, richValue,' + NL + \
      '  normalizeUrl, openLinkBackground, currentWeekLabel, isTextEntry, looksRich,' + NL + \
      '} from "./util.js";' + NL
anchor = 'from "./constants.js";' + NL
assert anchor in rest
rest = rest.replace(anchor, anchor + imp, 1)

open(APP, "w", encoding="utf-8", newline="").write(rest)
print("util.js written")
