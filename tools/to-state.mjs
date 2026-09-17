/* Rewrite references to the shared mutable variables so they read through the
 * single `state` object, using a real parser rather than regex.
 *
 * Regex cannot do this safely: `notebooks: notebooks` is an object-literal key
 * plus a value, `payload.boards` is a property access, and only the *variable*
 * occurrences may be rewritten. So this walks the AST and rewrites only
 * Identifier nodes that are genuine references to the top-level bindings.
 *
 * It also reports any inner scope that shadows one of the names, which would
 * make a rename wrong; the run aborts if it finds one.
 */
import { readFileSync, writeFileSync } from "node:fs";
import * as acorn from "acorn";
import * as walk from "acorn-walk";

const FILE = process.argv[2];
const NAMES = new Set(process.argv[3].split(","));
const OBJ = process.argv[4] || "state";

const src = readFileSync(FILE, "utf8");
const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: "module", locations: true });

const skip = new Set();   // node ranges that must NOT be rewritten
const shadows = [];

// 1. property keys in object literals, and non-computed member properties
walk.full(ast, (node) => {
  if (node.type === "Property" && !node.computed && node.key.type === "Identifier") {
    skip.add(node.key.start);
  }
  if (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") {
    skip.add(node.property.start);
  }
  // shorthand {boards} would need expanding; flag rather than guess
  if (node.type === "Property" && node.shorthand && NAMES.has(node.key.name)) {
    shadows.push(`shorthand property {${node.key.name}} at line ${node.key.loc.start.line}`);
  }
});

// 2. declarations: top-level ones are being replaced, inner ones are shadowing
walk.full(ast, (node) => {
  const declare = (id, topLevel) => {
    if (id.type !== "Identifier" || !NAMES.has(id.name)) return;
    if (!topLevel) shadows.push(`shadowed '${id.name}' at line ${id.loc.start.line}`);
  };
  if (node.type === "VariableDeclaration") {
    const topLevel = ast.body.includes(node);
    for (const d of node.declarations) {
      if (d.id.type === "Identifier") declare(d.id, topLevel);
    }
  }
  if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") {
    for (const p of node.params) {
      if (p.type === "Identifier" && NAMES.has(p.name)) {
        shadows.push(`parameter '${p.name}' at line ${p.loc.start.line}`);
      }
    }
  }
});

if (shadows.length) {
  console.error("ABORT -- names are shadowed or used as shorthand:");
  for (const s of shadows) console.error("  " + s);
  process.exit(1);
}

// 3. collect the identifier references to rewrite
const edits = [];
walk.full(ast, (node) => {
  if (node.type !== "Identifier" || !NAMES.has(node.name)) return;
  if (skip.has(node.start)) return;
  edits.push(node);
});

// 4. rewrite right-to-left so offsets stay valid
edits.sort((a, b) => b.start - a.start);
let out = src;
for (const n of edits) {
  out = out.slice(0, n.start) + OBJ + "." + n.name + out.slice(n.end);
}

writeFileSync(FILE, out);
console.log(`rewrote ${edits.length} references to ${OBJ}.* in ${FILE}`);
