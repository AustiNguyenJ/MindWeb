"""Extract dom.js (element lookup + cached refs), toast.js and clipboard.js."""
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from extract import APP

NL = chr(10)
SRC = os.path.dirname(APP)

lines = open(APP, encoding="utf-8", newline="").read().split(NL)


def grab(a, b, expect_first=None, expect_last=None):
    if expect_first is not None:
        assert lines[a - 1].startswith(expect_first), (a, lines[a - 1])
    if expect_last is not None:
        assert lines[b - 1].startswith(expect_last), (b, lines[b - 1])
    out = lines[a - 1:b]
    for i in range(a - 1, b):
        lines[i] = None
    return NL.join(out)


clipboard_body = grab(157, 188, "function fallbackCopy(", "}")
toast_body = grab(150, 155, "function showToast(", "}")
toast_timer = grab(138, 138, "let toastTimer")
dom_body = grab(141, 146, "const el = ", "const imgFileInput")

# --- dom.js ---------------------------------------------------------------
dom_header = '''/* Element lookup, plus the handful of nodes the app holds on to.
 *
 * These are resolved at module load, which is safe because the entry is a
 * module script and therefore deferred until the document has been parsed.
 */

'''
dom_out = dom_body.replace(NL + "const ", NL + "export const ")
if dom_out.startswith("const "):
    dom_out = "export " + dom_out
open(os.path.join(SRC, "dom.js"), "w", encoding="utf-8", newline="").write(dom_header + dom_out + NL)

# --- toast.js -------------------------------------------------------------
toast_header = '''import { toastEl } from "./dom.js";

/* The transient status line in the bottom-right corner. */

'''
open(os.path.join(SRC, "toast.js"), "w", encoding="utf-8", newline="").write(
    toast_header + toast_timer + NL + NL + "export " + toast_body + NL)

# --- clipboard.js ---------------------------------------------------------
clip_header = '''import { COPY_ICON } from "./constants.js";
import { showToast } from "./toast.js";

/* Copying to the clipboard, with a fallback for contexts where the async
   Clipboard API is unavailable or blocked, and the little copy button markup
   that goes with it. */

'''
clip_out = clipboard_body.replace(NL + "function ", NL + "export function ")
if clip_out.startswith("function "):
    clip_out = "export " + clip_out
open(os.path.join(SRC, "clipboard.js"), "w", encoding="utf-8", newline="").write(clip_header + clip_out + NL)

# --- rewrite app.js -------------------------------------------------------
rest = NL.join(l for l in lines if l is not None)
while NL * 4 in rest:
    rest = rest.replace(NL * 4, NL * 3)

imp = (
    'import { el, viewport, canvasInner, connSvg, toastEl, imgFileInput } from "./dom.js";' + NL +
    'import { showToast } from "./toast.js";' + NL +
    'import { copyText, copyBtnHtml } from "./clipboard.js";' + NL
)
anchor = 'import { state } from "./state.js";' + NL
assert anchor in rest
rest = rest.replace(anchor, anchor + imp, 1)
open(APP, "w", encoding="utf-8", newline="").write(rest)
print("dom.js, toast.js, clipboard.js written")
