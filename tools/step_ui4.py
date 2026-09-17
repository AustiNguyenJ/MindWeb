import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from move_fns import move, cut_lines, as_init, SRC
from wire import wire

NL = chr(10)

# listener blocks, cut highest-first so earlier ranges keep their numbers
designer_listeners = cut_lines(980, 985, 'el("designBlocksBtn")', 'el("bdOverlay")')
paste_listener = cut_lines(588, 614, "document.addEventListener(\"paste\"", "});")
key_listener = cut_lines(471, 547, "document.addEventListener(\"keydown\"", "});")
toolbar_listeners = cut_lines(447, 467, 'document.querySelectorAll(".add-btn', "});")
canvas_listeners = cut_lines(342, 367, 'document.addEventListener("pointerup"', "});")
canvas_listeners2 = cut_lines(239, 326, 'el("zoomIn")', "});")

# ---- designer ------------------------------------------------------------
designer = ["bdEditingId", "renderTypeToolbar", "openDesigner", "closeDesigner",
            "renderTypeList", "typeBtnHtml", "newType", "deleteType", "duplicateType",
            "editType", "renderEditor", "renderFields", "renderPreview"]
designer_header = '''import { el } from "./dom.js";
import { state } from "./state.js";
import { escapeHtml, escapeAttr, uid } from "./util.js";
import { showToast } from "./toast.js";
import { TYPE_ACCENTS, FIELD_KINDS, SUBFIELD_KINDS, PROTECTED_BUILTINS } from "./constants.js";
import { getData } from "./boards.js";
import { blankField, blankGroupRow, fieldKindLabel } from "./blockTypes.js";
import { customBodyHtml } from "./customFields.js";
import { createNode } from "./nodes.js";
import { viewportCenterCanvasCoords } from "./view.js";
import { renderBoard } from "./render.js";
import { queueTypesSave } from "./storage.js";

/* The Block Designer: define a block type as a list of fields, with a live
   preview. The editable built-ins appear here alongside user-defined types,
   since they share the same schema shape; list, week, header and image have
   special behaviour and are shown locked. */

'''
move(designer, os.path.join(SRC, "designer.js"), designer_header, export=designer)
open(os.path.join(SRC, "designer.js"), "a", encoding="utf-8", newline="").write(
    NL + as_init("initDesigner", designer_listeners, "Wire the designer's toolbar button and modal chrome."))
print("designer.js:", wire(SRC, "designer.js", designer + ["initDesigner"]))

# ---- canvas --------------------------------------------------------------
canvas = ["marqueeEl", "linkTipEl", "clearDropHighlights", "highlightDropTarget",
          "fromItemLabel", "endConnectDrag", "cleanupConnectVisuals", "startConnectDrag"]
canvas_header = '''import { el, viewport, canvasInner, connSvg } from "./dom.js";
import { state } from "./state.js";
import { getData, findNode } from "./boards.js";
import { clientToCanvas, zoomAt, centerView, applyTransform } from "./view.js";
import { applySelectionClasses, deselectAll } from "./selection.js";
import { hiddenNodeIds } from "./collapse.js";
import { createConnection, updateConnectionsTouching, renderConnLabelsAndDelete } from "./connections.js";
import { groupKey } from "./rows.js";
import { measureListOffsets, fitCanvasBounds } from "./render.js";
import { openNodePicker } from "./picker.js";
import { queueBoardSave } from "./storage.js";

/* Direct manipulation of the canvas: panning, zooming, rubber-band select,
 * dragging blocks, resizing them, and drawing a connection.
 *
 * All of it runs through one state.dragState machine with a `mode`, because
 * a pointerdown has to decide between several gestures and the follow-up
 * pointermove / pointerup are registered on the document rather than on the
 * element that started it.
 */

'''
move(canvas, os.path.join(SRC, "canvas.js"), canvas_header, export=canvas)
open(os.path.join(SRC, "canvas.js"), "a", encoding="utf-8", newline="").write(
    NL + as_init("initCanvas", canvas_listeners2 + NL + canvas_listeners,
                 "Zoom controls, and the pointer gestures on the canvas."))
print("canvas.js:", wire(SRC, "canvas.js", canvas + ["initCanvas"]))

# ---- keyboard / clipboard paste -----------------------------------------
kb = ["pasteNodeCopy", "createNoteNodeWithText"]
kb_header = '''import { el, canvasInner } from "./dom.js";
import { state } from "./state.js";
import { HOTKEYS } from "./constants.js";
import { isTextEntry } from "./util.js";
import { showToast } from "./toast.js";
import { getData, findNode } from "./boards.js";
import { uid } from "./util.js";
import { setSelection, deselectAll } from "./selection.js";
import { hiddenNodeIds } from "./collapse.js";
import { createNode, spawnAtCursor, deleteSelectedNodes, processImageFile, focusNodeTitle } from "./nodes.js";
import { createConnection, deleteConnection } from "./connections.js";
import { renderBoard } from "./render.js";
import { undo, redo } from "./history.js";
import { toggleSearch, closeSearch } from "./search.js";
import { closePageMenu } from "./pageMenu.js";
import { cleanupConnectVisuals, fromItemLabel } from "./canvas.js";
import { queueBoardSave } from "./storage.js";

/* Keyboard shortcuts and pasting.
 *
 * Every canvas shortcut is suppressed while the caret is in a text field, so
 * typing never spawns a block or deletes a selection. Paste accepts three
 * things: a copied block cluster (which brings its internal connections
 * along), an image, or plain text.
 */

'''
move(kb, os.path.join(SRC, "keyboard.js"), kb_header, export=kb)
open(os.path.join(SRC, "keyboard.js"), "a", encoding="utf-8", newline="").write(
    NL + as_init("initKeyboard", key_listener + NL + NL + paste_listener,
                 "Global keyboard shortcuts and paste handling."))
print("keyboard.js:", wire(SRC, "keyboard.js", kb + ["initKeyboard"]))

# ---- toolbar -------------------------------------------------------------
tb_header = '''import { el, imgFileInput } from "./dom.js";
import { state } from "./state.js";
import { createNode, processImageFile } from "./nodes.js";
import { viewportCenterCanvasCoords } from "./view.js";
import { renderBoard } from "./render.js";
import { queueBoardSave } from "./storage.js";

/* The block buttons across the top of the canvas. */

'''
open(os.path.join(SRC, "toolbar.js"), "w", encoding="utf-8", newline="").write(
    tb_header + as_init("initToolbar", toolbar_listeners, "Wire the add-block buttons."))
print("toolbar.js written")
