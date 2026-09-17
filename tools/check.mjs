/* Syntax-check every module under src/ and tests/.
   Run after each refactor step: `npm run check`. */
import { readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".js") || name.endsWith(".mjs")) out.push(p);
  }
  return out;
}

const files = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "tests"))];
let bad = 0;

for (const f of files) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  } catch (err) {
    bad++;
    console.error("FAIL " + f.slice(ROOT.length + 1));
    console.error(String(err.stderr || err.message).split("\n").slice(0, 6).join("\n"));
  }
}

console.log(`${files.length - bad}/${files.length} files parse cleanly`);
process.exit(bad ? 1 : 0);
