import os
import re
import sys
sys.path.insert(0, os.path.dirname(__file__))
from move_fns import move, SRC, APP

NL = chr(10)

names = [
    "FS_SUPPORTED",
    "idb",
    "writeChains", "serializeWrite", "fsWrite", "fsRead", "fsDelete",
    "boardFileName", "parseBoardText", "parseIndex",
    "boardPayload", "indexPayload",
    "sizeWarned", "checkAppSize",
    "corruptNotified", "notifyCorrupt",
    "persistIndex", "persistBoard", "persistDeleteBoard",
    "saveIndexNow", "saveBoardNow", "saveTypesNow",
    "queueTypesSave", "queueIndexSave", "queueBoardSave",
    "openSavedBoardsDir", "readFromFolder", "writeAllToFolder",
    "connectFolder", "restoreFolderHandle", "updateStorageBar",
]

header = '''import { state } from "./state.js";
import { el } from "./dom.js";
import { showToast } from "./toast.js";
import { IDX_KEY, TYPES_KEY, APP_KEY_LIMIT } from "./constants.js";
import { ensureNotebookStructure } from "./boards.js";
import { migrateNode, recordChange, renderBoard, renderBoardList, renderBoardHeader, centerView } from "./app.js";
import { cloudPersistIndex, cloudPersistBoard, cloudPersistDeleteBoard, cloudSaveTypes } from "./cloud.js";

/* Persistence, across four backends chosen at load time:
 *
 *   folder  a real directory on disk via the File System Access API,
 *           laid out as saved-boards/index.json plus one file per page
 *   cloud   Supabase (see cloud.js)
 *   app     window.storage, when the page runs inside a Claude artifact
 *   memory  nothing persists; Export / Import still work
 *
 * A browser page cannot create folders unattended, so folder mode needs the
 * user to pick a parent directory once; the handle is then remembered.
 *
 * Two protections matter more than the rest. Writes to a given file are
 * serialised and verified by reading back, so a partial write cannot pass
 * silently. And a stored payload that exists but will not parse is treated
 * as damaged rather than empty: it is never overwritten, and the user is
 * asked once before anything clobbers it.
 */

'''

move(names, os.path.join(SRC, "storage.js"), header, export=names)

# --- work out which of the moved names app.js still uses -------------------
app = open(APP, encoding="utf-8", newline="").read()
used = [n for n in names
        if re.search(r"(?<![.\w])" + re.escape(n) + r"(?![\w])", app)]

imp = ("import {" + NL +
       "".join("  " + n + "," + NL for n in used) +
       '} from "./storage.js";' + NL)
anchor = 'import {' + NL + '  getBoard, getData, findNode, ensureNotebookStructure,' + NL + \
         '  boardsInNotebook, renumberNotebook,' + NL + '} from "./boards.js";' + NL
assert anchor in app, "boards import anchor missing"
app = app.replace(anchor, anchor + imp, 1)
open(APP, "w", encoding="utf-8", newline="").write(app)

# --- repoint other modules that imported these from app.js -----------------
cloud = os.path.join(SRC, "cloud.js")
s = open(cloud, encoding="utf-8", newline="").read()
s = s.replace("  migrateNode, updateStorageBar, renderTypeToolbar," + NL,
              "  migrateNode, renderTypeToolbar," + NL)
s = s.replace('import { ensureNotebookStructure } from "./boards.js";' + NL,
              'import { ensureNotebookStructure } from "./boards.js";' + NL +
              'import { updateStorageBar } from "./storage.js";' + NL, 1)
open(cloud, "w", encoding="utf-8", newline="").write(s)

print("storage.js written; app.js imports back:", len(used), "names")
print("  " + ", ".join(used))
