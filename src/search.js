import { el, canvasInner, viewport } from "./dom.js";
import { state } from "./state.js";
import { escapeHtml, richToText } from "./util.js";
import { getBoard, findNode } from "./boards.js";
import { isCustomType } from "./blockTypes.js";
import { applyTransform } from "./view.js";
import { renderBoard } from "./render.js";
import { historyReset } from "./history.js";
import { renderBoardList, renderBoardHeader } from "./sidebar.js";

/* Search across notebooks, scoped to everything, one notebook, or one page.
 *
 * nodeHaystack decides what is searchable. Note that it reads n.body and
 * walks n.fields, so content a block keeps in a top-level property is not
 * indexed -- see the known bug in the README about note, question and
 * ticket bodies.
 */

export let searchScope = { mode:"all", id:null };   // all | notebook | page

/* ---------- search (modal, scoped, highlighted) ---------- */
export let lastQuery = "";

export function openSearch(){
  el("searchOverlay").classList.add("open");
  const inp = el("searchInput");
  renderSearchScopes();
  inp.focus(); inp.select();
  runSearch();
}

export function closeSearch(){
  el("searchOverlay").classList.remove("open");
}

export function toggleSearch(){
  if(el("searchOverlay").classList.contains("open")) closeSearch(); else openSearch();
}

export function renderSearchScopes(){
  const wrap = el("searchScopes");
  const cur = getBoard();
  const curNb = cur ? state.notebooks.find(n=>n.id===cur.notebookId) : null;
  const chips = [{mode:"all", id:null, label:"All notebooks"}];
  if(curNb) chips.push({mode:"notebook", id:curNb.id, label:curNb.name});
  if(cur) chips.push({mode:"page", id:cur.id, label:"This page"});
  wrap.innerHTML = chips.map(c=>{
    const active = (searchScope.mode===c.mode && searchScope.id===c.id);
    return '<button class="sm-scope '+(active?"active":"")+'" data-mode="'+c.mode+'" data-id="'+(c.id||"")+'">'+escapeHtml(c.label)+'</button>';
  }).join('');
  wrap.querySelectorAll(".sm-scope").forEach(btn=>{
    btn.addEventListener("click",()=>{
      searchScope = { mode:btn.dataset.mode, id:btn.dataset.id||null };
      renderSearchScopes();
      runSearch();
    });
  });
}

export function boardsInScope(){
  if(searchScope.mode==="page"){
    const b = state.boards.find(x=>x.id===searchScope.id) || getBoard();
    return b ? [b] : [];
  }
  if(searchScope.mode==="notebook"){
    return state.boards.filter(b=>b.notebookId===searchScope.id);
  }
  return state.boards;
}

export function nodeHaystack(n){
  const listText = Array.isArray(n.items) ? n.items.join(" ") : "";
  const tkText = Array.isArray(n.tickets)
    ? n.tickets.map(t=>[t.no,t.link,t.assigned,t.customer,t.note].filter(Boolean).join(" ")).join(" ") : "";
  let customText = "";
  if(isCustomType(n.type) && n.fields){
    customText = Object.keys(n.fields).map(k=>{
      const v = n.fields[k];
      if(Array.isArray(v)){
        // group rows: flatten all subfield values
        return v.map(row=>row && typeof row==="object" ? Object.keys(row).map(sk=>{
          const sv = row[sk];
          if(typeof sv!=="string") return sv===true?"yes":"";
          return /<[a-z][\s\S]*>/i.test(sv) ? richToText(sv) : sv;
        }).join(" ") : "").join(" ");
      }
      return typeof v==="string" ? richToText(v) : (v===true?"yes":"");
    }).join(" ");
  }
  const own = [n.ticketNo, n.link, n.assigned, n.customer, n.weekLabel, customText].filter(Boolean).join(" ");
  return { hay:((n.title||"")+" "+(n.body||"")+" "+listText+" "+tkText+" "+own),
           src: n.body || customText || tkText || listText || own || n.title || "" };
}

export function highlight(text, q){
  const esc = escapeHtml(text);
  if(!q) return esc;
  const qi = esc.toLowerCase().indexOf(q.toLowerCase());
  if(qi<0) return esc;
  // escape may shift indices; re-find on the escaped string safely by splitting on a case-insensitive match of the escaped query
  const eq = escapeHtml(q);
  const re = new RegExp(eq.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"), "ig");
  return esc.replace(re, m=>"<mark>"+m+"</mark>");
}

export function runSearch(){
  const q = el("searchInput").value.trim();
  lastQuery = q;
  const host = el("resultsList");
  if(!q){
    host.innerHTML = '<div class="sm-hint">Type to search titles and content.<br>Use the scope chips above to narrow by notebook or page.<br><br>Jump with <kbd>Enter</kbd> \u00b7 close with <kbd>Esc</kbd></div>';
    return;
  }
  const ql = q.toLowerCase();
  const results = [];
  boardsInScope().forEach(b=>{
    const nb = state.notebooks.find(n=>n.id===b.notebookId);
    const data = state.boardsData[b.id] || {nodes:[]};
    (data.nodes||[]).forEach(n=>{
      const {hay, src} = nodeHaystack(n);
      if(hay.toLowerCase().indexOf(ql)>-1){
        const idx = src.toLowerCase().indexOf(ql);
        let snippet = src;
        if(snippet.length>100 && idx>-1) snippet = (idx>25?"\u2026":"") + snippet.slice(Math.max(0,idx-25), idx+75) + "\u2026";
        const label = n.title || n.ticketNo || n.weekLabel || "(untitled)";
        results.push({boardId:b.id, boardName:b.name, notebookName:nb?nb.name:"", nodeId:n.id, title:label, snippet});
      }
    });
  });
  if(!results.length){
    host.innerHTML = '<div class="no-results">No matches for \u201c'+escapeHtml(q)+'\u201d in this scope.</div>';
    return;
  }
  host.innerHTML = results.map((r,i)=>
    '<div class="result-item" data-board="'+r.boardId+'" data-node="'+r.nodeId+'" data-i="'+i+'">' +
      '<div class="result-board">'+escapeHtml(r.boardName)+(r.notebookName?'<span class="rb-nb">\u00b7 '+escapeHtml(r.notebookName)+'</span>':'')+'</div>' +
      '<div class="result-title">'+highlight(r.title, q)+'</div>' +
      '<div class="result-snippet">'+highlight(r.snippet, q)+'</div>' +
    '</div>').join('');
  host.querySelectorAll(".result-item").forEach(item=>{
    item.addEventListener("click", ()=>{ closeSearch(); goToNode(item.dataset.board, item.dataset.node); });
  });
}

export function goToNode(boardId, nodeId){
  if(boardId!==state.currentBoardId){
    state.currentBoardId = boardId; state.selection.clear(); state.selectedConnId=null;
    renderBoardList(); renderBoardHeader(); renderBoard();
    historyReset(boardId);
  }
  const node = findNode(nodeId);
  if(!node) return;
  const rect = viewport.getBoundingClientRect();
  state.view.scale = 1;
  state.view.x = rect.width/2 - (node.x+node.w/2);
  state.view.y = rect.height/2 - (node.y+node.h/2);
  applyTransform();
  const nodeEl = canvasInner.querySelector('.node[data-id="'+nodeId+'"]');
  if(nodeEl){
    nodeEl.classList.add("search-hit","flash");
    setTimeout(()=>nodeEl.classList.remove("flash"), 2300);
    setTimeout(()=>nodeEl.classList.remove("search-hit"), 2600);
  }
}

/* Wire the search box and its overlay. */
export function initSearch(){
  el("searchInput").addEventListener("input", runSearch);
  el("searchInput").addEventListener("keydown",(e)=>{
    if(e.key==="Enter"){
      const first = el("resultsList").querySelector(".result-item");
      if(first){ closeSearch(); goToNode(first.dataset.board, first.dataset.node); }
    } else if(e.key==="Escape"){ closeSearch(); }
    else if(e.shiftKey && e.key.toLowerCase()==="f" && !e.ctrlKey && !e.metaKey && !e.altKey){
      // if the field is empty, treat Shift+F as a toggle-close; otherwise let it type
      if(!el("searchInput").value){ e.preventDefault(); closeSearch(); }
    }
  });
  el("searchTrigger").addEventListener("click", openSearch);
  el("searchClose").addEventListener("click", closeSearch);
  el("searchOverlay").addEventListener("click",(e)=>{ if(e.target===el("searchOverlay")) closeSearch(); });
}
