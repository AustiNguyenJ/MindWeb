import { state } from "./state.js";
import { HISTORY_LIMIT } from "./constants.js";
import { getData } from "./boards.js";
import { showToast } from "./toast.js";
import { renderBoard } from "./app.js";
import { persistBoard } from "./storage.js";

/* Undo / redo, snapshot based, one history per page.
   Changes within ~450ms of each other collapse into a single step, so typing
   a word is one undo rather than ten. */

/* ---------- undo / redo ----------
   Snapshot-based, one history per page. Changes made within ~450ms of each
   other collapse into a single step, so typing a word is one undo, not ten. */
export let undoStacks = {}, redoStacks = {}, lastSnapshots = {};

export let historyTimer = null;

export function snapshot(){
  const d = getData();
  return JSON.stringify({nodes:d.nodes, connections:d.connections});
}

export function historyReset(boardId){
  undoStacks[boardId] = [];
  redoStacks[boardId] = [];
  lastSnapshots[boardId] = snapshot();
}

export function recordChange(){
  const boardId = state.currentBoardId;
  clearTimeout(historyTimer);
  historyTimer = setTimeout(()=>{
    const cur = snapshot();
    if(cur === lastSnapshots[boardId]) return;
    const stack = undoStacks[boardId] || (undoStacks[boardId] = []);
    if(lastSnapshots[boardId] !== undefined) stack.push(lastSnapshots[boardId]);
    if(stack.length > HISTORY_LIMIT) stack.shift();
    lastSnapshots[boardId] = cur;
    redoStacks[boardId] = [];
  }, 450);
}

export function restoreSnapshot(json){
  const p = JSON.parse(json);
  const d = getData();
  d.nodes = p.nodes;
  d.connections = p.connections;
  state.selection.clear();
  state.selectedConnId = null;
  renderBoard();
  persistBoard(state.currentBoardId);
}

export function undo(){
  clearTimeout(historyTimer);
  const boardId = state.currentBoardId;
  const stack = undoStacks[boardId] || [];
  // fold in any change that hasn't been committed to history yet
  const cur = snapshot();
  if(cur !== lastSnapshots[boardId]){
    stack.push(lastSnapshots[boardId]);
    lastSnapshots[boardId] = cur;
  }
  if(!stack.length){ showToast("Nothing to undo"); return; }
  (redoStacks[boardId] || (redoStacks[boardId]=[])).push(snapshot());
  const prev = stack.pop();
  lastSnapshots[boardId] = prev;
  restoreSnapshot(prev);
  showToast("Undo");
}

export function redo(){
  clearTimeout(historyTimer);
  const boardId = state.currentBoardId;
  const stack = redoStacks[boardId] || [];
  if(!stack.length){ showToast("Nothing to redo"); return; }
  (undoStacks[boardId] || (undoStacks[boardId]=[])).push(snapshot());
  const next = stack.pop();
  lastSnapshots[boardId] = next;
  restoreSnapshot(next);
  showToast("Redo");
}
