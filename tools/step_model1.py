import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from move_fns import move, SRC
from wire import wire

# ---- view ----------------------------------------------------------------
view = ["applyTransform", "centerView", "zoomAt", "clientToCanvas", "viewportCenterCanvasCoords"]
view_header = '''import { state } from "./state.js";
import { el, viewport, canvasInner } from "./dom.js";

/* The canvas viewport: pan offset and zoom, and the conversions between
   screen coordinates and canvas coordinates that everything else relies on. */

'''
move(view, os.path.join(SRC, "view.js"), view_header, export=view)
print("view.js:", wire(SRC, "view.js", view))

# ---- collapse ------------------------------------------------------------
collapse = ["outgoingCount", "descendantsOf", "hiddenNodeIds", "toggleCollapse"]
collapse_header = '''import { state } from "./state.js";
import { getData, findNode } from "./boards.js";
import { renderBoard } from "./app.js";
import { queueBoardSave } from "./storage.js";

/* Folding a block's subtree away.
   A block with outgoing arrows can be collapsed; everything reachable from it
   by following arrows outward is then hidden, along with any line touching
   those blocks, and the collapsed block reports how many are out of sight. */

'''
move(collapse, os.path.join(SRC, "collapse.js"), collapse_header, export=collapse)
print("collapse.js:", wire(SRC, "collapse.js", collapse))

# ---- selection -----------------------------------------------------------
sel = ["deselectAll", "applySelectionClasses", "selectNode", "setSelection", "onlySelected"]
sel_header = '''import { state } from "./state.js";
import { canvasInner } from "./dom.js";
import { findNode } from "./boards.js";
import { renderConnections, renderConnLabelsAndDelete } from "./app.js";

/* Which blocks are selected, and which connection line is selected.
   Selection is a set of block ids; the DOM classes are re-applied from it
   rather than tracked separately. */

'''
move(sel, os.path.join(SRC, "selection.js"), sel_header, export=sel)
print("selection.js:", wire(SRC, "selection.js", sel))
