import { state } from "./state.js";
import { canvasInner, connSvg } from "./dom.js";
import { getData } from "./boards.js";
import { isCustomType } from "./blockTypes.js";
import { hiddenNodeIds } from "./collapse.js";
import { renderConnections } from "./connections.js";
import { nodeElement } from "./nodeElement.js";

/* Drawing the page.
 *
 * renderBoard rebuilds every block from scratch rather than diffing, which
 * keeps the code simple at the cost of losing focus on re-render -- worth
 * knowing, because a couple of behaviours depend on it.
 *
 * measureListOffsets reads back the heights the browser actually produced,
 * since auto-height blocks and individual rows have no size until they are
 * laid out, and connection endpoints need those offsets.
 */

/* ---------- render ---------- */
export function measureListOffsets(){
  state.itemOffsets = {};
  state.groupOffsets = {};
  // auto-height blocks: store the height the browser actually gave them
  getData().nodes.forEach(node=>{
    if(node.type!=="ticket" && !isCustomType(node.type)) return;
    const nel = canvasInner.querySelector('.node[data-id="'+node.id+'"]');
    if(nel) node.h = nel.offsetHeight;
  });
  getData().nodes.forEach(node=>{
    // list/week numeric row offsets
    if(node.type==="list" || node.type==="week"){
      const nodeEl = canvasInner.querySelector('.node[data-id="'+node.id+'"]');
      if(nodeEl){
        node.h = nodeEl.offsetHeight;
        const offs = [];
        nodeEl.querySelectorAll(".list-row, .ticket-row").forEach(row=>{
          offs.push(row.offsetTop + row.offsetHeight/2);
        });
        state.itemOffsets[node.id] = offs;
      }
    }
    // custom-block group row offsets (string-keyed)
    if(isCustomType(node.type)){
      const nodeEl = canvasInner.querySelector('.node[data-id="'+node.id+'"]');
      if(nodeEl){
        const go = {};
        nodeEl.querySelectorAll(".group-row").forEach(row=>{
          const gk = row.dataset.gk, ri = row.dataset.ri;
          go["g:"+gk+":"+ri] = row.offsetTop + row.offsetHeight/2;
        });
        state.groupOffsets[node.id] = go;
      }
    }
  });
}

export function fitCanvasBounds(){
  const data = getData();
  let maxX = 4200, maxY = 3000;
  data.nodes.forEach(n=>{
    maxX = Math.max(maxX, n.x + (n.w||220) + 400);
    maxY = Math.max(maxY, n.y + (n.h||140) + 400);
  });
  canvasInner.style.width = maxX+"px";
  canvasInner.style.height = maxY+"px";
  connSvg.setAttribute("width", maxX);
  connSvg.setAttribute("height", maxY);
}

export function renderBoard(){
  fitCanvasBounds();
  canvasInner.querySelectorAll(".node, .conn-label, .conn-del, .empty-hint").forEach(n=>n.remove());
  const data = getData();
  const hidden = hiddenNodeIds();
  data.nodes.forEach(node=>{ if(!hidden.has(node.id)) canvasInner.appendChild(nodeElement(node)); });
  if(!data.nodes.length){
    const hint = document.createElement("div");
    hint.className="empty-hint";
    hint.innerHTML = "Press <b>H N L Q</b> to drop a box at your cursor,<br>or paste an image straight onto the canvas.";
    canvasInner.appendChild(hint);
  }
  canvasInner.querySelectorAll(".tr-note").forEach(t=>{
    t.style.height = "auto";
    t.style.height = t.scrollHeight+"px";
  });
  measureListOffsets();
  renderConnections();
}
