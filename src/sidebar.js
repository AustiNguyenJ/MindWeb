import { el } from "./dom.js";
import { state } from "./state.js";
import { uid, escapeHtml, escapeAttr } from "./util.js";
import { showToast } from "./toast.js";
import { getBoard, boardsInNotebook, renumberNotebook } from "./boards.js";
import { openPageMenu } from "./pageMenu.js";
import { centerView } from "./view.js";
import { renderBoard } from "./render.js";
import { historyReset } from "./history.js";
import { queueIndexSave, persistDeleteBoard, persistDeleteNotebook, saveBoardNow } from "./storage.js";
import { confirmModal } from "./confirmModal.js";

/* The sidebar: notebooks, the pages inside them, favourites, and the page
   header. Pages are ordered pinned-first and then by sort order, and can be
   dragged to reorder or to move between notebooks. */

/* ---------- multi-select (for bulk-deleting pages) ---------------------
   Local to this module, like the designer's selected-type or the picker's
   filter -- nothing outside the sidebar needs to know which pages are
   multi-selected. Plain click always means "open this page" and clears the
   selection; Ctrl/Cmd-click toggles a page in or out of it; Shift-click
   extends it as a range over the currently rendered page order. */
let selectedBoardIds = new Set();
let lastClickedBoardId = null;

function pruneSelection(){
  const live = new Set(state.boards.map(b=>b.id));
  for(const id of selectedBoardIds) if(!live.has(id)) selectedBoardIds.delete(id);
  // lastClickedBoardId is a shift-click anchor, not necessarily itself
  // selected (a plain click sets it without adding to the selection) -- only
  // drop it once the page it points at is actually gone
  if(lastClickedBoardId && !live.has(lastClickedBoardId)) lastClickedBoardId = null;
}

function updateMultiSelectBar(){
  pruneSelection();
  const bar = el("multiSelectBar");
  if(!bar) return;
  if(selectedBoardIds.size < 2){ bar.style.display = "none"; return; }
  bar.style.display = "";
  el("multiSelectCount").textContent = selectedBoardIds.size+" pages selected";
}

function clearMultiSelect(){
  selectedBoardIds.clear();
  lastClickedBoardId = null;
  renderBoardList();
}

/* ---------- sidebar ---------- */
export const treeEl = () => el("notebookTree");

export let favCollapsed = false;

/* Favorites = every pinned page, across all notebooks. Auto-hidden when none
   are pinned so the section never takes space until it's useful. */
export function renderFavorites(){
  const wrap = el("favWrap");
  if(!wrap) return;
  const favs = state.boards.filter(b=>b.pinned);
  if(!favs.length){ wrap.style.display = "none"; return; }
  wrap.style.display = "";
  wrap.classList.toggle("collapsed", favCollapsed);
  el("favCount").textContent = favs.length;

  // order favorites the way they appear in their notebooks (pinned order)
  const ordered = [];
  state.notebooks.forEach(nb=>{
    boardsInNotebook(nb.id).forEach(b=>{ if(b.pinned) ordered.push({b, nb}); });
  });
  // include any pinned page whose notebook somehow isn't listed
  favs.forEach(b=>{ if(!ordered.some(o=>o.b.id===b.id)) ordered.push({b, nb:state.notebooks.find(n=>n.id===b.notebookId)}); });

  el("favList").innerHTML = ordered.map(({b, nb})=>
    '<div class="fav-item '+(b.id===state.currentBoardId?"active":"")+'" data-id="'+b.id+'">' +
      '<span class="fav-dot">\u2605</span>' +
      '<span class="fav-name">'+escapeHtml(b.name||"Untitled")+'</span>' +
      (nb ? '<span class="fav-nb">'+escapeHtml(nb.name||"")+'</span>' : '') +
      '<button class="fav-unstar" data-id="'+b.id+'" title="Remove from favorites">\u2605</button>' +
    '</div>').join('');

  el("favList").querySelectorAll(".fav-item").forEach(item=>{
    item.addEventListener("click",(e)=>{ if(!e.target.closest(".fav-unstar")) switchBoard(item.dataset.id); });
  });
  el("favList").querySelectorAll(".fav-unstar").forEach(btn=>{
    btn.addEventListener("click",(e)=>{ e.stopPropagation(); togglePin(btn.dataset.id); });
  });
}

export function renderBoardList(){
  renderFavorites();
  const host = treeEl();
  if(!host) return;
  host.innerHTML = state.notebooks.map(nb=>{
    const pages = boardsInNotebook(nb.id);
    const pagesHtml = pages.length
      ? pages.map(b=>
          '<div class="board-item '+(b.id===state.currentBoardId?'active':'')+(b.pinned?' pinned':'')+
            (selectedBoardIds.has(b.id)?' multi-selected':'')+'" draggable="true" data-id="'+b.id+'">' +
          (b.pinned?'<span class="pin-ico" title="Pinned">\u2605</span>':'') +
          '<span class="bname">'+escapeHtml(b.name||"Untitled")+'</span>' +
          '<button class="board-menu-btn" data-id="'+b.id+'" title="Page options">\u22ef</button></div>').join('')
      : '<div class="nb-emptypages">No pages yet</div>';
    return '<div class="nb '+(nb.collapsed?'collapsed':'')+'" data-nb="'+nb.id+'">' +
      '<div class="nb-head" data-nb="'+nb.id+'">' +
        '<svg class="nb-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m6 9 6 6 6-6"/></svg>' +
        '<span class="nb-name">'+escapeHtml(nb.name||"Notebook")+'</span>' +
        '<span class="nb-count">'+pages.length+'</span>' +
        '<span class="nb-actions">' +
          '<button class="nb-add-page" data-nb="'+nb.id+'" title="New page here">+</button>' +
          '<button class="nb-rename" data-nb="'+nb.id+'" title="Rename notebook">\u270e</button>' +
          '<button class="nb-del-btn" data-nb="'+nb.id+'" title="Delete notebook">\u00d7</button>' +
        '</span>' +
      '</div>' +
      '<div class="nb-pages" data-nb="'+nb.id+'">'+pagesHtml+'</div>' +
    '</div>';
  }).join('');

  // notebook header: toggle collapse
  host.querySelectorAll(".nb-head").forEach(head=>{
    head.addEventListener("click",(e)=>{
      if(e.target.closest(".nb-actions")) return;
      const nb = state.notebooks.find(n=>n.id===head.dataset.nb);
      if(nb){ nb.collapsed = !nb.collapsed; renderBoardList(); queueIndexSave(); }
    });
  });
  host.querySelectorAll(".nb-add-page").forEach(btn=>{
    btn.addEventListener("click",(e)=>{ e.stopPropagation(); newBoard(btn.dataset.nb); });
  });
  host.querySelectorAll(".nb-rename").forEach(btn=>{
    btn.addEventListener("click",(e)=>{ e.stopPropagation(); startRenameNotebook(btn.dataset.nb); });
  });
  host.querySelectorAll(".nb-del-btn").forEach(btn=>{
    btn.addEventListener("click",(e)=>{ e.stopPropagation(); deleteNotebook(btn.dataset.nb); });
  });

  // pages: click to open, dbl-click to rename, menu button, drag to move/reorder
  host.querySelectorAll(".board-item").forEach(item=>{
    item.addEventListener("click",(e)=>{
      if(e.target.closest(".board-menu-btn")) return;
      const id = item.dataset.id;
      if(e.ctrlKey || e.metaKey){
        if(selectedBoardIds.has(id)) selectedBoardIds.delete(id); else selectedBoardIds.add(id);
        lastClickedBoardId = id;
        renderBoardList();
        return;
      }
      if(e.shiftKey && lastClickedBoardId){
        const order = [...host.querySelectorAll(".board-item")].map(x=>x.dataset.id);
        const a = order.indexOf(lastClickedBoardId), b = order.indexOf(id);
        if(a!==-1 && b!==-1){
          const [lo, hi] = a<b ? [a,b] : [b,a];
          order.slice(lo, hi+1).forEach(pid=>selectedBoardIds.add(pid));
          renderBoardList();
          return;
        }
      }
      const hadSelection = selectedBoardIds.size > 0;
      selectedBoardIds.clear();
      lastClickedBoardId = id;   // still the anchor for a later shift-click
      switchBoard(id);
      // switchBoard() no-ops (no re-render) if this was already the open
      // page, which would otherwise leave stale multi-select highlighting
      if(hadSelection && id===state.currentBoardId) renderBoardList();
    });
    item.addEventListener("dblclick",(e)=>{ if(!e.target.closest(".board-menu-btn")) startRenameBoard(item.dataset.id, item); });
    item.addEventListener("contextmenu",(e)=>{ e.preventDefault(); openPageMenu(item.dataset.id, e.clientX, e.clientY); });
    item.addEventListener("dragstart",(e)=>{
      item.classList.add("dragging");
      e.dataTransfer.setData("text/plain", item.dataset.id);
      e.dataTransfer.effectAllowed="move";
    });
    item.addEventListener("dragend",()=>{ item.classList.remove("dragging"); clearDropMarks(); });
    // reordering: dropping ONTO another page inserts relative to it
    item.addEventListener("dragover",(e)=>{
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect="move";
      const r = item.getBoundingClientRect();
      const below = e.clientY > r.top + r.height/2;
      clearDropMarks();
      item.classList.add(below ? "drop-below" : "drop-above");
    });
    item.addEventListener("dragleave",()=>{ item.classList.remove("drop-above","drop-below"); });
    item.addEventListener("drop",(e)=>{
      e.preventDefault(); e.stopPropagation();
      const below = item.classList.contains("drop-below");
      clearDropMarks();
      const pageId = e.dataTransfer.getData("text/plain");
      reorderPage(pageId, item.dataset.id, below);
    });
  });
  host.querySelectorAll(".board-menu-btn").forEach(btn=>{
    btn.addEventListener("click",(e)=>{
      e.stopPropagation();
      const r = btn.getBoundingClientRect();
      openPageMenu(btn.dataset.id, r.right, r.bottom);
    });
  });

  // drop targets: a notebook accepts pages dropped onto its header or empty page area
  host.querySelectorAll(".nb-head, .nb-pages").forEach(zone=>{
    zone.addEventListener("dragover",(e)=>{ e.preventDefault(); e.dataTransfer.dropEffect="move";
      zone.closest(".nb").querySelector(".nb-head").classList.add("drop-into"); });
    zone.addEventListener("dragleave",()=>{ zone.closest(".nb").querySelector(".nb-head").classList.remove("drop-into"); });
    zone.addEventListener("drop",(e)=>{
      e.preventDefault();
      zone.closest(".nb").querySelector(".nb-head").classList.remove("drop-into");
      const pageId = e.dataTransfer.getData("text/plain");
      const nbId = zone.dataset.nb;
      const b = state.boards.find(x=>x.id===pageId);
      if(b && nbId && b.notebookId!==nbId){
        b.notebookId = nbId;
        b.order = boardsInNotebook(nbId).length;   // drop at the end of the target notebook
        renumberNotebook(nbId);
        const nb = state.notebooks.find(n=>n.id===nbId);
        if(nb) nb.collapsed = false;
        renderBoardList(); queueIndexSave();
      }
    });
  });

  updateMultiSelectBar();
}

export function clearDropMarks(){
  treeEl().querySelectorAll(".board-item.drop-above,.board-item.drop-below")
    .forEach(x=>x.classList.remove("drop-above","drop-below"));
}

/* Move a page next to a target page. If they're in different notebooks the
   dragged page joins the target's notebook. Pinned status follows the target
   so you can reorder within the pinned group or the unpinned group. */
export function reorderPage(pageId, targetId, below){
  if(pageId===targetId) return;
  const b = state.boards.find(x=>x.id===pageId);
  const t = state.boards.find(x=>x.id===targetId);
  if(!b || !t) return;
  b.notebookId = t.notebookId;
  b.pinned = !!t.pinned;   // land in the same (pinned/unpinned) group as the target
  // build the target notebook's current order, drop b out, reinsert by target
  const group = boardsInNotebook(t.notebookId).filter(x=>x.id!==pageId);
  let idx = group.findIndex(x=>x.id===targetId);
  if(below) idx += 1;
  group.splice(idx, 0, b);
  group.forEach((x,i)=>{ x.order = i; });
  renderBoardList(); queueIndexSave();
}

export function togglePin(pageId){
  const b = state.boards.find(x=>x.id===pageId);
  if(!b) return;
  b.pinned = !b.pinned;
  renumberNotebook(b.notebookId);
  renderBoardList(); queueIndexSave();
  showToast(b.pinned ? "Pinned to top" : "Unpinned");
}

export function startRenameNotebook(id){
  const nb = state.notebooks.find(n=>n.id===id);
  if(!nb) return;
  const nameEl = treeEl().querySelector('.nb[data-nb="'+id+'"] .nb-name');
  if(!nameEl) return;
  nameEl.innerHTML = '<input value="'+escapeAttr(nb.name||"")+'">';
  const input = nameEl.querySelector("input");
  input.focus(); input.select();
  function commit(){ nb.name = input.value.trim() || "Notebook"; renderBoardList(); queueIndexSave(); }
  input.addEventListener("blur", commit);
  input.addEventListener("keydown",(e)=>{ if(e.key==="Enter") input.blur(); if(e.key==="Escape"){ input.value=nb.name; input.blur(); } });
  input.addEventListener("click",e=>e.stopPropagation());
}

export function newNotebook(){
  const nb = { id:"nb_"+uid().slice(0,8), name:"New Notebook", collapsed:false };
  state.notebooks.push(nb);
  renderBoardList(); queueIndexSave();
  startRenameNotebook(nb.id);
}

export async function deleteNotebook(id){
  if(state.notebooks.length===1){ showToast("Keep at least one notebook"); return; }
  const pages = boardsInNotebook(id);
  const nb = state.notebooks.find(n=>n.id===id);
  let msg = "";
  if(pages.length){
    const other = state.notebooks.find(n=>n.id!==id);
    msg = "Its "+pages.length+" page(s) will move to \""+other.name+"\". (To delete the pages too, remove them first.)";
  }
  const ok = await confirmModal({ title:'Delete notebook "'+(nb?nb.name:"")+'"?', message:msg });
  if(!ok) return;
  const fallback = state.notebooks.find(n=>n.id!==id).id;
  pages.forEach(b=>b.notebookId=fallback);
  state.notebooks = state.notebooks.filter(n=>n.id!==id);
  persistDeleteNotebook(id);
  renderBoardList(); queueIndexSave();
}

export function startRenameBoard(id, itemEl){
  const b = state.boards.find(x=>x.id===id);
  itemEl.innerHTML = '<input value="'+escapeAttr(b.name||"")+'">';
  const input = itemEl.querySelector("input");
  input.focus(); input.select();
  function commit(){
    b.name = input.value.trim() || "Untitled";
    renderBoardList();
    if(id===state.currentBoardId) el("boardTitle").value = b.name;
    queueIndexSave();
  }
  input.addEventListener("blur", commit);
  input.addEventListener("keydown",(e)=>{ if(e.key==="Enter") input.blur(); });
  input.addEventListener("click",e=>e.stopPropagation());
}

export function switchBoard(id){
  if(id===state.currentBoardId) return;
  state.currentBoardId = id; state.selection.clear(); state.selectedConnId=null;
  renderBoardList(); renderBoardHeader(); centerView(); renderBoard();
  historyReset(id);
}

export function newBoard(nbId){
  if(!nbId || !state.notebooks.some(n=>n.id===nbId)){
    const cur = getBoard();
    nbId = (cur && cur.notebookId) || state.notebooks[0].id;
  }
  const id = uid();
  state.boards.push({id, name:"Untitled page", description:"", notebookId:nbId, order:boardsInNotebook(nbId).length, pinned:false});
  state.boardsData[id] = {nodes:[],connections:[]};
  const nb = state.notebooks.find(n=>n.id===nbId); if(nb) nb.collapsed=false;
  state.currentBoardId = id;
  renderBoardList(); renderBoardHeader(); centerView(); renderBoard(); queueIndexSave();
  historyReset(id);
  el("boardTitle").focus();
}

/** Delete one or more pages together, with one confirmation and one save.
 *  Used both for a single page (from the context menu or its own delete
 *  button) and for a multi-selection (the "Delete N pages" bar). */
async function deleteBoards(ids){
  if(!ids.length) return;
  if(ids.length >= state.boards.length){
    showToast(ids.length===1 ? "Can't delete your only page" : "Can't delete all your pages — keep at least one");
    return;
  }
  const ok = await confirmModal({
    title: ids.length===1 ? "Delete this page?" : "Delete "+ids.length+" pages?",
    message: (ids.length===1 ? "Everything on it" : "Everything on them")+" will be lost. This can't be undone."
  });
  if(!ok) return;
  const idSet = new Set(ids);
  const affectedNotebooks = new Set();
  ids.forEach(id=>{
    const b = state.boards.find(x=>x.id===id);
    if(b) affectedNotebooks.add(b.notebookId);
    delete state.boardsData[id];
    persistDeleteBoard(id);
  });
  state.boards = state.boards.filter(b=>!idSet.has(b.id));
  affectedNotebooks.forEach(nbId=>{ if(nbId) renumberNotebook(nbId); });
  if(idSet.has(state.currentBoardId)) state.currentBoardId = state.boards[0].id;
  selectedBoardIds.clear();
  lastClickedBoardId = null;
  renderBoardList(); renderBoardHeader(); centerView(); renderBoard(); queueIndexSave();
}

/* A page that's part of an active multi-selection deletes the whole
   selection, whichever page in it triggered the delete (context menu, its
   own button, or the bar) -- otherwise just itself. */
export function deleteBoard(id){
  const ids = (selectedBoardIds.size>=2 && selectedBoardIds.has(id)) ? [...selectedBoardIds] : [id];
  return deleteBoards(ids);
}

/* Deep-copy a whole page (all blocks + connections) into the same notebook,
   placed right after the original. Node ids are regenerated and connections
   rewired to the new ids so nothing points back at the source page. */
export function duplicatePage(id){
  const src = state.boards.find(b=>b.id===id);
  if(!src) return;
  const data = state.boardsData[id] || {nodes:[], connections:[]};
  const idMap = {};
  const newNodes = (data.nodes||[]).map(n=>{
    const copy = JSON.parse(JSON.stringify(n));
    copy.id = uid(); idMap[n.id] = copy.id;
    return copy;
  });
  const newConns = (data.connections||[]).map(c=>{
    const copy = JSON.parse(JSON.stringify(c));
    copy.id = uid();
    copy.from = idMap[c.from] || c.from;
    copy.to = idMap[c.to] || c.to;
    return copy;
  });
  const newId = uid();
  state.boards.push({ id:newId, name:(src.name||"Untitled")+" copy", description:src.description||"",
    notebookId:src.notebookId, order:(src.order||0)+0.5, pinned:false });
  state.boardsData[newId] = { nodes:newNodes, connections:newConns };
  renumberNotebook(src.notebookId);
  state.currentBoardId = newId;
  renderBoardList(); renderBoardHeader(); centerView(); renderBoard(); queueIndexSave(); saveBoardNow(newId);
  historyReset(newId);
  showToast("Page duplicated");
}

export function renderBoardHeader(){
  const b = getBoard();
  el("boardTitle").value = b.name || "";
  el("boardDesc").value = b.description || "";
}

/* Wire the page header fields and the sidebar buttons. */
export function initSidebar(){
  el("boardTitle").addEventListener("input",(e)=>{ getBoard().name=e.target.value; renderBoardList(); queueIndexSave(); });
  el("boardDesc").addEventListener("input",(e)=>{ getBoard().description=e.target.value; queueIndexSave(); });
  el("newBoardBtn").addEventListener("click", ()=>newBoard());
  el("newNotebookBtn").addEventListener("click", newNotebook);
  el("favHead").addEventListener("click", ()=>{
    favCollapsed = !favCollapsed;
    el("favWrap").classList.toggle("collapsed", favCollapsed);
  });
  el("multiSelectDeleteBtn").addEventListener("click", ()=>{ deleteBoards([...selectedBoardIds]); });
  el("multiSelectClearBtn").addEventListener("click", clearMultiSelect);
}
