import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from move_fns import move, SRC, APP
from wire import wire

NL = chr(10)

# ---- history -------------------------------------------------------------
hist = ["undoStacks", "historyTimer", "snapshot", "historyReset",
        "recordChange", "restoreSnapshot", "undo", "redo"]

hist_header = '''import { state } from "./state.js";
import { HISTORY_LIMIT } from "./constants.js";
import { getData } from "./boards.js";
import { showToast } from "./toast.js";
import { renderBoard } from "./app.js";
import { persistBoard } from "./storage.js";

/* Undo / redo, snapshot based, one history per page.
   Changes within ~450ms of each other collapse into a single step, so typing
   a word is one undo rather than ten. */

'''
move(hist, os.path.join(SRC, "history.js"), hist_header, export=hist)
print("history.js:", wire(SRC, "history.js", hist))

# ---- export / import -----------------------------------------------------
io = ["exportAll", "importAll"]
io_header = '''import { state } from "./state.js";
import { uid } from "./util.js";
import { showToast } from "./toast.js";
import { ensureNotebookStructure } from "./boards.js";
import { migrateLongtextKinds } from "./blockTypes.js";
import { queueTypesSave, persistIndex, persistBoard } from "./storage.js";
import { migrateNode, renderBoardList, renderTypeToolbar } from "./app.js";

/* The single-file backup format: one JSON bundle carrying notebooks, pages,
   their blocks and connections, and the block-type library. Import adds
   alongside what is already there rather than replacing it, remapping ids so
   an imported page can never collide with an existing one. */

'''
move(io, os.path.join(SRC, "exportImport.js"), io_header, export=io)
print("exportImport.js:", wire(SRC, "exportImport.js", io))
