import { state } from "./state.js";
import { uid } from "./util.js";

/* The document model: notebooks contain pages and can nest other notebooks,
   pages contain blocks. Reading helpers for the current page, plus the
   ordering rules that decide how pages appear inside a notebook (pinned
   first, then by sort order) and how notebooks order among their siblings. */

export function getBoard(){ return state.boards.find(b=>b.id===state.currentBoardId); }

export function getData(){ return state.boardsData[state.currentBoardId] || {nodes:[],connections:[]}; }

export function findNode(id){ return getData().nodes.find(n=>n.id===id); }

/* A notebook's parentId must point at a real notebook and never close a
   loop back on itself (a corrupt import, or two notebooks nesting each
   other). Repair by cutting the bad link, not by refusing to load. */
function sanitizeNotebookParents(){
  const byId = new Map(state.notebooks.map(n=>[n.id, n]));
  state.notebooks.forEach(n=>{ if(n.parentId && !byId.has(n.parentId)) n.parentId = null; });
  state.notebooks.forEach(n=>{
    const seen = new Set([n.id]);
    let cur = n.parentId ? byId.get(n.parentId) : null;
    while(cur){
      if(seen.has(cur.id)){ n.parentId = null; break; }
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : null;
    }
  });
}

export function ensureNotebookStructure(){
  if(!Array.isArray(state.notebooks)) state.notebooks = [];
  if(!state.notebooks.length){
    state.notebooks = [{ id:"nb_"+uid().slice(0,8), name:"My Notebook", collapsed:false, parentId:null, order:0 }];
  }
  state.notebooks.forEach(n=>{ if(typeof n.parentId!=="string") n.parentId = null; });
  sanitizeNotebookParents();
  const validIds = new Set(state.notebooks.map(n=>n.id));
  const fallback = (state.notebooks.find(n=>!n.parentId) || state.notebooks[0]).id;
  state.boards.forEach(b=>{ if(!b.notebookId || !validIds.has(b.notebookId)) b.notebookId = fallback; });
  state.notebooks.forEach(n=>{ if(typeof n.collapsed!=="boolean") n.collapsed=false; });
  // seed an explicit order (per parent, so siblings sort independently of
  // notebooks nested elsewhere) for any notebook missing one.
  const nbCounters = new Map();
  state.notebooks.forEach(n=>{
    if(typeof n.order!=="number"){
      const key = n.parentId || "";
      const i = nbCounters.get(key) || 0;
      n.order = i;
      nbCounters.set(key, i+1);
    }
  });
  // seed pin flag and an explicit order for any page missing them.
  // order is seeded from current array position so nothing reshuffles.
  state.boards.forEach((b,i)=>{
    if(typeof b.pinned!=="boolean") b.pinned=false;
    if(typeof b.order!=="number") b.order = i;
  });
}

/* Pages within a notebook, ordered: pinned first, then by their order value.
   Ties fall back to array position so the sort is always stable. */
export function boardsInNotebook(nbId){
  return state.boards
    .map((b,i)=>({b, i}))
    .filter(x=>x.b.notebookId===nbId)
    .sort((A,B)=>{
      if(!!A.b.pinned !== !!B.b.pinned) return A.b.pinned ? -1 : 1;
      const oa = (typeof A.b.order==="number")?A.b.order:A.i;
      const ob = (typeof B.b.order==="number")?B.b.order:B.i;
      if(oa!==ob) return oa-ob;
      return A.i-B.i;
    })
    .map(x=>x.b);
}

/* Renumber a notebook's pages 0..n so order values stay compact after a move. */
export function renumberNotebook(nbId){
  boardsInNotebook(nbId).forEach((b,i)=>{ b.order = i; });
}

/* Direct children of a notebook (or the root list, for parentId null/undefined),
   ordered the same stable way as boardsInNotebook. */
export function notebooksInParent(parentId){
  const pid = parentId || null;
  return state.notebooks
    .map((n,i)=>({n, i}))
    .filter(x=>(x.n.parentId||null)===pid)
    .sort((A,B)=>{
      const oa = (typeof A.n.order==="number")?A.n.order:A.i;
      const ob = (typeof B.n.order==="number")?B.n.order:B.i;
      if(oa!==ob) return oa-ob;
      return A.i-B.i;
    })
    .map(x=>x.n);
}

/* Renumber one level of the notebook tree 0..n after a move. */
export function renumberNotebooksInParent(parentId){
  notebooksInParent(parentId).forEach((n,i)=>{ n.order = i; });
}

/* True when candidateId is ancestorId itself or nested somewhere underneath
   it -- used to stop a notebook being dragged into its own subtree. */
export function isNotebookDescendant(ancestorId, candidateId){
  const byId = new Map(state.notebooks.map(n=>[n.id, n]));
  let cur = byId.get(candidateId);
  while(cur){
    if(cur.id===ancestorId) return true;
    cur = cur.parentId ? byId.get(cur.parentId) : null;
  }
  return false;
}
