import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from move_fns import move, cut_lines, as_init, SRC
from wire import wire

NL = chr(10)

# Cut the top-level listener blocks first, highest line number first so the
# earlier ranges keep their positions.
picker_listeners = cut_lines(1014, 1022, 'el("pickerInput")', 'el("pickerOverlay")')
search_listeners = cut_lines(716, 729, 'el("searchInput")', 'el("searchOverlay")')
sidebar_listeners = cut_lines(585, 592, 'el("boardTitle")', "});")

# ---- picker --------------------------------------------------------------
picker = ["pickerState", "openNodePicker", "closeNodePicker", "renderPickerList",
          "highlightPicker", "movePicker", "commitPicker"]
picker_header = '''import { el } from "./dom.js";
import { state } from "./state.js";
import { escapeHtml } from "./util.js";
import { spawnableTypes } from "./blockTypes.js";
import { clientToCanvas } from "./view.js";
import { createNode, focusNodeTitle } from "./nodes.js";
import { createConnection } from "./connections.js";
import { renderBoard } from "./render.js";
import { fromItemLabel } from "./app.js";

/* The block picker, opened by dropping a connection on empty canvas.
   Type to filter, Enter takes the top match, and the new block arrives
   already connected -- and already named after the row it branched from. */

'''
move(picker, os.path.join(SRC, "picker.js"), picker_header, export=picker)
open(os.path.join(SRC, "picker.js"), "a", encoding="utf-8", newline="").write(
    NL + as_init("initPicker", picker_listeners, "Keyboard and dismissal for the picker."))
print("picker.js:", wire(SRC, "picker.js", picker + ["initPicker"]))

# ---- search --------------------------------------------------------------
search = ["searchScope", "lastQuery", "openSearch", "closeSearch", "toggleSearch",
          "renderSearchScopes", "boardsInScope", "nodeHaystack", "highlight",
          "runSearch", "goToNode"]
search_header = '''import { el, canvasInner, viewport } from "./dom.js";
import { state } from "./state.js";
import { escapeHtml, richToText } from "./util.js";
import { getBoard, findNode } from "./boards.js";
import { isCustomType } from "./blockTypes.js";
import { applyTransform } from "./view.js";
import { renderBoard } from "./render.js";
import { historyReset } from "./history.js";
import { renderBoardList, renderBoardHeader } from "./app.js";

/* Search across notebooks, scoped to everything, one notebook, or one page.
 *
 * nodeHaystack decides what is searchable. Note that it reads n.body and
 * walks n.fields, so content a block keeps in a top-level property is not
 * indexed -- see the known bug in the README about note, question and
 * ticket bodies.
 */

'''
move(search, os.path.join(SRC, "search.js"), search_header, export=search)
open(os.path.join(SRC, "search.js"), "a", encoding="utf-8", newline="").write(
    NL + as_init("initSearch", search_listeners, "Wire the search box and its overlay."))
print("search.js:", wire(SRC, "search.js", search + ["initSearch"]))

# ---- page context menu ---------------------------------------------------
menu = ["closePageMenu", "pageMenuOutside", "openPageMenu"]
menu_header = '''import { el } from "./dom.js";
import { state } from "./state.js";
import { escapeHtml } from "./util.js";
import { switchBoard, togglePin, startRenameBoard, duplicatePage, deleteBoard, treeEl } from "./app.js";

/* The right-click / overflow menu on a page in the sidebar. */

'''
move(menu, os.path.join(SRC, "pageMenu.js"), menu_header, export=menu)
print("pageMenu.js:", wire(SRC, "pageMenu.js", menu))

# ---- sidebar -------------------------------------------------------------
sidebar = ["treeEl", "favCollapsed", "renderFavorites", "renderBoardList", "clearDropMarks",
           "reorderPage", "togglePin", "startRenameNotebook", "newNotebook", "deleteNotebook",
           "startRenameBoard", "switchBoard", "newBoard", "deleteBoard", "duplicatePage",
           "renderBoardHeader"]
sidebar_header = '''import { el } from "./dom.js";
import { state } from "./state.js";
import { uid, escapeHtml, escapeAttr } from "./util.js";
import { showToast } from "./toast.js";
import { getBoard, boardsInNotebook, renumberNotebook } from "./boards.js";
import { openPageMenu } from "./pageMenu.js";
import { centerView } from "./view.js";
import { renderBoard } from "./render.js";
import { historyReset } from "./history.js";
import { queueIndexSave, persistDeleteBoard, saveBoardNow } from "./storage.js";

/* The sidebar: notebooks, the pages inside them, favourites, and the page
   header. Pages are ordered pinned-first and then by sort order, and can be
   dragged to reorder or to move between notebooks. */

'''
move(sidebar, os.path.join(SRC, "sidebar.js"), sidebar_header, export=sidebar)
open(os.path.join(SRC, "sidebar.js"), "a", encoding="utf-8", newline="").write(
    NL + as_init("initSidebar", sidebar_listeners, "Wire the page header fields and the sidebar buttons."))
print("sidebar.js:", wire(SRC, "sidebar.js", sidebar + ["initSidebar"]))
