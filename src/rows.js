import { canvasInner } from "./dom.js";
import { getData } from "./boards.js";
import { state } from "./state.js";
import { blankGroupRow } from "./blockTypes.js";
import { blankTicket } from "./nodes.js";
import { renderBoard } from "./app.js";
import { queueBoardSave } from "./storage.js";

/* The repeating rows inside a block: list lines, a week's tickets, and the
   rows of a custom type's repeating-group field.
 *
 * Inserting or removing a row has to shift every connection that points at a
 * later row, or links silently start pointing at the wrong one. Numeric rows
 * shift by index; group rows shift by rewriting their "g:field:idx" keys. */

/* ---------- list item helpers ---------- */
export function itemHasConnection(nodeId, idx){
  return getData().connections.some(c=>(c.from===nodeId && c.fromItem===idx) || (c.to===nodeId && c.toItem===idx));
}

/* Group rows use string item-keys "g:<fieldKey>:<rowIdx>" so they never clash
   with the numeric indices used by list/week rows. */
export function groupKey(fieldKey, rowIdx){ return "g:"+fieldKey+":"+rowIdx; }

export function groupRowHasConnection(nodeId, fieldKey, rowIdx){
  const k = groupKey(fieldKey, rowIdx);
  return getData().connections.some(c=>(c.from===nodeId && c.fromItem===k) || (c.to===nodeId && c.toItem===k));
}

export function shiftGroupConnections(node, fieldKey, at, delta){
  // when a row is inserted/removed at index `at`, shift row-keys at or after it
  const prefix = "g:"+fieldKey+":";
  getData().connections.forEach(c=>{
    ["fromItem","toItem"].forEach(side=>{
      const v = c[side];
      if(typeof v==="string" && v.indexOf(prefix)===0){
        const ri = parseInt(v.slice(prefix.length),10);
        if(delta>0 && ri>=at) c[side] = groupKey(fieldKey, ri+1);
        else if(delta<0 && ri>at) c[side] = groupKey(fieldKey, ri-1);
      }
    });
  });
}

export function addGroupRow(node, fieldKey, afterIdx){
  const def = state.customTypes[node.type];
  const f = def ? def.fields.find(x=>x.key===fieldKey) : null;
  if(!f) return;
  if(!Array.isArray(node.fields[fieldKey])) node.fields[fieldKey] = [];
  const rows = node.fields[fieldKey];
  const at = (afterIdx===undefined||afterIdx===null) ? rows.length : afterIdx+1;
  shiftGroupConnections(node, fieldKey, at, +1);
  rows.splice(at, 0, blankGroupRow(f.subfields));
  renderBoard(); queueBoardSave(state.currentBoardId);
  const cell = canvasInner.querySelector('.node[data-id="'+node.id+'"] .group-row[data-gk="'+fieldKey+'"][data-ri="'+at+'"] .gsub');
  if(cell) cell.focus();
}

export function removeGroupRow(node, fieldKey, idx){
  const rows = node.fields[fieldKey];
  if(!Array.isArray(rows)) return;
  // drop connections attached to this row, then shift the rest down
  const k = groupKey(fieldKey, idx);
  const data = getData();
  data.connections = data.connections.filter(c=>!(
    (c.from===node.id && c.fromItem===k) || (c.to===node.id && c.toItem===k)));
  shiftGroupConnections(node, fieldKey, idx, -1);
  rows.splice(idx,1);
  renderBoard(); queueBoardSave(state.currentBoardId);
}

export function addListItem(node, afterIdx){
  const at = (afterIdx===undefined || afterIdx===null) ? node.items.length : afterIdx+1;
  node.items.splice(at, 0, "");
  getData().connections.forEach(c=>{
    if(c.from===node.id && c.fromItem!==null && c.fromItem>=at) c.fromItem++;
    if(c.to===node.id && c.toItem!==null && c.toItem>=at) c.toItem++;
  });
  renderBoard(); queueBoardSave(state.currentBoardId);
  const input = canvasInner.querySelector('.node[data-id="'+node.id+'"] .list-row[data-idx="'+at+'"] .list-input');
  if(input) input.focus();
}

export function addTicketRow(node, afterIdx){
  const at = (afterIdx===undefined||afterIdx===null) ? node.tickets.length : afterIdx+1;
  node.tickets.splice(at, 0, blankTicket());
  getData().connections.forEach(c=>{
    if(c.from===node.id && c.fromItem!==null && c.fromItem>=at) c.fromItem++;
    if(c.to===node.id && c.toItem!==null && c.toItem>=at) c.toItem++;
  });
  renderBoard(); queueBoardSave(state.currentBoardId);
  const f = canvasInner.querySelector('.node[data-id="'+node.id+'"] .ticket-row[data-idx="'+at+'"] .tr-no');
  if(f) f.focus();
}

export function removeTicketRow(node, idx){
  if(node.tickets.length===1){ node.tickets[0]=blankTicket(); renderBoard(); queueBoardSave(state.currentBoardId); return; }
  node.tickets.splice(idx,1);
  const data = getData();
  data.connections = data.connections.filter(c=>
    !((c.from===node.id && c.fromItem===idx) || (c.to===node.id && c.toItem===idx)));
  data.connections.forEach(c=>{
    if(c.from===node.id && c.fromItem!==null && c.fromItem>idx) c.fromItem--;
    if(c.to===node.id && c.toItem!==null && c.toItem>idx) c.toItem--;
  });
  renderBoard(); queueBoardSave(state.currentBoardId);
}

export function removeListItem(node, idx){
  if(node.items.length===1){ node.items[0]=""; renderBoard(); queueBoardSave(state.currentBoardId); return; }
  node.items.splice(idx,1);
  const data = getData();
  data.connections = data.connections.filter(c=>
    !((c.from===node.id && c.fromItem===idx) || (c.to===node.id && c.toItem===idx)));
  data.connections.forEach(c=>{
    if(c.from===node.id && c.fromItem!==null && c.fromItem>idx) c.fromItem--;
    if(c.to===node.id && c.toItem!==null && c.toItem>idx) c.toItem--;
  });
  renderBoard(); queueBoardSave(state.currentBoardId);
}
