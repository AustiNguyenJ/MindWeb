"""Move named top-level declarations out of app.js into a new module.

Relies on this codebase's consistent formatting: every top-level function
starts at column 0 and ends with a line that is exactly "}". Each requested
name must be found exactly once, and its body must close cleanly, or the run
aborts before writing anything.

A comment block directly above a function is treated as part of it and moves
with it, which is the whole point -- the comments here carry the reasoning.
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from extract import APP

NL = chr(10)
SRC = os.path.dirname(APP)

START = re.compile(r"^(export\s+)?(async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(")
SIMPLE = re.compile(r"^(export\s+)?(let|const)\s+([A-Za-z0-9_$]+)\s*=")


def _code(line):
    """The line with any trailing // comment removed (good enough here: no
    string literal in this codebase contains a // sequence at top level)."""
    i = line.find("//")
    return line if i < 0 else line[:i]


def _load():
    return open(APP, encoding="utf-8", newline="").read().split(NL)


def find_blocks(lines, names):
    """name -> (first_line_idx, last_line_idx) inclusive, 0-indexed."""
    found = {}
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        m = START.match(line)
        kind = None
        if m:
            name, kind = m.group(3), "fn"
        else:
            m2 = SIMPLE.match(line)
            if m2:
                name, kind = m2.group(3), "var"
        if kind and name in names:
            start = i
            # absorb a contiguous comment block immediately above
            j = i - 1
            while j >= 0 and (lines[j].startswith("/*") or lines[j].startswith(" *")
                              or lines[j].startswith("//") or lines[j].startswith("   ")
                              or lines[j].startswith(" ")):
                # only absorb if the run actually begins a comment
                if lines[j].startswith("/*") or lines[j].startswith("//"):
                    start = j
                    break
                if lines[j].strip() == "":
                    break
                j -= 1
            if kind == "fn":
                end = i
                depth = 0
                while end < n:
                    depth += lines[end].count("{") - lines[end].count("}")
                    if depth <= 0 and end > i:
                        break
                    if depth == 0 and end == i and lines[end].rstrip().endswith("}"):
                        break
                    end += 1
                if end >= n:
                    raise SystemExit("unterminated function: " + name)
            else:
                # a trailing // comment means the line may not END with ';',
                # so strip comments before deciding the statement is over
                end = i
                while end < n and not _code(lines[end]).rstrip().endswith(";"):
                    end += 1
            if name in found:
                raise SystemExit("duplicate top-level declaration: " + name)
            found[name] = (start, end)
            i = end + 1
            continue
        i += 1
    missing = [x for x in names if x not in found]
    if missing:
        raise SystemExit("not found in app.js: " + ", ".join(missing))
    return found


def move(names, out_path, header, export=(), app_import=None, anchor=None):
    lines = _load()
    blocks = find_blocks(lines, set(names))

    # emit in the order the names were given
    chunks = []
    taken = set()
    for name in names:
        a, b = blocks[name]
        chunks.append(NL.join(lines[a:b + 1]))
        taken.update(range(a, b + 1))

    body = (NL + NL).join(chunks) + NL

    # mark the requested exports
    for name in export:
        for pat in ("function " + name + "(", "const " + name + " =", "let " + name + " ="):
            if body.startswith(pat):
                body = "export " + body
            body = body.replace(NL + pat, NL + "export " + pat)
            body = body.replace(NL + "async " + pat, NL + "export async " + pat)
    body = body.replace("export export ", "export ")

    open(out_path, "w", encoding="utf-8", newline="").write(header + body)

    rest = NL.join(l for i, l in enumerate(lines) if i not in taken)
    while NL * 4 in rest:
        rest = rest.replace(NL * 4, NL * 3)
    if app_import:
        assert anchor in rest, "anchor not found: " + anchor
        rest = rest.replace(anchor, anchor + app_import, 1)
    open(APP, "w", encoding="utf-8", newline="").write(rest)
    return len(names)


def cut_lines(a, b, expect_first=None, expect_last=None):
    """Cut an inclusive 1-indexed line range out of app.js and return its text.

    Used for the top-level listener blocks, which are statements rather than
    declarations and so have to be relocated by position. Each range asserts
    on its first and last line before anything is written.
    """
    lines = _load()
    if expect_first is not None:
        assert lines[a - 1].startswith(expect_first), (a, lines[a - 1])
    if expect_last is not None:
        assert lines[b - 1].startswith(expect_last), (b, lines[b - 1])
    out = NL.join(lines[a - 1:b])
    rest = lines[:a - 1] + lines[b:]
    open(APP, "w", encoding="utf-8", newline="").write(NL.join(rest))
    return out


def as_init(name, body, doc=""):
    """Wrap relocated top-level statements in an exported init function."""
    indented = NL.join(("  " + l) if l.strip() else l for l in body.split(NL))
    head = ("/* " + doc + " */" + NL) if doc else ""
    return head + "export function " + name + "(){" + NL + indented + NL + "}" + NL
