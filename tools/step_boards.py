import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from move_fns import move, SRC, APP

NL = chr(10)

names = ["getBoard", "getData", "findNode", "ensureNotebookStructure",
         "boardsInNotebook", "renumberNotebook"]

header = '''import { state } from "./state.js";
import { uid } from "./util.js";

/* The document model: notebooks contain pages, pages contain blocks.
   Reading helpers for the current page, plus the ordering rules that decide
   how pages appear inside a notebook (pinned first, then by sort order). */

'''

move(names, os.path.join(SRC, "boards.js"), header, export=names,
     app_import='import {' + NL +
                '  getBoard, getData, findNode, ensureNotebookStructure,' + NL +
                '  boardsInNotebook, renumberNotebook,' + NL +
                '} from "./boards.js";' + NL,
     anchor='import { state } from "./state.js";' + NL)

# cloud.js pulled ensureNotebookStructure from app.js; it lives in boards.js now
cloud = os.path.join(SRC, "cloud.js")
s = open(cloud, encoding="utf-8", newline="").read()
s = s.replace("  migrateNode, ensureNotebookStructure, updateStorageBar, renderTypeToolbar," + NL,
              "  migrateNode, updateStorageBar, renderTypeToolbar," + NL)
s = s.replace('} from "./app.js";' + NL,
              '} from "./app.js";' + NL + 'import { ensureNotebookStructure } from "./boards.js";' + NL, 1)
open(cloud, "w", encoding="utf-8", newline="").write(s)
print("boards.js written")
