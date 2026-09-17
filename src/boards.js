import { state } from "./state.js";
import { uid } from "./util.js";

/* The document model: notebooks contain pages, pages contain blocks.
   Reading helpers for the current page, plus the ordering rules that decide
   how pages appear inside a notebook (pinned first, then by sort order). */

export function getBoard(){ return state.boards.find(b=>b.id===state.currentBoardId); }

export function getData(){ return state.boardsData[state.currentBoardId] || {nodes:[],connections:[]}; }

export function findNode(id){ return getData().nodes.find(n=>n.id===id); }

export function ensureNotebookStructure(){
  if(!Array.isArray(state.notebooks)) state.notebooks = [];
  if(!state.notebooks.length){
    state.notebooks = [{ id:"nb_"+uid().slice(0,8), name:"My Notebook", collapsed:false }];
  }
  const validIds = new Set(state.notebooks.map(n=>n.id));
  const fallback = state.notebooks[0].id;
  state.boards.forEach(b=>{ if(!b.notebookId || !validIds.has(b.notebookId)) b.notebookId = fallback; });
  state.notebooks.forEach(n=>{ if(typeof n.collapsed!=="boolean") n.collapsed=false; });
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
