"""Import wiring for an extraction step.

After moving declarations out of app.js, every other module that still refers
to one of them needs an import -- and any module that was importing them
*from app.js* needs that import repointed rather than duplicated. Doing this
by hand is how a missing or doubled export slips through, so it is computed.

References are detected against the code with comments and existing import
statements stripped, so a name merely mentioned in prose does not count.
"""
import os
import re
import glob

NL = chr(10)

IMPORT_RE = re.compile(r"import\s*\{([^}]*)\}\s*from\s*[\"']([^\"']+)[\"'];[ \t]*\n?", re.S)
BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.S)
LINE_COMMENT = re.compile(r"//[^\n]*")
STRING_RE = re.compile(r"'(?:[^'\\\n]|\\.)*'|\"(?:[^\"\\\n]|\\.)*\"")


def _code_only(text):
    text = IMPORT_RE.sub("", text)
    text = BLOCK_COMMENT.sub("", text)
    text = LINE_COMMENT.sub("", text)
    text = STRING_RE.sub("''", text)
    return text


def _refs(text, names):
    code = _code_only(text)
    return [n for n in names
            if re.search(r"(?<![.\w])" + re.escape(n) + r"(?![\w])", code)]


def _parse_imports(text):
    """-> (list of (source, [names]) in order, span of the import block)"""
    items, spans = [], []
    for m in IMPORT_RE.finditer(text):
        names = [n.strip() for n in m.group(1).split(",") if n.strip()]
        items.append([m.group(2), names])
        spans.append((m.start(), m.end()))
    return items, spans


def _render(items):
    out = []
    for source, names in items:
        if not names:
            continue
        if len(names) <= 3 and sum(len(n) for n in names) < 60:
            out.append("import { " + ", ".join(names) + ' } from "' + source + '";')
        else:
            out.append("import {" + NL +
                       "".join("  " + n + "," + NL for n in names) +
                       '} from "' + source + '";')
    return NL.join(out) + NL


def wire(src_dir, module, names, moved_from="./app.js"):
    """Point every module that still uses `names` at `module`."""
    target = "./" + module
    touched = {}
    for path in sorted(glob.glob(os.path.join(src_dir, "*.js"))):
        base = os.path.basename(path)
        if base == module:
            continue
        text = open(path, encoding="utf-8", newline="").read()
        used = _refs(text, names)
        items, spans = _parse_imports(text)

        # drop the moved names from wherever they used to come from
        changed = False
        for item in items:
            if item[0] == moved_from:
                keep = [n for n in item[1] if n not in names]
                if keep != item[1]:
                    item[1] = keep
                    changed = True

        if not used and not changed:
            continue

        if used:
            existing = next((i for i in items if i[0] == target), None)
            if existing:
                for n in used:
                    if n not in existing[1]:
                        existing[1].append(n)
            else:
                items.append([target, list(used)])

        items = [i for i in items if i[1]]
        start, end = spans[0][0], spans[-1][1]
        text = text[:start] + _render(items) + text[end:]
        open(path, "w", encoding="utf-8", newline="").write(text)
        touched[base] = used
    return touched
