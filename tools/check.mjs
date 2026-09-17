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

/* Parsing is not enough. `node --check` sees one file at a time, so it cannot
   catch a module importing a name its neighbour never exported -- which shows
   up only as a mysteriously silent app. Bundling the entry resolves the whole
   module graph and fails loudly on exactly that. */
try {
  const { build } = await import("esbuild");
  await build({
    entryPoints: [join(ROOT, "src/app.js")],
    bundle: true,
    format: "iife",
    target: "es2020",
    write: false,
    logLevel: "silent",
    define: {
      "import.meta.env.VITE_SUPABASE_URL": '""',
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": '""',
      "import.meta.env.MODE": '"test"',
      "import.meta.env.DEV": "false",
      "import.meta.env.PROD": "false",
    },
  });
  console.log("module graph resolves (imports all satisfied)");
} catch (err) {
  bad++;
  for (const e of err.errors ?? []) {
    const l = e.location;
    console.error(`FAIL ${l ? `${l.file}:${l.line}:${l.column}` : ""} ${e.text}`);
  }
  if (!err.errors) console.error(String(err.message).split("\n").slice(0, 5).join("\n"));
}

process.exit(bad ? 1 : 0);
