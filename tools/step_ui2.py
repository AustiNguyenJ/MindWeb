import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from move_fns import move, SRC
from wire import wire

ne = ["nodeElement"]
header = '''import { state } from "./state.js";
import { COLORS, COPY_ICON } from "./constants.js";
import { escapeHtml, escapeAttr, sanitizeHtml, richToText, normalizeUrl, openLinkBackground } from "./util.js";
import { canvasInner, imgFileInput } from "./dom.js";
import { copyText } from "./clipboard.js";
import { findNode } from "./boards.js";
import { isCustomType, setFieldVal } from "./blockTypes.js";
import { customBodyHtml, wireCustomFields } from "./customFields.js";
import { selectNode } from "./selection.js";
import { outgoingCount, descendantsOf, toggleCollapse } from "./collapse.js";
import { itemHasConnection, addListItem, removeListItem, addTicketRow, removeTicketRow } from "./rows.js";
import { ticketSummary, createNode, deleteNode, duplicateNode, processImageFile } from "./nodes.js";
import { updateConnectionsTouching } from "./connections.js";
import { measureListOffsets, renderBoard } from "./render.js";
import { queueBoardSave } from "./storage.js";
import { startConnectDrag } from "./app.js";

/* Building one block's DOM, and wiring every control on it.
 *
 * This is the widest function in the app: it produces the markup for each
 * block type and attaches roughly thirty listeners -- title, body, rows,
 * colour swatches, the formatting bar, copy buttons, collapse, resize, the
 * drag handle and the connection dots.
 *
 * Two recurring details. Every interactive control stops pointerdown from
 * propagating, or the block-drag handler underneath would start a drag
 * instead of letting the control work. And the formatting bar acts on
 * whichever rich-text region was focused most recently, since a block can
 * have several.
 */

'''
move(ne, os.path.join(SRC, "nodeElement.js"), header, export=ne)
print("nodeElement.js:", wire(SRC, "nodeElement.js", ne))
