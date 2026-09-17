import { state } from "./state.js";
import { canvasInner, connSvg } from "./dom.js";
import { uid } from "./util.js";
import { getData, findNode } from "./boards.js";
import { hiddenNodeIds } from "./collapse.js";
import { renderBoard } from "./app.js";
import { queueBoardSave } from "./storage.js";

/* The arrows between blocks.
 *
 * A connection may start or end at a whole block, or at one row inside it.
 * Row endpoints are identified by index for list and week rows, and by the
 * string key "g:<fieldKey>:<rowIdx>" for repeating-group rows, so the two
 * kinds can never collide. Whole-block endpoints record fromItem/toItem as
 * an explicit null rather than leaving the property off.
 *
 * Each line is drawn twice: a thin visible one, and a fat transparent one
 * underneath that is the actual click target.
 */

/* ---------- connections ---------- */
export function edgePoint(node, dirX, dirY){
  const cx=node.x+node.w/2, cy=node.y+node.h/2, hw=node.w/2, hh=node.h/2;
  if(dirX===0 && dirY===0) return {x:cx,y:cy};
  const sx = dirX!==0 ? hw/Math.abs(dirX) : Infinity;
  const sy = dirY!==0 ? hh/Math.abs(dirY) : Infinity;
  const s = Math.min(sx,sy);
  return { x:cx+dirX*s, y:cy+dirY*s };
}

export function anchorPoint(node, itemIndex, towardX, towardY){
  if(itemIndex===null || itemIndex===undefined){
    const cx=node.x+node.w/2, cy=node.y+node.h/2;
    return edgePoint(node, towardX-cx, towardY-cy);
  }
  const cx = node.x+node.w/2;
  let oy;
  if(typeof itemIndex==="string" && itemIndex.indexOf("g:")===0){
    const go = state.groupOffsets[node.id] || {};
    oy = go[itemIndex]!=null ? go[itemIndex] : node.h/2;
  } else {
    const offs = state.itemOffsets[node.id] || [];
    oy = offs[itemIndex]!=null ? offs[itemIndex] : node.h/2;
  }
  return { x: towardX>cx ? node.x+node.w : node.x, y: node.y+oy };
}

export function connLine(conn){
  const a = findNode(conn.from), b = findNode(conn.to);
  if(!a||!b) return null;
  const bcx=b.x+b.w/2, bcy=b.y+b.h/2;
  const p1 = anchorPoint(a, conn.fromItem, bcx, bcy);
  const p2 = anchorPoint(b, conn.toItem, p1.x, p1.y);
  return { x1:p1.x, y1:p1.y, x2:p2.x, y2:p2.y };
}

export function createConnection(fromId, fromItem, toId, toItem){
  getData().connections.push({
    id:uid(), from:fromId, to:toId,
    fromItem: (fromItem===undefined?null:fromItem),
    toItem: (toItem===undefined?null:toItem),
    label:""
  });
  renderBoard(); queueBoardSave(state.currentBoardId);
}

export function deleteConnection(id){
  getData().connections = getData().connections.filter(c=>c.id!==id);
  state.selectedConnId = null;
  renderBoard(); queueBoardSave(state.currentBoardId);
}

export function updateConnectionsTouching(nodeId){
  getData().connections.forEach(conn=>{
    if(conn.from!==nodeId && conn.to!==nodeId) return;
    const line = connLine(conn);
    if(!line) return;
    const vis = connSvg.querySelector('.visible[data-conn="'+conn.id+'"]');
    const hit = connSvg.querySelector('.hit[data-conn="'+conn.id+'"]');
    [vis,hit].forEach(l=>{ if(l){ l.setAttribute("x1",line.x1); l.setAttribute("y1",line.y1); l.setAttribute("x2",line.x2); l.setAttribute("y2",line.y2); } });
  });
  renderConnLabelsAndDelete();
}

export function renderConnections(){
  connSvg.querySelectorAll("line:not(#tempConnLine)").forEach(n=>n.remove());
  const hidden = hiddenNodeIds();
  getData().connections.forEach(conn=>{
    if(hidden.has(conn.from) || hidden.has(conn.to)) return;
    const line = connLine(conn);
    if(!line) return;
    const vis = document.createElementNS("http://www.w3.org/2000/svg","line");
    vis.setAttribute("class","visible"+(state.selectedConnId===conn.id?" selected":""));
    vis.setAttribute("data-conn",conn.id);
    vis.setAttribute("x1",line.x1); vis.setAttribute("y1",line.y1);
    vis.setAttribute("x2",line.x2); vis.setAttribute("y2",line.y2);
    vis.setAttribute("stroke","#9aa1ab"); vis.setAttribute("stroke-width","2"); vis.setAttribute("marker-end","url(#arrowHead)");
    connSvg.appendChild(vis);

    const hit = document.createElementNS("http://www.w3.org/2000/svg","line");
    hit.setAttribute("class","hit"); hit.setAttribute("data-conn",conn.id);
    hit.setAttribute("x1",line.x1); hit.setAttribute("y1",line.y1);
    hit.setAttribute("x2",line.x2); hit.setAttribute("y2",line.y2);
    hit.setAttribute("stroke","transparent"); hit.setAttribute("stroke-width","14");
    hit.addEventListener("click",(e)=>{
      e.stopPropagation();
      state.selectedConnId = conn.id; state.selection.clear();
      canvasInner.querySelectorAll(".node.selected").forEach(n=>n.classList.remove("selected"));
      renderConnections();
    });
    hit.addEventListener("dblclick",(e)=>{
      e.stopPropagation();
      const label = prompt("Label for this connection:", conn.label||"");
      if(label!==null){ conn.label = label.trim(); renderConnections(); queueBoardSave(state.currentBoardId); }
    });
    connSvg.appendChild(hit);
  });
  renderConnLabelsAndDelete();
}

export function renderConnLabelsAndDelete(){
  canvasInner.querySelectorAll(".conn-label, .conn-del").forEach(n=>n.remove());
  const hidden = hiddenNodeIds();
  getData().connections.forEach(conn=>{
    if(hidden.has(conn.from) || hidden.has(conn.to)) return;
    const line = connLine(conn);
    if(!line) return;
    const mx=(line.x1+line.x2)/2, my=(line.y1+line.y2)/2;
    if(conn.label){
      const lbl = document.createElement("div");
      lbl.className="conn-label"; lbl.style.left=mx+"px"; lbl.style.top=my+"px";
      lbl.textContent = conn.label;
      canvasInner.appendChild(lbl);
    }
    if(state.selectedConnId===conn.id){
      const b = document.createElement("button");
      b.className="conn-del"; b.style.left=mx+"px"; b.style.top=(my-18)+"px"; b.textContent="\u00d7";
      b.addEventListener("click",()=>deleteConnection(conn.id));
      canvasInner.appendChild(b);
    }
  });
}
