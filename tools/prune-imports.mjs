/* Remove imported names that nothing in the file uses.
 *
 * Driven by ESLint's no-unused-vars rather than by reading, so it cannot
 * miss one or delete one that is actually used. Only import specifiers are
 * touched; an unused local declaration is left alone for a human to judge.
 */
import { ESLint } from "eslint";
import { readFileSync, writeFileSync } from "node:fs";

const targets = process.argv.slice(2);
if (!targets.length) {
  console.error("usage: node tools/prune-imports.mjs <file...>");
  process.exit(2);
}

const eslint = new ESLint();
let totalRemoved = 0;

for (const file of targets) {
  const [result] = await eslint.lintFiles([file]);
  const unused = new Set(
    result.messages
      .filter((m) => m.ruleId === "no-unused-vars" && / is defined but never used/.test(m.message))
      .map((m) => m.message.match(/'([^']+)'/)?.[1])
      .filter(Boolean)
  );
  if (!unused.size) {
    console.log(`${file}: nothing to prune`);
    continue;
  }

  let text = readFileSync(file, "utf8");
  const IMPORT = /import\s*\{([^}]*)\}\s*from\s*(["'][^"']+["']);[ \t]*\n/g;
  let removed = 0;

  text = text.replace(IMPORT, (whole, names, source) => {
    const kept = names
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean)
      .filter((n) => {
        const local = n.split(/\s+as\s+/).pop().trim();
        if (unused.has(local)) { removed++; return false; }
        return true;
      });
    if (!kept.length) return "";
    if (kept.length <= 3 && kept.join(", ").length < 60) {
      return `import { ${kept.join(", ")} } from ${source};\n`;
    }
    return `import {\n${kept.map((n) => "  " + n + ",\n").join("")}} from ${source};\n`;
  });

  writeFileSync(file, text);
  totalRemoved += removed;
  console.log(`${file}: removed ${removed} unused import(s)`);
}

console.log(`total: ${totalRemoved}`);
