import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { renameSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/* The app's whole appeal is that it is one file you can open anywhere -- the
   in-app help even promises it. vite-plugin-singlefile inlines the JS and CSS
   back into the HTML so `npm run build` still produces exactly that, while
   development happens in real modules.

   The built page is named mindmap-tool.html to match what the project has
   always been called. */
function nameTheBundle() {
  return {
    name: "name-the-bundle",
    closeBundle() {
      const from = resolve(__dirname, "dist/index.html");
      const to = resolve(__dirname, "dist/mindmap-tool.html");
      if (existsSync(from)) renameSync(from, to);
    },
  };
}

export default defineConfig({
  plugins: [viteSingleFile(), nameTheBundle()],
  server: {
    // File System Access API (the "Connect folder" backend) is restricted on
    // file:// URLs, so the dev server is also the way to exercise it properly.
    port: 5173,
    open: false,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    // keep everything in the one file, images included
    assetsInlineLimit: 100 * 1024 * 1024,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 4096,
  },
});
