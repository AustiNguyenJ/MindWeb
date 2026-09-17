"""Extract the Supabase layer (client, auth, cloud backend) into cloud.js."""
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from extract import APP

NL = chr(10)
SRC = os.path.dirname(APP)

text = open(APP, encoding="utf-8", newline="").read()
lines = text.split(NL)

assert lines[173].startswith("/* ---------- Supabase client"), lines[173]
assert lines[439] == "}", repr(lines[439])
assert lines[440] == "", repr(lines[440])
assert lines[441].startswith("/* tiny IndexedDB helper"), lines[441]

cloud_body = NL.join(lines[173:440])
rest_lines = lines[:173] + lines[440:]

# the supabase import moves with the code that uses it
imp_line = 'import { createClient } from "@supabase/supabase-js";'
assert rest_lines[0] == imp_line, rest_lines[0]
rest_lines = rest_lines[1:]

header = '''import { createClient } from "@supabase/supabase-js";
import { state } from "./state.js";
import { el } from "./dom.js";
import { showToast } from "./toast.js";
import {
  migrateNode, ensureNotebookStructure, updateStorageBar, renderTypeToolbar,
  renderBoardList, renderBoardHeader, renderBoard, centerView, historyReset,
} from "./app.js";

/* Supabase: client construction, the email magic-link sign-in flow, the
   sidebar's cloud status bar, and the cloud storage backend.

   This module and app.js import from each other. That is fine here because
   every cross-module reference is a call to a hoisted function declaration,
   made at runtime rather than while the modules are still evaluating.

   The client is constructed and the auth listeners registered while this
   module evaluates, exactly as they were in the single-file version, so the
   sign-in flow keeps its original ordering. */

'''

# export the entry points app.js still calls
for fn in ("function updateCloudBar(", "async function connectCloud(",
           "async function cloudPersistIndex(", "async function cloudPersistBoard(",
           "async function cloudPersistDeleteBoard(", "async function cloudSaveTypes("):
    assert NL + fn in NL + cloud_body, fn
    cloud_body = cloud_body.replace(NL + fn, NL + "export " + fn)
if cloud_body.startswith("function updateCloudBar("):
    cloud_body = "export " + cloud_body

open(os.path.join(SRC, "cloud.js"), "w", encoding="utf-8", newline="").write(header + cloud_body + NL)

# --- app.js ---------------------------------------------------------------
rest = NL.join(rest_lines)
while NL * 4 in rest:
    rest = rest.replace(NL * 4, NL * 3)

# app.js must export what cloud.js reaches back for
exports_needed = [
    "function migrateNode(", "function ensureNotebookStructure(", "function updateStorageBar(",
    "function renderTypeToolbar(", "function renderBoardList(", "function renderBoardHeader(",
    "function renderBoard(", "function centerView(", "function historyReset(",
]
for fn in exports_needed:
    assert NL + fn in rest, "missing: " + fn
    rest = rest.replace(NL + fn, NL + "export " + fn, 1)

imp = ('import {' + NL +
       '  updateCloudBar, connectCloud, cloudPersistIndex, cloudPersistBoard,' + NL +
       '  cloudPersistDeleteBoard, cloudSaveTypes,' + NL +
       '} from "./cloud.js";' + NL)
anchor = 'import { copyText, copyBtnHtml } from "./clipboard.js";' + NL
assert anchor in rest
rest = rest.replace(anchor, anchor + imp, 1)

open(APP, "w", encoding="utf-8", newline="").write(rest)
print("cloud.js written")
