import { el } from "./dom.js";
import { state } from "./state.js";
import { escapeHtml } from "./util.js";
import { spawnableTypes } from "./blockTypes.js";
import { clientToCanvas } from "./view.js";
import { createNode, focusNodeTitle } from "./nodes.js";
import { createConnection } from "./connections.js";
import { renderBoard } from "./render.js";
import { fromItemLabel } from "./app.js";

/* The block picker, opened by dropping a connection on empty canvas.
   Type to filter, Enter takes the top match, and the new block arrives
   already connected -- and already named after the row it branched from. */

/* ---------- connection-drop node picker (TouchDesigner-style) ---------- */
export let pickerState = null;   // { from, canvasPt, filtered:[], active:0 }

export function openNodePicker(from, clientX, clientY){
  const canvasPt = clientToCanvas(clientX, clientY);
  pickerState = { from, canvasPt, filtered:[], active:0 };
  const overlay = el("pickerOverlay");
  const modal = el("pickerModal");
  overlay.classList.add("open");

  // position the modal near the drop point, clamped to the viewport
  const mw = 230, mh = 300;
  let left = clientX + 6, top = clientY + 6;
  if(left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
  if(top + mh > window.innerHeight - 8) top = Math.max(8, clientY - mh - 6);
  modal.style.left = left+"px";
  modal.style.top = top+"px";

  const inp = el("pickerInput");
  inp.value = "";
  renderPickerList("");
  inp.focus();
}

export function closeNodePicker(){
  el("pickerOverlay").classList.remove("open");
  pickerState = null;
}

export function renderPickerList(query){
  if(!pickerState) return;
  const q = (query||"").trim().toLowerCase();
  const all = spawnableTypes();
  const filtered = q ? all.filter(t=>t.name.toLowerCase().indexOf(q)>-1) : all;
  pickerState.filtered = filtered;
  if(pickerState.active >= filtered.length) pickerState.active = Math.max(0, filtered.length-1);
  const list = el("pickerList");
  if(!filtered.length){
    list.innerHTML = '<div class="picker-none">No block matches \u201c'+escapeHtml(query)+'\u201d</div>';
    return;
  }
  list.innerHTML = filtered.map((t,i)=>
    '<div class="picker-opt'+(i===pickerState.active?" active":"")+'" data-i="'+i+'">' +
      '<span class="sw" style="background:'+t.accent+'"></span>' +
      '<span class="pk-name">'+escapeHtml(t.name)+'</span>' +
      (state.customTypes[t.type] && !state.customTypes[t.type].builtin ? '<span class="pk-tag">custom</span>' : '') +
    '</div>').join('');
  list.querySelectorAll(".picker-opt").forEach(opt=>{
    opt.addEventListener("mouseenter",()=>{ pickerState.active = parseInt(opt.dataset.i,10); highlightPicker(); });
    opt.addEventListener("click",()=>{ pickerState.active = parseInt(opt.dataset.i,10); commitPicker(); });
  });
}

export function highlightPicker(){
  el("pickerList").querySelectorAll(".picker-opt").forEach((o,i)=>o.classList.toggle("active", i===pickerState.active));
}

export function movePicker(delta){
  if(!pickerState || !pickerState.filtered.length) return;
  const n = pickerState.filtered.length;
  pickerState.active = (pickerState.active + delta + n) % n;
  highlightPicker();
  const activeEl = el("pickerList").querySelector(".picker-opt.active");
  if(activeEl) activeEl.scrollIntoView({block:"nearest"});
}

export function commitPicker(){
  if(!pickerState || !pickerState.filtered.length){ closeNodePicker(); return; }
  const choice = pickerState.filtered[pickerState.active];
  const from = pickerState.from;
  const pt = pickerState.canvasPt;
  closeNodePicker();
  const node = createNode(choice.type, pt.x+80, pt.y, {silent:true});
  const label = fromItemLabel(from);
  if(label && choice.type!=="image") node.title = label;
  createConnection(from.fromId, from.fromItem, node.id, null);
  renderBoard();
  focusNodeTitle(node.id);
}

/* Keyboard and dismissal for the picker. */
export function initPicker(){
  el("pickerInput").addEventListener("input",(e)=>{ pickerState && (pickerState.active=0); renderPickerList(e.target.value); });
  el("pickerInput").addEventListener("keydown",(e)=>{
    e.stopPropagation();
    if(e.key==="ArrowDown"){ e.preventDefault(); movePicker(1); }
    else if(e.key==="ArrowUp"){ e.preventDefault(); movePicker(-1); }
    else if(e.key==="Enter"){ e.preventDefault(); commitPicker(); }
    else if(e.key==="Escape"){ e.preventDefault(); closeNodePicker(); }
  });
  el("pickerOverlay").addEventListener("pointerdown",(e)=>{ if(e.target===el("pickerOverlay")) closeNodePicker(); });
}
