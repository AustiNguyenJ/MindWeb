import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from move_fns import move, SRC
from wire import wire

# ---- connections ---------------------------------------------------------
conn = ["edgePoint", "anchorPoint", "connLine", "createConnection", "deleteConnection",
        "updateConnectionsTouching", "renderConnections", "renderConnLabelsAndDelete"]
conn_header = '''import { state } from "./state.js";
import { canvasInner, connSvg } from "./dom.js";
import { uid } from "./util.js";
import { getData, findNode } from "./boards.js";
import { hiddenNodeIds } from "./collapse.js";
import { renderBoard } from "./app.js";
import { queueBoardSave } from "./storage.js";

/* The arrows between blocks.
 *
 * A connection may start or end at a whole block, or at one row inside it.
 * Row endpoints are identified by index for list and week rows, and by the
 * string key "g:<fieldKey>:<rowIdx>" for repeating-group rows, so the two
 * kinds can never collide. Whole-block endpoints record fromItem/toItem as
 * an explicit null rather than leaving the property off.
 *
 * Each line is drawn twice: a thin visible one, and a fat transparent one
 * underneath that is the actual click target.
 */

'''
move(conn, os.path.join(SRC, "connections.js"), conn_header, export=conn)
print("connections.js:", wire(SRC, "connections.js", conn))

# ---- nodes ---------------------------------------------------------------
nodes = ["blankTicket", "ticketSummary", "migrateNode", "createNode", "focusNodeTitle",
         "spawnAtCursor", "processImageFile", "deleteNode", "deleteSelectedNodes", "duplicateNode"]
nodes_header = '''import { state } from "./state.js";
import { DEFAULT_SIZE } from "./constants.js";
import { uid, currentWeekLabel, plainToHtml } from "./util.js";
import { canvasInner, imgFileInput } from "./dom.js";
import { getData } from "./boards.js";
import { isCustomType } from "./blockTypes.js";
import { viewportCenterCanvasCoords } from "./view.js";
import { renderBoard } from "./app.js";
import { queueBoardSave } from "./storage.js";

/* Creating, copying and deleting blocks, and the per-type shape of a new one.
   migrateNode brings a stored block up to the current shape on load, which is
   what lets old saved pages keep working as block types gain fields. */

'''
move(nodes, os.path.join(SRC, "nodes.js"), nodes_header, export=nodes)
print("nodes.js:", wire(SRC, "nodes.js", nodes))

# ---- rows ----------------------------------------------------------------
rows = ["itemHasConnection", "groupKey", "groupRowHasConnection", "shiftGroupConnections",
        "addGroupRow", "removeGroupRow", "addListItem", "addTicketRow", "removeTicketRow",
        "removeListItem"]
rows_header = '''import { canvasInner } from "./dom.js";
import { getData } from "./boards.js";
import { state } from "./state.js";
import { blankGroupRow } from "./blockTypes.js";
import { blankTicket } from "./nodes.js";
import { renderBoard } from "./app.js";
import { queueBoardSave } from "./storage.js";

/* The repeating rows inside a block: list lines, a week's tickets, and the
   rows of a custom type's repeating-group field.
 *
 * Inserting or removing a row has to shift every connection that points at a
 * later row, or links silently start pointing at the wrong one. Numeric rows
 * shift by index; group rows shift by rewriting their "g:field:idx" keys. */

'''
move(rows, os.path.join(SRC, "rows.js"), rows_header, export=rows)
print("rows.js:", wire(SRC, "rows.js", rows))
