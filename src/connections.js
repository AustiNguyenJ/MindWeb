import { state } from "./state.js";
import { canvasInner, connSvg } from "./dom.js";
import { PARALLELOGRAM_SKEW, ROUNDED_RADIUS, CONN_COLOR_DEFAULT } from "./constants.js";
import { uid } from "./util.js";
import { getData, findNode } from "./boards.js";
import { hiddenNodeIds } from "./collapse.js";
import { queueBoardSave } from "./storage.js";
import { renderBoard } from "./render.js";
import { connStyleOf, setConnStyle, dashArray, themedConnColor } from "./connStyle.js";
import { SIDE_VEC, autoSide, routeGeometry } from "./connRoutes.js";
import { buildConnPopover, buildLabelEditor } from "./connPopover.js";

/* The arrows between blocks.
 *
 * A connection may start or end at a whole block, or at one row inside it.
 * Row endpoints are identified by index for list and week rows, and by the
 * string key "g:<fieldKey>:<rowIdx>" for repeating-group rows, so the two
 * kinds can never collide. Whole-block endpoints record fromItem/toItem as
 * an explicit null rather than leaving the property off.
 *
 * How a connection looks (route, arrowheads, dash, colour, width) and which
 * side of a block it is pinned to live on the connection itself, optional
 * and absent when default -- see connStyle.js. A straight, default-styled
 * connection is still drawn exactly as it always was: a <line> aimed at the
 * other block's centre and clipped at the block's edge. Elbows and curves
 * are <path>s between the side midpoints (connRoutes.js).
 *
 * Each connection is drawn twice: a thin visible stroke, and a fat
 * transparent one that is the actual click target and follows the same route.
 * The elements and the label/popover layer are remembered in `connEls`, so
 * moving a block only has to touch the connections attached to it.
 */

/* ---------- connections ---------- */

/* How far along (dirX, dirY) from a shape's centre its outline lies, as a
   multiplier of that vector (so the point is centre + dir * result). Returns
   null for a plain rectangle, which edgePoint() handles itself. The outlines
   here must match what nodeElement.js / styles.css draw. */
function shapeOutlineScale(shape, w, h, dx, dy){
  if(!(w>0 && h>0)) return null;
  const hw = w/2, hh = h/2;
  if(shape==="ellipse"){
    return 1/Math.sqrt((dx/hw)*(dx/hw) + (dy/hh)*(dy/hh));
  }
  if(shape==="diamond"){
    return 1/(Math.abs(dx)/hw + Math.abs(dy)/hh);
  }
  if(shape==="parallelogram"){
    const k = PARALLELOGRAM_SKEW*w;
    const pts = [[-hw+k,-hh],[hw,-hh],[hw-k,hh],[-hw,hh]];
    let best = null;
    for(let i=0;i<4;i++){
      const a = pts[i], b = pts[(i+1)%4];
      const ex = b[0]-a[0], ey = b[1]-a[1];
      const denom = dx*ey - dy*ex;
      if(Math.abs(denom) < 1e-12) continue;
      const t = (a[0]*ey - a[1]*ex)/denom;
      const u = (a[0]*dy - a[1]*dx)/denom;
      if(t > 0 && u >= -1e-9 && u <= 1+1e-9 && (best===null || t < best)) best = t;
    }
    return best;
  }
  if(shape==="rounded" || shape==="terminator"){
    const r = shape==="terminator" ? Math.min(hw,hh) : Math.min(ROUNDED_RADIUS, hw, hh);
    const ax = Math.abs(dx), ay = Math.abs(dy);
    const sx = ax!==0 ? hw/ax : Infinity;
    const sy = ay!==0 ? hh/ay : Infinity;
    const s = Math.min(sx,sy);
    const ccx = hw-r, ccy = hh-r;
    // the rectangle hit lands in a corner square: the real outline is the arc
    if(ax*s > ccx && ay*s > ccy){
      const ox = -ccx, oy = -ccy;
      const a = ax*ax + ay*ay;
      const b = 2*(ox*ax + oy*ay);
      const c = ox*ox + oy*oy - r*r;
      return (-b + Math.sqrt(Math.max(0, b*b - 4*a*c)))/(2*a);
    }
    return s;
  }
  return null;
}

export function edgePoint(node, dirX, dirY){
  const cx=node.x+node.w/2, cy=node.y+node.h/2, hw=node.w/2, hh=node.h/2;
  if(dirX===0 && dirY===0) return {x:cx,y:cy};
  if(node.type==="shape"){
    const t = shapeOutlineScale(node.shape, node.w, node.h, dirX, dirY);
    if(t!==null) return { x:cx+dirX*t, y:cy+dirY*t };
  }
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

/* Where a pinned side meets a block: the midpoint of that side of its real
   outline -- a diamond's vertex, an ellipse's extreme, a plain edge's middle. */
export function sidePoint(node, side){
  const v = SIDE_VEC[side];
  return edgePoint(node, v.x, v.y);
}

/* Everything needed to draw one connection, or null if an end is missing:
     route   "straight" | "elbow" | "curve"
     p1, p2  the two anchor points
     mid     where its label sits
     d       the SVG path (elbow and curve only)
   `style` is the resolved connStyleOf(conn); pass it in when it is already to
   hand, which it is on every drag step.

   A straight line keeps the rule it always had: each end is the block's
   centre-aimed edge point, or the row's attach point -- unless that end is
   pinned to a side, in which case it is that side's midpoint and the other
   end aims at it. Elbows and curves have to leave perpendicular to a side, so
   an unpinned block end takes the side facing the other block, at its
   midpoint. Row ends keep their attach rule and ignore pins either way. */
export function connGeometry(conn, style){
  const a = findNode(conn.from), b = findNode(conn.to);
  if(!a||!b) return null;
  const st = style || connStyleOf(conn);
  const acx=a.x+a.w/2, acy=a.y+a.h/2, bcx=b.x+b.w/2, bcy=b.y+b.h/2;
  const pinA = conn.fromItem==null ? st.fromSide : null;
  const pinB = conn.toItem==null ? st.toSide : null;

  if(st.route==="straight"){
    let p1 = pinA ? sidePoint(a, pinA) : null;
    const pinnedP2 = pinB ? sidePoint(b, pinB) : null;
    if(!p1){
      const target = pinnedP2 || { x:bcx, y:bcy };
      p1 = anchorPoint(a, conn.fromItem, target.x, target.y);
    }
    const p2 = pinnedP2 || anchorPoint(b, conn.toItem, p1.x, p1.y);
    return { route:"straight", p1, p2, mid:{ x:(p1.x+p2.x)/2, y:(p1.y+p2.y)/2 } };
  }

  let p1, s1, p2, s2;
  if(pinA){ s1 = pinA; p1 = sidePoint(a, s1); }
  else if(conn.fromItem==null){ s1 = autoSide(a, bcx, bcy); p1 = sidePoint(a, s1); }
  else { p1 = anchorPoint(a, conn.fromItem, bcx, bcy); s1 = p1.x>acx ? "r" : "l"; }
  if(pinB){ s2 = pinB; p2 = sidePoint(b, s2); }
  else if(conn.toItem==null){ s2 = autoSide(b, acx, acy); p2 = sidePoint(b, s2); }
  else { p2 = anchorPoint(b, conn.toItem, p1.x, p1.y); s2 = p2.x>bcx ? "r" : "l"; }
  const g = routeGeometry(st.route, p1, s1, p2, s2);
  return { route:st.route, p1, p2, mid:g.mid, d:g.d };
}

/* Just the two anchor points, in the shape the straight line was always drawn from. */
export function connLine(conn){
  const g = connGeometry(conn);
  return g ? { x1:g.p1.x, y1:g.p1.y, x2:g.p2.x, y2:g.p2.y } : null;
}

/* `opts.fromSide` / `opts.toSide` pin an end to a side of its block. A link
   between two whole shapes starts as an elbow -- the flowchart convention --
   everything else as a straight line. Only values that differ from the
   defaults are stored, so a plain link is the same six-key object it has
   always been. */
export function createConnection(fromId, fromItem, toId, toItem, opts){
  const conn = {
    id:uid(), from:fromId, to:toId,
    fromItem: (fromItem===undefined?null:fromItem),
    toItem: (toItem===undefined?null:toItem),
    label:""
  };
  const a = findNode(fromId), b = findNode(toId);
  const style = {};
  if(a && b && a.type==="shape" && b.type==="shape" && conn.fromItem===null && conn.toItem===null) style.route = "elbow";
  if(opts){ style.fromSide = opts.fromSide; style.toSide = opts.toSide; }
  setConnStyle(conn, style);
  getData().connections.push(conn);
  renderBoard(); queueBoardSave(state.currentBoardId);
}

export function deleteConnection(id){
  getData().connections = getData().connections.filter(c=>c.id!==id);
  state.selectedConnId = null;
  if(editingConnId===id) editingConnId = null;
  renderBoard(); queueBoardSave(state.currentBoardId);
}

/* ---------- drawing ---------- */

const SVG_NS = "http://www.w3.org/2000/svg";
const svgEl = (tag)=>document.createElementNS(SVG_NS, tag);
const isDark = ()=>document.documentElement.getAttribute("data-theme")==="dark";

/* The drawn elements of each connection, rebuilt by renderConnections and
   read by updateConnectionsTouching. `ui` holds whatever floats above the
   canvas for it: its label (or the editor standing in for it), and, while it
   is selected, its style popover and end handles. */
const connEls = new Map();   // conn id -> { style, vis, hit, ui }

/* The connection whose label is being edited in place, if any. */
let editingConnId = null;

/* Arrowheads are markers, and a marker's fill cannot follow the line it is
   attached to in every browser, so there is one per colour. The default grey
   end arrow is the static #arrowHead in index.html, which is also what keeps a
   default connection's markup identical to before. A start arrow is the same
   triangle pointing the other way, so orient="auto" works for both ends. */
function markerFor(kind, color){
  if(kind==="end" && color===CONN_COLOR_DEFAULT) return "arrowHead";
  const id = "connArrow-"+kind+"-"+color.slice(1);
  const defs = connSvg.querySelector("defs");
  if(!defs.querySelector('marker[id="'+id+'"]')){
    const m = svgEl("marker");
    m.setAttribute("id", id);
    m.setAttribute("markerWidth","9"); m.setAttribute("markerHeight","9");
    m.setAttribute("refX", kind==="end" ? "7" : "1"); m.setAttribute("refY","4");
    m.setAttribute("orient","auto");
    const p = svgEl("path");
    p.setAttribute("d", kind==="end" ? "M0,0 L8,4 L0,8 Z" : "M8,0 L0,4 L8,8 Z");
    p.setAttribute("fill", color);
    m.appendChild(p);
    defs.appendChild(m);
  }
  return id;
}

function setShape(node, g){
  if(g.route==="straight"){
    node.setAttribute("x1",g.p1.x); node.setAttribute("y1",g.p1.y);
    node.setAttribute("x2",g.p2.x); node.setAttribute("y2",g.p2.y);
  } else {
    node.setAttribute("d", g.d);
  }
}

const POP_OFFSET = 18;   // px below the route's midpoint, clear of its label

/* Position everything that floats over a connection: label, popover below it,
   and the draggable end handles on the selected one. */
function placeUi(ui, g){
  if(ui.label){ ui.label.style.left = g.mid.x+"px"; ui.label.style.top = g.mid.y+"px"; }
  if(ui.pop){ ui.pop.style.left = g.mid.x+"px"; ui.pop.style.top = (g.mid.y+POP_OFFSET)+"px"; }
  if(ui.from){ ui.from.style.left = g.p1.x+"px"; ui.from.style.top = g.p1.y+"px"; }
  if(ui.to){ ui.to.style.left = g.p2.x+"px"; ui.to.style.top = g.p2.y+"px"; }
}

export function updateConnectionsTouching(ids){
  const touching = typeof ids==="string" ? new Set([ids]) : new Set(ids);
  let needLayer = false;
  getData().connections.forEach(conn=>{
    if(!touching.has(conn.from) && !touching.has(conn.to)) return;
    const entry = connEls.get(conn.id);
    if(!entry) return;
    const g = connGeometry(conn, entry.style);
    if(!g) return;
    setShape(entry.vis, g); setShape(entry.hit, g);
    if((conn.label && !entry.ui.label) || (state.selectedConnId===conn.id && !entry.ui.pop)) needLayer = true;
    else placeUi(entry.ui, g);
  });
  if(needLayer) renderConnLabelsAndDelete();
}

function markConnSelected(id){
  state.selectedConnId = id; state.selection.clear();
  canvasInner.querySelectorAll(".node.selected").forEach(n=>n.classList.remove("selected"));
}

/* Clicking what is already selected leaves the drawn elements alone: a
   double-click is two clicks, and replacing the line under the second one
   would swallow the dblclick that edits its label. */
export function selectConnection(id){
  if(state.selectedConnId===id && !state.selection.size) return;
  markConnSelected(id);
  renderConnections();
}

export function renderConnections(){
  connSvg.querySelectorAll(".visible, .hit").forEach(n=>n.remove());
  connEls.clear();
  const hidden = hiddenNodeIds();
  const dark = isDark();
  getData().connections.forEach(conn=>{
    if(hidden.has(conn.from) || hidden.has(conn.to)) return;
    const style = connStyleOf(conn);
    const g = connGeometry(conn, style);
    if(!g) return;
    const selected = state.selectedConnId===conn.id;
    const colored = style.color!==CONN_COLOR_DEFAULT;
    const color = themedConnColor(style.color, dark);
    const tag = g.route==="straight" ? "line" : "path";

    const hit = svgEl(tag);
    hit.setAttribute("class","hit"+(selected && colored ? " halo" : ""));
    hit.setAttribute("data-conn",conn.id);
    setShape(hit, g);
    hit.setAttribute("stroke","transparent"); hit.setAttribute("stroke-width","14");
    if(tag==="path") hit.setAttribute("fill","none");
    hit.addEventListener("click",(e)=>{
      e.stopPropagation();
      selectConnection(conn.id);
    });
    hit.addEventListener("dblclick",(e)=>{
      e.stopPropagation();
      startLabelEdit(conn.id);
    });
    connSvg.appendChild(hit);

    const vis = svgEl(tag);
    vis.setAttribute("class","visible"+(selected?" selected":"")+(colored?" colored":""));
    vis.setAttribute("data-conn",conn.id);
    setShape(vis, g);
    vis.setAttribute("stroke",color); vis.setAttribute("stroke-width",selected ? style.width+0.5 : style.width);
    if(tag==="path") vis.setAttribute("fill","none");
    const dashes = dashArray(style.dash, style.width);
    if(dashes){
      vis.setAttribute("stroke-dasharray", dashes);
      if(style.dash==="dotted") vis.setAttribute("stroke-linecap","round");
    }
    if(style.endArrow) vis.setAttribute("marker-end","url(#"+markerFor("end",color)+")");
    if(style.startArrow) vis.setAttribute("marker-start","url(#"+markerFor("start",color)+")");
    connSvg.appendChild(vis);

    connEls.set(conn.id, { style, vis, hit, ui:{} });
  });
  renderConnLabelsAndDelete();
}

/* ---------- labels, the style popover, and in-place label editing ---------- */

/* Click the label of the selected connection, double-click the line, or use
   the popover's Label button to type the label where it sits. */
export function startLabelEdit(connId){
  const conn = getData().connections.find(c=>c.id===connId);
  if(!conn || editingConnId===connId) return;
  editingConnId = connId;
  markConnSelected(connId);
  renderConnections();
  const input = canvasInner.querySelector(".conn-label-edit");
  if(input){ input.focus(); input.select(); }
}

function finishLabelEdit(conn, value){
  editingConnId = null;
  if(value!==null && value.trim()!==(conn.label||"")){
    conn.label = value.trim();
    queueBoardSave(state.currentBoardId);
  }
  renderConnLabelsAndDelete();
}

/* Re-style the selected connection and redraw it, handing keyboard focus back
   to the control that was used (the popover is rebuilt by the redraw). */
function restyle(conn, patch, control){
  setConnStyle(conn, patch);
  renderConnections();
  queueBoardSave(state.currentBoardId);
  if(control){
    const sel = '.conn-pop [data-act="'+control.act+'"]'+(control.val!==undefined ? '[data-val="'+control.val+'"]' : '');
    const btn = canvasInner.querySelector(sel);
    if(btn) btn.focus();
  }
}

export function renderConnLabelsAndDelete(){
  // the editor is left alone (and re-found below): replacing it would throw
  // away what has been typed and fire its blur
  const live = canvasInner.querySelector(".conn-label-edit");
  canvasInner.querySelectorAll(".conn-label, .conn-del, .conn-pop, .conn-end").forEach(n=>n.remove());
  const hidden = hiddenNodeIds();
  const dark = isDark();
  let editor = null;
  getData().connections.forEach(conn=>{
    if(hidden.has(conn.from) || hidden.has(conn.to)) return;
    const entry = connEls.get(conn.id);
    const style = entry ? entry.style : connStyleOf(conn);
    const g = connGeometry(conn, style);
    if(!g) return;
    const ui = {};
    if(editingConnId===conn.id){
      if(live && live._conn===conn) editor = live;
      else {
        editor = buildLabelEditor(conn.label||"", (value)=>finishLabelEdit(conn, value));
        editor._conn = conn;
        canvasInner.appendChild(editor);
      }
      ui.label = editor;
    } else if(conn.label){
      const lbl = document.createElement("div");
      lbl.className="conn-label";
      lbl.textContent = conn.label;
      lbl.addEventListener("pointerdown",(e)=>e.stopPropagation());
      lbl.addEventListener("click",(e)=>{
        e.stopPropagation();
        if(state.selectedConnId===conn.id) startLabelEdit(conn.id); else selectConnection(conn.id);
      });
      canvasInner.appendChild(lbl);
      ui.label = lbl;
    }
    if(state.selectedConnId===conn.id){
      ui.pop = buildConnPopover(style, dark, {
        set: (patch, control)=>restyle(conn, patch, control),
        label: ()=>startLabelEdit(conn.id),
        remove: ()=>deleteConnection(conn.id),
      });
      canvasInner.appendChild(ui.pop);
      ["from","to"].forEach(end=>{
        if(conn[end+"Item"]!=null) return;      // a row end has no side to choose
        const h = document.createElement("div");
        h.className = "conn-end"; h.dataset.conn = conn.id; h.dataset.end = end;
        h.title = "Drag onto a side dot to pin that side";
        canvasInner.appendChild(h);
        ui[end] = h;
      });
    }
    placeUi(ui, g);
    if(entry) entry.ui = ui;
  });
  if(live && live!==editor){ live._done = true; live.remove(); }
  if(!editor) editingConnId = null;
}
