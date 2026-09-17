import { el, viewport, canvasInner, connSvg } from "./dom.js";
import { state } from "./state.js";
import { getData, findNode } from "./boards.js";
import { clientToCanvas, zoomAt, centerView, applyTransform } from "./view.js";
import { applySelectionClasses, deselectAll } from "./selection.js";
import { hiddenNodeIds } from "./collapse.js";
import { createConnection, updateConnectionsTouching, renderConnLabelsAndDelete } from "./connections.js";
import { groupKey } from "./rows.js";
import { isCustomType } from "./blockTypes.js";
import { measureListOffsets, fitCanvasBounds } from "./render.js";
import { openNodePicker } from "./picker.js";
import { queueBoardSave } from "./storage.js";

/* Direct manipulation of the canvas: panning, zooming, rubber-band select,
 * dragging blocks, resizing them, and drawing a connection.
 *
 * All of it runs through one state.dragState machine with a `mode`, because
 * a pointerdown has to decide between several gestures and the follow-up
 * pointermove / pointerup are registered on the document rather than on the
 * element that started it.
 */

export let marqueeEl = null;

export let linkTipEl = null;

export function clearDropHighlights(){
  canvasInner.querySelectorAll(".drop-target").forEach(n=>n.classList.remove("drop-target"));
  canvasInner.querySelectorAll(".row-target").forEach(n=>n.classList.remove("row-target"));
}

export function highlightDropTarget(clientX, clientY){
  clearDropHighlights();
  const t = document.elementFromPoint(clientX, clientY);
  if(!t) return;
  const row = t.closest(".list-row");
  if(row){ row.classList.add("row-target"); return; }
  const nodeEl = t.closest(".node");
  if(nodeEl && nodeEl.dataset.id !== state.dragState.fromId) nodeEl.classList.add("drop-target");
}

export function fromItemLabel(from){
  if(from.fromItem===null || from.fromItem===undefined) return "";
  const n = findNode(from.fromId);
  if(!n) return "";
  // group row: "g:fieldKey:rowIdx"
  if(typeof from.fromItem==="string" && from.fromItem.indexOf("g:")===0){
    const parts = from.fromItem.split(":");
    const fieldKey = parts[1], ri = parseInt(parts[2],10);
    const rows = n.fields ? n.fields[fieldKey] : null;
    const def = state.customTypes[n.type];
    const f = def ? def.fields.find(x=>x.key===fieldKey) : null;
    if(rows && rows[ri] && f && f.subfields){
      for(const sf of f.subfields){
        const v = (rows[ri][sf.key]||"").toString().trim();
        if(v) return v.slice(0,40);
      }
    }
    return "";
  }
  if(n.type==="week" && Array.isArray(n.tickets)){
    const t = n.tickets[from.fromItem];
    if(!t) return "";
    return (t.no||"").trim() || (t.note||"").trim().slice(0,40);
  }
  if(!Array.isArray(n.items)) return "";
  return (n.items[from.fromItem]||"").trim();
}

export function endConnectDrag(clientX, clientY){
  const from = state.dragState;
  cleanupConnectVisuals();
  const target = document.elementFromPoint(clientX, clientY);
  const nodeEl = target ? target.closest(".node") : null;
  const listRowEl = target ? target.closest(".list-row") : null;
  const tickRowEl = target ? target.closest(".ticket-row") : null;
  const groupRowEl = target ? target.closest(".group-row") : null;

  if(nodeEl && nodeEl.dataset.id !== from.fromId){
    let toItem = null;
    if(listRowEl && listRowEl.closest(".node")===nodeEl) toItem = parseInt(listRowEl.dataset.idx,10);
    else if(tickRowEl && tickRowEl.closest(".node")===nodeEl) toItem = parseInt(tickRowEl.dataset.idx,10);
    else if(groupRowEl && groupRowEl.closest(".node")===nodeEl) toItem = groupKey(groupRowEl.dataset.gk, parseInt(groupRowEl.dataset.ri,10));
    createConnection(from.fromId, from.fromItem, nodeEl.dataset.id, toItem);
    state.dragState = null;
  } else if(!nodeEl){
    // dropped on empty canvas: open a searchable picker to choose the block type
    state.dragState = null;
    openNodePicker(from, clientX, clientY);
  } else {
    state.dragState = null;
  }
}

export function cleanupConnectVisuals(){
  const tempLine = el("tempConnLine");
  if(tempLine) tempLine.remove();
  clearDropHighlights();
  viewport.classList.remove("linking");
  if(linkTipEl){ linkTipEl.remove(); linkTipEl = null; }
}

export function startConnectDrag(fromId, fromItem, startX, startY){
  state.dragState = { mode:"connect", fromId, fromItem };
  viewport.classList.add("linking");
  const line = document.createElementNS("http://www.w3.org/2000/svg","line");
  line.id="tempConnLine";
  line.setAttribute("x1",startX); line.setAttribute("y1",startY);
  line.setAttribute("x2",startX); line.setAttribute("y2",startY);
  line.setAttribute("stroke","#4757d1"); line.setAttribute("stroke-width","2"); line.setAttribute("stroke-dasharray","5,4");
  connSvg.appendChild(line);
  linkTipEl = document.createElement("div");
  linkTipEl.className = "link-tip";
  linkTipEl.innerHTML = 'Drop on a box to link \u00b7 drop on empty space to pick a block';
  document.body.appendChild(linkTipEl);
}

/* Zoom controls, and the pointer gestures on the canvas. */
export function initCanvas(){
  el("zoomIn").addEventListener("click",()=>{const r=viewport.getBoundingClientRect();zoomAt(r.left+r.width/2,r.top+r.height/2,1.2);});
  el("zoomOut").addEventListener("click",()=>{const r=viewport.getBoundingClientRect();zoomAt(r.left+r.width/2,r.top+r.height/2,0.83);});
  el("zoomReset").addEventListener("click", centerView);

  viewport.addEventListener("wheel",(e)=>{
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY<0 ? 1.09 : 0.915);
  },{passive:false});

  viewport.addEventListener("pointermove",(e)=>{ state.cursorCanvas = clientToCanvas(e.clientX,e.clientY); });

  /* right button anywhere on the canvas = rubber-band select.
     Registered in the capture phase so it wins even over a box. */
  viewport.addEventListener("contextmenu", e=>e.preventDefault());
  viewport.addEventListener("pointerdown",(e)=>{
    if(e.button!==2) return;
    e.preventDefault();
    e.stopPropagation();
    if(!e.ctrlKey && !e.metaKey && !e.shiftKey) deselectAll();
    const c = clientToCanvas(e.clientX, e.clientY);
    marqueeEl = document.createElement("div");
    marqueeEl.className = "marquee";
    marqueeEl.style.left = c.x+"px"; marqueeEl.style.top = c.y+"px";
    marqueeEl.style.width="0px"; marqueeEl.style.height="0px";
    canvasInner.appendChild(marqueeEl);
    state.dragState = { mode:"marquee", startCx:c.x, startCy:c.y,
      additive:(e.ctrlKey||e.metaKey||e.shiftKey), base:new Set(state.selection) };
    viewport.setPointerCapture(e.pointerId);
  }, true);

  /* left button on empty canvas = pan */
  viewport.addEventListener("pointerdown",(e)=>{
    if(e.button!==0 && e.button!==1) return;
    if(e.target!==viewport && e.target!==canvasInner && e.target.id!=="connSvg" && e.target.tagName!=="svg") return;
    deselectAll();
    viewport.classList.add("panning");
    state.dragState = { mode:"pan", startX:e.clientX, startY:e.clientY, ox:state.view.x, oy:state.view.y };
    viewport.setPointerCapture(e.pointerId);
  });

  document.addEventListener("pointermove",(e)=>{
    if(!state.dragState) return;
    if(state.dragState.mode==="pan"){
      state.view.x = state.dragState.ox+(e.clientX-state.dragState.startX);
      state.view.y = state.dragState.oy+(e.clientY-state.dragState.startY);
      applyTransform();
    } else if(state.dragState.mode==="marquee"){
      const c = clientToCanvas(e.clientX, e.clientY);
      const x = Math.min(c.x, state.dragState.startCx), y = Math.min(c.y, state.dragState.startCy);
      const w = Math.abs(c.x-state.dragState.startCx), h = Math.abs(c.y-state.dragState.startCy);
      marqueeEl.style.left=x+"px"; marqueeEl.style.top=y+"px";
      marqueeEl.style.width=w+"px"; marqueeEl.style.height=h+"px";
      const hiddenNow = hiddenNodeIds();
      const hits = getData().nodes.filter(n=>
        !hiddenNow.has(n.id) &&
        n.x < x+w && n.x+n.w > x && n.y < y+h && n.y+n.h > y).map(n=>n.id);
      const next = state.dragState.additive ? new Set([...state.dragState.base, ...hits]) : new Set(hits);
      state.selection = next;
      applySelectionClasses();
    } else if(state.dragState.mode==="drag"){
      const dx=(e.clientX-state.dragState.startX)/state.view.scale, dy=(e.clientY-state.dragState.startY)/state.view.scale;
      state.dragState.moving.forEach(m=>{
        m.node.x = m.ox+dx; m.node.y = m.oy+dy;
        m.el.style.left = m.node.x+"px";
        m.el.style.top = m.node.y+"px";
        updateConnectionsTouching(m.node.id);
      });
      fitCanvasBounds();
    } else if(state.dragState.mode==="resize"){
      const dx=(e.clientX-state.dragState.startX)/state.view.scale, dy=(e.clientY-state.dragState.startY)/state.view.scale;
      state.dragState.node.w = Math.max(150, state.dragState.ow+dx);
      state.dragState.el.style.width = state.dragState.node.w+"px";
      const autoH = (state.dragState.node.type==="list" || state.dragState.node.type==="ticket" || state.dragState.node.type==="week" || isCustomType(state.dragState.node.type));
      if(!autoH){
        state.dragState.node.h = Math.max(50, state.dragState.oh+dy);
        state.dragState.el.style.height = state.dragState.node.h+"px";
      } else {
        state.dragState.node.h = state.dragState.el.offsetHeight;
      }
      updateConnectionsTouching(state.dragState.node.id);
    } else if(state.dragState.mode==="connect"){
      const c = clientToCanvas(e.clientX,e.clientY);
      state.cursorCanvas = c;
      const line = el("tempConnLine");
      if(line){ line.setAttribute("x2",c.x); line.setAttribute("y2",c.y); }
      highlightDropTarget(e.clientX, e.clientY);
    }
  });
  document.addEventListener("pointerup",(e)=>{
    if(!state.dragState) return;
    if(state.dragState.mode==="pan") viewport.classList.remove("panning");
    if(state.dragState.mode==="marquee"){
      if(marqueeEl){ marqueeEl.remove(); marqueeEl=null; }
      applySelectionClasses();
      renderConnLabelsAndDelete();
      state.dragState = null;
      return;
    }
    if(state.dragState.mode==="drag"){
      measureListOffsets();
      state.dragState.moving.forEach(m=>updateConnectionsTouching(m.node.id));
      queueBoardSave(state.currentBoardId);
    }
    if(state.dragState.mode==="resize"){
      measureListOffsets();
      updateConnectionsTouching(state.dragState.node.id);
      queueBoardSave(state.currentBoardId);
    }
    if(state.dragState.mode==="connect"){
      endConnectDrag(e.clientX, e.clientY);
      return;
    }
    state.dragState = null;
  });
}
