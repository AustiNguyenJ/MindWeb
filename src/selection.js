import { state } from "./state.js";
import { canvasInner } from "./dom.js";
import { findNode } from "./boards.js";
import { renderConnections, renderConnLabelsAndDelete } from "./connections.js";

/* Which blocks are selected, and which connection line is selected.
   Selection is a set of block ids; the DOM classes are re-applied from it
   rather than tracked separately. */

export function deselectAll(){
  state.selection.clear(); state.selectedConnId=null;
  canvasInner.querySelectorAll(".node.selected").forEach(n=>n.classList.remove("selected"));
  renderConnections();
}

export function applySelectionClasses(){
  canvasInner.querySelectorAll(".node").forEach(n=>n.classList.toggle("selected", state.selection.has(n.dataset.id)));
}

export function selectNode(id, additive){
  if(additive){
    if(state.selection.has(id)) state.selection.delete(id); else state.selection.add(id);
  } else {
    if(!state.selection.has(id)){ state.selection.clear(); state.selection.add(id); }
  }
  state.selectedConnId = null;
  applySelectionClasses();
  renderConnLabelsAndDelete();
}

export function setSelection(ids){
  state.selection = new Set(ids);
  state.selectedConnId = null;
  applySelectionClasses();
  renderConnLabelsAndDelete();
}

export function onlySelected(){
  return state.selection.size===1 ? findNode(state.selection.values().next().value) : null;
}
