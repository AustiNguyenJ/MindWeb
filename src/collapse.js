import { state } from "./state.js";
import { getData, findNode } from "./boards.js";
import { queueBoardSave } from "./storage.js";
import { renderBoard } from "./render.js";

/* Folding a block's subtree away.
   A block with outgoing arrows can be collapsed; everything reachable from it
   by following arrows outward is then hidden, along with any line touching
   those blocks, and the collapsed block reports how many are out of sight. */

/* ---------- collapse ----------
   A box with outgoing connections can be collapsed from its head. Everything
   downstream of it (following arrows outward, recursively) is hidden, along
   with any lines touching those boxes. The collapsed box shows a count. */
export function outgoingCount(id){ return getData().connections.filter(c=>c.from===id).length; }

export function descendantsOf(id){
  const data = getData();
  const out = new Set();
  const stack = data.connections.filter(c=>c.from===id).map(c=>c.to);
  while(stack.length){
    const cur = stack.pop();
    if(cur===id || out.has(cur)) continue;
    out.add(cur);
    data.connections.filter(c=>c.from===cur).forEach(c=>{ if(!out.has(c.to)) stack.push(c.to); });
  }
  return out;
}

export function hiddenNodeIds(){
  const data = getData();
  const hidden = new Set();
  data.nodes.filter(n=>n.collapsed && outgoingCount(n.id)).forEach(root=>{
    descendantsOf(root.id).forEach(id=>hidden.add(id));
  });
  return hidden;
}

export function toggleCollapse(id){
  const n = findNode(id);
  if(!n) return;
  n.collapsed = !n.collapsed;
  if(n.collapsed){
    descendantsOf(id).forEach(d=>state.selection.delete(d));
  }
  renderBoard();
  queueBoardSave(state.currentBoardId);
}
