import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from move_fns import move, SRC, APP
from wire import wire

NL = chr(10)

names = [
    "blankField", "blankSubfield", "blankGroupRow", "isCustomType",
    "seedBuiltinTypes", "reconstructMissingTypes", "spawnableTypes",
    "fieldVal", "setFieldVal", "fieldKindLabel",
    "loadCustomTypes", "migrateLongtextKinds",
]

header = '''import { state } from "./state.js";
import { uid, looksRich } from "./util.js";
import { EDITABLE_BUILTINS, TYPES_KEY, BUILTIN_KEYS } from "./constants.js";
import { showToast } from "./toast.js";
import { queueTypesSave } from "./storage.js";

/* The block-type library.
 *
 * A block type is a schema: an ordered list of fields plus a default width
 * and accent. User-defined types (ct_*) and the editable built-ins (note,
 * question, ticket) share the same shape, which is why one renderer serves
 * both. The remaining built-ins -- list, week, header, image -- have special
 * behaviour and stay hardcoded.
 *
 * Built-in types keep their values in top-level node properties rather than
 * in node.fields; fieldVal / setFieldVal hide that difference. Anything that
 * reads block content must go through them, or it silently misses every
 * built-in field.
 */

'''

move(names, os.path.join(SRC, "blockTypes.js"), header, export=names)
print("blockTypes.js written")
print("wired:", wire(SRC, "blockTypes.js", names))
