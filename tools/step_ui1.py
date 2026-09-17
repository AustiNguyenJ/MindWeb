import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from move_fns import move, SRC
from wire import wire

# ---- custom field rendering ---------------------------------------------
cf = ["subfieldInputHtml", "groupFieldHtml", "customBodyHtml", "groupSummary",
      "customSummary", "wireCustomFields"]
cf_header = '''import { state } from "./state.js";
import { COPY_ICON } from "./constants.js";
import { escapeHtml, escapeAttr, richValue, richToText, sanitizeHtml, openLinkBackground } from "./util.js";
import { copyText, copyBtnHtml } from "./clipboard.js";
import { fieldVal, setFieldVal } from "./blockTypes.js";
import { groupKey, groupRowHasConnection, addGroupRow, removeGroupRow } from "./rows.js";
import { selectNode } from "./selection.js";
import { updateConnectionsTouching } from "./connections.js";
import { queueBoardSave } from "./storage.js";
import { measureListOffsets, startConnectDrag } from "./app.js";

/* Rendering and wiring for schema-driven blocks.
 *
 * One renderer serves every type defined by a schema -- the editable
 * built-ins (note, question, ticket) and every user-defined ct_* type -- so
 * a field kind only has to be implemented once. Values are read and written
 * through fieldVal / setFieldVal, because built-in types keep theirs in
 * top-level node properties rather than in node.fields.
 */

'''
move(cf, os.path.join(SRC, "customFields.js"), cf_header, export=cf)
print("customFields.js:", wire(SRC, "customFields.js", cf))

# ---- board rendering -----------------------------------------------------
rend = ["measureListOffsets", "fitCanvasBounds", "renderBoard"]
rend_header = '''import { state } from "./state.js";
import { canvasInner, connSvg } from "./dom.js";
import { getData } from "./boards.js";
import { isCustomType } from "./blockTypes.js";
import { hiddenNodeIds } from "./collapse.js";
import { renderConnections } from "./connections.js";
import { nodeElement } from "./app.js";

/* Drawing the page.
 *
 * renderBoard rebuilds every block from scratch rather than diffing, which
 * keeps the code simple at the cost of losing focus on re-render -- worth
 * knowing, because a couple of behaviours depend on it.
 *
 * measureListOffsets reads back the heights the browser actually produced,
 * since auto-height blocks and individual rows have no size until they are
 * laid out, and connection endpoints need those offsets.
 */

'''
move(rend, os.path.join(SRC, "render.js"), rend_header, export=rend)
print("render.js:", wire(SRC, "render.js", rend))
