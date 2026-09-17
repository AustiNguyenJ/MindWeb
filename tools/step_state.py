import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from extract import cut, APP

NL = chr(10)

# Remove the top-level declarations; the rename pass then points every
# reference at the shared object instead.
blocks = [
    ("let customTypes = {};   // typeId -> {id,name,accent,width,fields:[...]}" + NL, ""),
    ("let boards = [], boardsData = {}, currentBoardId = null;" + NL, ""),
    ("let notebooks = [];            // [{id, name, collapsed}]" + NL, ""),
    ("let selection = new Set();   // ids of selected boxes" + NL, ""),
    ("let selectedConnId = null;" + NL, ""),
    ("let clipboardNode = null, dragState = null;" + NL, ""),
    # keep toastTimer where it is; only saveTimers moves
    ("let saveTimers = {}, toastTimer = null;" + NL, "let toastTimer = null;" + NL),
    ("let itemOffsets = {};              // nodeId -> [y offset of each list/week row]" + NL, ""),
    ("let groupOffsets = {};             // nodeId -> { " + chr(34) + "g:field:idx" + chr(34) + ": yOffset }" + NL, ""),
    ("let cursorCanvas = { x:2100, y:1500 };" + NL, ""),
    ("let view = { x:0, y:0, scale:1 };" + NL, ""),
    ("let backend = " + chr(34) + "memory" + chr(34) + ";" + NL, ""),
    ("let rootHandle = null;   // folder the user picked" + NL, ""),
    ("let dirHandle = null;    // <root>/saved-boards" + NL, ""),
    ("let supabaseClient = null;" + NL, ""),
    ("let supabaseSession = null;" + NL, ""),
    ("const corruptBoards = new Set();" + NL, ""),
    ("const corruptPrompted = new Set();" + NL, ""),
]

cut(blocks)
print("declarations removed from app.js")
