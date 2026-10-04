import { el } from "./dom.js";

/* Panel widths are a per-device UI preference, not document data, so they
   persist straight to localStorage rather than through storage.js's backends
   -- same reasoning as theme.js's dark-mode flag. */

const WIDTHS_KEY = "mindmap:panelWidths";

function loadWidths(){
  try{
    const raw = localStorage.getItem(WIDTHS_KEY);
    return raw ? JSON.parse(raw) : {};
  }catch(e){ return {}; }
}

function saveWidth(storageKey, px){
  try{
    const widths = loadWidths();
    widths[storageKey] = px;
    localStorage.setItem(WIDTHS_KEY, JSON.stringify(widths));
  }catch(e){}
}

function makeResizable(leftEl, insertionPoint, { storageKey, min, max }){
  const saved = loadWidths()[storageKey];
  if(typeof saved === "number"){
    leftEl.style.width = Math.min(max, Math.max(min, saved))+"px";
  }

  const handle = document.createElement("div");
  handle.className = "panel-resize-handle";
  insertionPoint.insertAdjacentElement("afterend", handle);

  handle.addEventListener("pointerdown",(e)=>{
    e.preventDefault();
    const startX = e.clientX;
    const startW = leftEl.getBoundingClientRect().width;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("active");
    document.body.style.cursor = "col-resize";

    function onMove(ev){
      const w = Math.min(max, Math.max(min, startW+(ev.clientX-startX)));
      leftEl.style.width = w+"px";
    }
    function onUp(ev){
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.classList.remove("active");
      document.body.style.cursor = "";
      saveWidth(storageKey, parseFloat(leftEl.style.width));
    }
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  });
}

export function initPanelResize(){
  const sidebar = el("sidebar");
  makeResizable(sidebar, sidebar, { storageKey:"sidebar", min:200, max:480 });

  document.querySelectorAll(".bd-body").forEach((body)=>{
    const left = body.querySelector(":scope > .bd-left");
    const right = body.querySelector(":scope > .bd-right");
    if(!left || !right) return;
    const overlay = body.closest(".bd-overlay");
    const storageKey = "bd:"+(overlay ? overlay.id : "unknown");
    makeResizable(left, left, { storageKey, min:140, max:320 });
  });
}
