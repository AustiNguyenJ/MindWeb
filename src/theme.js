import { el } from "./dom.js";
import { renderBoard } from "./render.js";
import { renderPreview } from "./designer.js";

/* Dark mode. The preference is a per-device UI setting rather than document
   data, so it lives in localStorage instead of going through storage.js's
   backends -- it has nothing to do with notebooks/boards and needs no sync.
   The actual switch (setting data-theme before first paint) happens in an
   inline script in index.html's <head>, so this only wires the toggle. */

const THEME_KEY = "mindmap-theme";

function isDark(){
  return document.documentElement.getAttribute("data-theme") === "dark";
}

function apply(dark){
  if(dark) document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
}

export function initTheme(){
  el("themeToggleBtn").addEventListener("click", ()=>{
    const next = !isDark();
    apply(next);
    try{ localStorage.setItem(THEME_KEY, next ? "dark" : "light"); }catch(e){}
    // Node fill colours are baked into inline styles at render time (see
    // themedNodeColor() in util.js), so already-drawn nodes need a re-render
    // to pick up the new theme's variant instead of staying stuck light.
    renderBoard();
    if(el("bdOverlay").classList.contains("open")) renderPreview();
  });
}
