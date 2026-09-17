"""Move exact blocks of text out of src/app.js into a new module.

Every refactor step in this project is mechanical: text is *moved*, never
retyped. This helper enforces that -- each block must be found exactly once
or the run aborts without writing anything, so a silently-missed block is
impossible.
"""
import sys
import os

APP = os.path.join(os.path.dirname(__file__), "..", "src", "main.js")
APP = os.path.normpath(APP)


def cut(blocks, app_path=APP):
    """blocks: list of (text_to_remove, text_to_leave_behind).

    Returns the concatenation of everything removed, and rewrites app.js.
    Raises before writing if any block is missing or ambiguous.
    """
    src = open(app_path, encoding="utf-8", newline="").read()
    removed = []
    for old, new in blocks:
        n = src.count(old)
        if n == 0:
            raise SystemExit("NOT FOUND in app.js:\n" + old[:200])
        if n > 1:
            raise SystemExit("AMBIGUOUS (%d matches):\n%s" % (n, old[:200]))
        removed.append(old if not new else old[len(new):])
        src = src.replace(old, new, 1)
    open(app_path, "w", encoding="utf-8", newline="") .write(src)
    return "".join(removed)


def write_module(path, header, body, app_import=None):
    """Write a new module, and prepend an import line to app.js."""
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(header)
        f.write(body)
    if app_import:
        src = open(APP, encoding="utf-8", newline="").read()
        lines = src.split("\n")
        # insert after the last existing import line
        last = 0
        for i, l in enumerate(lines):
            if l.startswith("import "):
                last = i
        lines.insert(last + 1, app_import)
        open(APP, "w", encoding="utf-8", newline="").write("\n".join(lines))
