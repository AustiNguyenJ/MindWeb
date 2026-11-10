import { el } from "./dom.js";
import { state } from "./state.js";
import { uid, escapeHtml, escapeAttr } from "./util.js";
import { showToast } from "./toast.js";
import { getBoard, boardsInNotebook, renumberNotebook, notebooksInParent, renumberNotebooksInParent, isNotebookDescendant } from "./boards.js";
import { openPageMenu } from "./pageMenu.js";
import { openNotebookMenu } from "./notebookMenu.js";
import { renderSwitcher, initSwitcher } from "./notebookSwitcher.js";
import { centerView } from "./view.js";
import { renderBoard } from "./render.js";
import { historyReset } from "./history.js";
import { queueIndexSave, persistDeleteBoard, persistDeleteNotebook, saveBoardNow } from "./storage.js";
import { confirmModal } from "./confirmModal.js";
import { renderQuickAccessToolbar } from "./toolbar.js";
import { isBoardReady, ensureBoardLoaded, rememberBoard } from "./pageLoader.js";

/* The sidebar, in focus mode. It shows one notebook's level at a time rather
   than the whole nested tree: a breadcrumb up the chain, that notebook's
   direct sub-notebooks as compact rows, and its pages (pinned first, then by
   sort order). Clicking a sub-notebook row, a breadcrumb, or an entry in the
   notebook switcher (notebookSwitcher.js) changes which notebook is viewed.
   Pages can be dragged to reorder, or dropped onto a sub-notebook row or an
   ancestor crumb to move; "Move to..." in the page and notebook menus covers
   every notebook that is off screen. */

/* ---------- which notebook is being viewed ------------------------------
   Purely a view concern: nothing here is stored, and navigating never
   touches state.notebooks / state.boards or queues a save. The view starts
   on the open page's notebook and follows the open page whenever that
   changes (a click, a search jump, a favorite, a new or deleted page...) --
   syncView() notices by comparing against the page it last followed, so
   every path that changes currentBoardId is covered as long as it re-renders
   the list, which it must anyway to move the highlight. */
let viewNotebookId = null;
let followedBoardId = null;
let filterText = "";

export const getViewNotebookId = () => viewNotebookId;

const notebookById = (id)=>state.notebooks.find(n=>n.id===id);

/* Root first, nbId last. */
export function ancestorChain(nbId){
  const chain = [];
  const seen = new Set();
  let cur = notebookById(nbId);
  while(cur && !seen.has(cur.id)){
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.parentId ? notebookById(cur.parentId) : null;
  }
  return chain;
}

/* nbId followed by every notebook nested anywhere beneath it, depth-first in
   sibling order. */
export function notebookSubtree(nbId, out = []){
  out.push(nbId);
  notebooksInParent(nbId).forEach(c=>notebookSubtree(c.id, out));
  return out;
}

/* Pages per notebook, counting only the pages directly inside it. */
function directPageCounts(){
  const counts = new Map();
  state.boards.forEach(b=>counts.set(b.notebookId, (counts.get(b.notebookId)||0)+1));
  return counts;
}

function resetFilter(){
  filterText = "";
  const input = el("pageFilter");
  if(input) input.value = "";
  const clear = el("pageFilterClear");
  if(clear) clear.hidden = true;
}

function syncView(){
  const cur = getBoard();
  if(state.currentBoardId!==followedBoardId){
    followedBoardId = state.currentBoardId;
    if(cur){
      // while filtering, the list already spans the whole subtree: a page
      // opened from those results stays in view instead of yanking the
      // list down to its own notebook
      const visibleInFilter = filterText && notebookById(viewNotebookId) && notebookSubtree(viewNotebookId).includes(cur.notebookId);
      if(!visibleInFilter){ viewNotebookId = cur.notebookId; resetFilter(); }
    }
  }
  if(!notebookById(viewNotebookId)){
    // the viewed notebook is gone (deleted, or replaced by a load/import)
    viewNotebookId = cur ? cur.notebookId : (notebooksInParent(null)[0] || state.notebooks[0]).id;
  }
}

/* Change which notebook the sidebar shows, without opening a page. */
export function viewNotebook(id){
  if(!notebookById(id)) return;
  viewNotebookId = id;
  resetFilter();
  renderBoardList();
}

/* ---------- multi-select (for bulk-deleting pages) ---------------------
   Local to this module, like the designer's selected-type or the picker's
   filter -- nothing outside the sidebar needs to know which pages are
   multi-selected. Plain click always means "open this page" and clears the
   selection; Ctrl/Cmd-click toggles a page in or out of it; Shift-click
   extends it as a range over the currently rendered page order. A selection
   never outlives its rows: whatever the list stops showing (another
   notebook, a filter, a move) drops out of it, so the bulk-delete bar can
   only ever act on pages the user can see. */
let selectedBoardIds = new Set();
let lastClickedBoardId = null;
let visibleBoardIds = new Set();

function pruneSelection(){
  for(const id of selectedBoardIds) if(!visibleBoardIds.has(id)) selectedBoardIds.delete(id);
  const live = new Set(state.boards.map(b=>b.id));
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

/* The pages an action on one page applies to: the whole selection when that
   page is part of an active multi-selection, otherwise just itself. */
export function pagesForAction(pageId){
  return (selectedBoardIds.size>=2 && selectedBoardIds.has(pageId)) ? [...selectedBoardIds] : [pageId];
}

function sortByCurrentOrder(ids){
  return ids.map(id=>state.boards.find(b=>b.id===id)).filter(Boolean)
    .sort((a,b)=>a.order-b.order);
}

/* Shared by the sub-notebook rows, the ancestor crumbs and "Move to...": move
   one or more pages into a notebook, appended after its existing pages,
   preserving the moved pages' relative order among themselves. Returns false
   (no-op) if every id was already in that notebook. */
function movePagesToNotebook(ids, nbId){
  const nb = notebookById(nbId);
  if(!nb) return false;
  const moving = sortByCurrentOrder(ids).filter(b=>b.notebookId!==nbId);
  if(!moving.length) return false;
  const base = boardsInNotebook(nbId).length;
  moving.forEach((b,i)=>{ b.notebookId = nbId; b.order = base+i; });
  renumberNotebook(nbId);
  renderBoardList(); queueIndexSave();
  return true;
}

/* "Move to..." on a page: the whole selection moves if the page is part of one. */
export function movePageTo(pageId, nbId){
  const ids = pagesForAction(pageId);
  const nb = notebookById(nbId);
  if(!nb || !movePagesToNotebook(ids, nbId)) return;
  selectedBoardIds.clear(); lastClickedBoardId = null;
  renderBoardList();
  showToast((ids.length>1 ? "Moved "+ids.length+" pages" : "Moved page")+" to “"+(nb.name||"Notebook")+"”");
}

/* Like reorderPage(), but for a whole multi-selected group dragged onto a
   target page: the group moves as a contiguous block, in its current
   relative order, immediately before/after the target. */
function reorderPageGroup(ids, targetId, below){
  const t = state.boards.find(x=>x.id===targetId);
  if(!t) return false;
  const moveIds = new Set(ids.filter(id=>id!==targetId));
  if(!moveIds.size) return false;
  const moving = sortByCurrentOrder([...moveIds]);
  moving.forEach(b=>{ b.notebookId = t.notebookId; b.pinned = !!t.pinned; });
  const group = boardsInNotebook(t.notebookId).filter(x=>!moveIds.has(x.id));
  let idx = group.findIndex(x=>x.id===targetId);
  if(below) idx += 1;
  group.splice(idx, 0, ...moving);
  group.forEach((x,i)=>{ x.order = i; });
  renderBoardList(); queueIndexSave();
  return true;
}

/* ---------- sidebar ---------- */
export const treeEl = () => el("notebookTree");

const FOLDER_ICON = '<svg class="sub-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const CHEVRON_ICON = '<svg class="sub-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m9 6 6 6-6 6"/></svg>';

/* The pages on screen, as {b, nb}. Normally the viewed notebook's own pages;
   with a filter, every page in its whole subtree whose name matches, with nb
   set for the ones that live in a sub-notebook so the row can say where. */
function visiblePages(){
  if(!filterText) return boardsInNotebook(viewNotebookId).map(b=>({b, nb:null}));
  const q = filterText.toLowerCase();
  const out = [];
  notebookSubtree(viewNotebookId).forEach(nbId=>{
    boardsInNotebook(nbId).forEach(b=>{
      if((b.name||"Untitled").toLowerCase().includes(q)) out.push({b, nb: nbId===viewNotebookId ? null : notebookById(nbId)});
    });
  });
  return out;
}

function pageRowHtml({b, nb}, draggable){
  return '<div class="board-item '+(b.id===state.currentBoardId?'active':'')+(b.pinned?' pinned':'')+
      (selectedBoardIds.has(b.id)?' multi-selected':'')+'" tabindex="0"'+(draggable?' draggable="true"':'')+
      (b.id===state.currentBoardId?' aria-current="page"':'')+' data-id="'+b.id+'" data-fk="p:'+b.id+'">' +
    (b.pinned?'<span class="pin-ico" title="Pinned">★</span>':'') +
    '<span class="bname">'+escapeHtml(b.name||"Untitled")+'</span>' +
    (nb ? '<span class="bnb" title="In notebook “'+escapeAttr(nb.name||"Notebook")+'”">'+escapeHtml(nb.name||"Notebook")+'</span>' : '') +
    '<button class="board-menu-btn" data-id="'+b.id+'" data-fk="pm:'+b.id+'" title="Page options">⋯</button></div>';
}

function subRowHtml(nb, directCounts){
  const subs = notebooksInParent(nb.id).length;
  const total = notebookSubtree(nb.id).reduce((n,id)=>n+(directCounts.get(id)||0), 0);
  const tip = total+" page"+(total===1?"":"s")+(subs ? " · "+subs+" sub-notebook"+(subs===1?"":"s") : "");
  return '<div class="sub-row" tabindex="0" draggable="true" data-nb="'+nb.id+'" data-fk="n:'+nb.id+'" title="'+escapeAttr(tip)+'">' +
    FOLDER_ICON +
    '<span class="sub-name">'+escapeHtml(nb.name||"Notebook")+'</span>' +
    '<span class="sub-count">'+total+'</span>' +
    '<button type="button" class="sub-menu-btn" data-nb="'+nb.id+'" data-fk="nm:'+nb.id+'" title="Notebook options">⋯</button>' +
    CHEVRON_ICON +
  '</div>';
}

function renderCrumbs(){
  const box = el("nbCrumbs");
  if(!box) return;
  const chain = ancestorChain(viewNotebookId);
  box.innerHTML = chain.map((nb,i)=> i===chain.length-1
    ? '<span class="crumb current" tabindex="-1" aria-current="location" data-fk="cc" title="Double-click to rename">'+escapeHtml(nb.name||"Notebook")+'</span>' +
      '<button type="button" class="crumb-menu" data-fk="cm" title="Notebook options" aria-label="Notebook options">⋯</button>'
    : '<button type="button" class="crumb" data-nb="'+nb.id+'" data-fk="c:'+nb.id+'" title="Go to “'+escapeAttr(nb.name||"Notebook")+'”">'+escapeHtml(nb.name||"Notebook")+'</button>' +
      '<span class="crumb-sep" aria-hidden="true">›</span>'
  ).join('');

  box.querySelectorAll(".crumb[data-nb]").forEach(crumb=>{
    const nbId = crumb.dataset.nb;
    crumb.addEventListener("click",()=>viewNotebook(nbId));
    // an ancestor is also a drop target: the way to lift a page or a
    // sub-notebook out of the notebook being viewed
    crumb.addEventListener("dragover",(e)=>{
      if(!e.dataTransfer.types.includes("text/plain") && !e.dataTransfer.types.includes("application/x-notebook")) return;
      e.preventDefault(); e.dataTransfer.dropEffect = "move";
      crumb.classList.add("drop-into");
    });
    crumb.addEventListener("dragleave",()=>crumb.classList.remove("drop-into"));
    crumb.addEventListener("drop",(e)=>{
      e.preventDefault();
      crumb.classList.remove("drop-into");
      dropOntoNotebook(e, nbId);
    });
  });
  const current = box.querySelector(".crumb.current");
  if(current){
    current.addEventListener("dblclick",()=>startRenameNotebook(viewNotebookId));
    current.addEventListener("contextmenu",(e)=>{ e.preventDefault(); openNotebookMenu(viewNotebookId, e.clientX, e.clientY); });
  }
  const menuBtn = box.querySelector(".crumb-menu");
  if(menuBtn) menuBtn.addEventListener("click",()=>{
    const r = menuBtn.getBoundingClientRect();
    openNotebookMenu(viewNotebookId, r.right, r.bottom);
  });
}

/* A page or sub-notebook dropped onto a notebook (a row or a crumb). */
function dropOntoNotebook(e, nbId){
  const draggedNbId = e.dataTransfer.getData("application/x-notebook");
  if(draggedNbId){ nestNotebook(draggedNbId, nbId); return; }
  const groupRaw = e.dataTransfer.getData("application/x-page-ids");
  const ids = groupRaw ? JSON.parse(groupRaw) : [e.dataTransfer.getData("text/plain")];
  if(movePagesToNotebook(ids, nbId) && groupRaw){
    selectedBoardIds.clear(); lastClickedBoardId = null;
    renderBoardList();
  }
}

/* Keyboard for a row (page or sub-notebook): Enter/Space activates, the
   arrows walk the list, and the Menu key / Shift+F10 opens its menu. Only
   acts on the row itself, never on a rename input or button inside it. */
function rowKeydown(e, activate, openMenu){
  if(e.target!==e.currentTarget) return;
  if(e.key==="Enter" || e.key===" "){ e.preventDefault(); activate(e); }
  else if(e.key==="ArrowDown" || e.key==="ArrowUp"){
    e.preventDefault();
    const rows = [...treeEl().querySelectorAll(".sub-row,.board-item")];
    const next = rows[rows.indexOf(e.currentTarget) + (e.key==="ArrowDown" ? 1 : -1)];
    if(next) next.focus();
  }
  else if(e.key==="ContextMenu" || (e.key==="F10" && e.shiftKey)){
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    openMenu(r.left+16, r.bottom);
  }
}

function wireSubRow(row){
  const nbId = row.dataset.nb;
  row.addEventListener("click",(e)=>{
    if(e.target.closest(".sub-menu-btn")) return;
    viewNotebook(nbId);
  });
  row.addEventListener("dblclick",(e)=>{ if(!e.target.closest(".sub-menu-btn")) startRenameNotebook(nbId); });
  row.addEventListener("keydown",(e)=>rowKeydown(e, ()=>viewNotebook(nbId), (x,y)=>openNotebookMenu(nbId, x, y)));
  row.addEventListener("contextmenu",(e)=>{ e.preventDefault(); e.stopPropagation(); openNotebookMenu(nbId, e.clientX, e.clientY); });
  row.querySelector(".sub-menu-btn").addEventListener("click",(e)=>{
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    openNotebookMenu(nbId, r.right, r.bottom);
  });
  row.addEventListener("dragstart",(e)=>{
    e.stopPropagation();
    e.dataTransfer.setData("application/x-notebook", nbId);
    e.dataTransfer.effectAllowed = "move";
    row.classList.add("dragging");
  });
  row.addEventListener("dragend",(e)=>{
    e.stopPropagation();
    row.classList.remove("dragging");
    clearDropMarks();
  });
  // dragging a notebook over another's row: top/bottom edge reorders as a
  // sibling, the middle band nests it inside. Dragging a page here moves
  // the page into the notebook.
  row.addEventListener("dragover",(e)=>{
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    clearDropMarks();
    if(e.dataTransfer.types.includes("application/x-notebook")){
      const r = row.getBoundingClientRect();
      const frac = (e.clientY - r.top) / r.height;
      if(frac < 0.25) row.classList.add("sub-drop-above");
      else if(frac > 0.75) row.classList.add("sub-drop-below");
      else row.classList.add("drop-into");
    } else {
      row.classList.add("drop-into");
    }
  });
  row.addEventListener("dragleave",()=>{
    row.classList.remove("drop-into","sub-drop-above","sub-drop-below");
  });
  row.addEventListener("drop",(e)=>{
    e.preventDefault(); e.stopPropagation();
    const above = row.classList.contains("sub-drop-above");
    const below = row.classList.contains("sub-drop-below");
    clearDropMarks();
    const draggedNbId = e.dataTransfer.getData("application/x-notebook");
    if(draggedNbId && (above || below)){ reorderNotebook(draggedNbId, nbId, below); return; }
    dropOntoNotebook(e, nbId);
  });
}

function wirePageRow(item, host){
  // pages: click to open, dbl-click to rename, menu button, drag to move/reorder
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
  item.addEventListener("keydown",(e)=>rowKeydown(e, ()=>{
    selectedBoardIds.clear();
    lastClickedBoardId = item.dataset.id;
    switchBoard(item.dataset.id);
  }, (x,y)=>openPageMenu(item.dataset.id, x, y)));
  item.addEventListener("contextmenu",(e)=>{ e.preventDefault(); openPageMenu(item.dataset.id, e.clientX, e.clientY); });
  item.addEventListener("dragstart",(e)=>{
    const id = item.dataset.id;
    if(selectedBoardIds.has(id) && selectedBoardIds.size>1){
      e.dataTransfer.setData("application/x-page-ids", JSON.stringify([...selectedBoardIds]));
      host.querySelectorAll(".board-item").forEach(x=>{ if(selectedBoardIds.has(x.dataset.id)) x.classList.add("dragging"); });
    } else {
      item.classList.add("dragging");
    }
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed="move";
  });
  item.addEventListener("dragend",()=>{
    host.querySelectorAll(".board-item.dragging").forEach(x=>x.classList.remove("dragging"));
    clearDropMarks();
  });
  // reordering: dropping ONTO another page inserts relative to it
  item.addEventListener("dragover",(e)=>{
    if(e.dataTransfer.types.includes("application/x-notebook")) return;
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
    reorderPage(e, item.dataset.id, below);
  });
  item.querySelector(".board-menu-btn").addEventListener("click",(e)=>{
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    openPageMenu(item.dataset.id, r.right, r.bottom);
  });
}

function renderLevel(host){
  const filtering = !!filterText;
  const subs = filtering ? [] : notebooksInParent(viewNotebookId);
  const rows = visiblePages();
  visibleBoardIds = new Set(rows.map(r=>r.b.id));
  const directCounts = subs.length ? directPageCounts() : null;

  const pagesHtml = rows.length
    // a filtered list spans several notebooks, so there is no one order to drag within
    ? rows.map(r=>pageRowHtml(r, !filtering)).join('')
    : '<div class="nb-emptypages'+(filtering?' no-match':'')+'">'+(filtering ? 'No pages match' : 'No pages yet')+'</div>';
  host.innerHTML =
    (subs.length ? '<div class="lv-label">Notebooks</div>' + subs.map(nb=>subRowHtml(nb, directCounts)).join('') + '<div class="lv-label">Pages</div>' : '') +
    pagesHtml;

  host.querySelectorAll(".sub-row").forEach(wireSubRow);
  host.querySelectorAll(".board-item").forEach(item=>wirePageRow(item, host));
}

function updateNewButtons(){
  const nb = notebookById(viewNotebookId);
  const name = nb ? (nb.name||"Notebook") : "";
  const page = el("newBoardBtn"), sub = el("newNotebookBtn");
  if(page) page.title = 'New page in “'+name+'”';
  if(sub) sub.title = 'New sub-notebook in “'+name+'”';
}

export function renderBoardList(){
  syncView();
  const host = treeEl();
  if(!host) return;

  // Re-rendering replaces the row that has keyboard focus. Remember it, and
  // put focus back on its replacement -- or, when the row is gone (drilled
  // into a notebook, deleted, moved), on the nearest sensible thing.
  const prev = document.activeElement;
  const focusKey = (prev && prev.closest && prev.closest("#notebookTree,#nbCrumbs")) ? prev.dataset.fk : null;

  renderSwitcher();
  renderCrumbs();
  renderLevel(host);
  updateNewButtons();
  updateMultiSelectBar();

  if(focusKey){
    const target = el("listWrap").querySelector('[data-fk="'+focusKey+'"]')
      || (focusKey.charAt(0)==="c" ? el("nbCrumbs").querySelector(".crumb.current") : host.querySelector(".sub-row,.board-item"));
    if(target) target.focus();
  }
}

export function clearDropMarks(){
  const root = el("listWrap");
  root.querySelectorAll(".board-item.drop-above,.board-item.drop-below")
    .forEach(x=>x.classList.remove("drop-above","drop-below"));
  root.querySelectorAll(".drop-into")
    .forEach(x=>x.classList.remove("drop-into"));
  root.querySelectorAll(".sub-row.sub-drop-above,.sub-row.sub-drop-below")
    .forEach(x=>x.classList.remove("sub-drop-above","sub-drop-below"));
}

/* Move a page next to a target page. If they're in different notebooks the
   dragged page joins the target's notebook. Pinned status follows the target
   so you can reorder within the pinned group or the unpinned group. */
export function reorderPage(e, targetId, below){
  const groupRaw = e.dataTransfer.getData("application/x-page-ids");
  if(groupRaw && reorderPageGroup(JSON.parse(groupRaw), targetId, below)){
    selectedBoardIds.clear(); lastClickedBoardId = null;
    renderBoardList();
    return;
  }
  const pageId = e.dataTransfer.getData("text/plain");
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

/* Move a notebook next to a sibling notebook (the target keeps its own
   parent, and the dragged notebook adopts it). Refuses to drop a notebook
   onto one of its own descendants, which would otherwise disconnect that
   whole subtree from the tree. */
export function reorderNotebook(draggedId, targetId, below){
  if(draggedId===targetId) return;
  const d = notebookById(draggedId);
  const t = notebookById(targetId);
  if(!d || !t) return;
  if(isNotebookDescendant(draggedId, targetId)){ showToast("Can't move a notebook into one of its own sub-notebooks"); return; }
  d.parentId = t.parentId;
  const group = notebooksInParent(t.parentId).filter(x=>x.id!==draggedId);
  let idx = group.findIndex(x=>x.id===targetId);
  if(below) idx += 1;
  group.splice(idx, 0, d);
  group.forEach((x,i)=>{ x.order = i; });
  renderBoardList(); queueIndexSave();
}

/* Nest a notebook inside another, appended after its existing children. */
export function nestNotebook(draggedId, targetId){
  if(draggedId===targetId) return false;
  const d = notebookById(draggedId);
  if(!d) return false;
  if(isNotebookDescendant(draggedId, targetId)){ showToast("Can't move a notebook into one of its own sub-notebooks"); return false; }
  d.order = notebooksInParent(targetId).length;   // after the siblings, not tied with one of them
  d.parentId = targetId;
  renumberNotebooksInParent(targetId);
  renderBoardList(); queueIndexSave();
  return true;
}

/* Pull a notebook back out to the top level, dropped at the end. */
export function moveNotebookToRoot(draggedId){
  const d = notebookById(draggedId);
  if(!d || !d.parentId) return false;
  d.order = notebooksInParent(null).length;
  d.parentId = null;
  renumberNotebooksInParent(null);
  renderBoardList(); queueIndexSave();
  return true;
}

/* "Move to..." on a notebook; a null parent means the top level. */
export function moveNotebookTo(nbId, parentId){
  const done = parentId ? nestNotebook(nbId, parentId) : moveNotebookToRoot(nbId);
  if(!done) return;
  const nb = notebookById(nbId), dest = parentId ? notebookById(parentId) : null;
  showToast("Moved “"+(nb.name||"Notebook")+"” to "+(dest ? "“"+(dest.name||"Notebook")+"”" : "the top level"));
}

export function togglePin(pageId){
  const b = state.boards.find(x=>x.id===pageId);
  if(!b) return;
  b.pinned = !b.pinned;
  renumberNotebook(b.notebookId);
  renderBoardList(); queueIndexSave();
  showToast(b.pinned ? "Pinned to top" : "Unpinned");
}

/* A notebook is renamed in place: in its row when it is a sub-notebook of the
   one being viewed, or in the last breadcrumb when it is the one being viewed. */
export function startRenameNotebook(id){
  const nb = notebookById(id);
  if(!nb) return;
  const nameEl = treeEl().querySelector('.sub-row[data-nb="'+id+'"] .sub-name')
    || (id===viewNotebookId ? el("nbCrumbs").querySelector(".crumb.current") : null);
  if(!nameEl) return;
  nameEl.innerHTML = '<input value="'+escapeAttr(nb.name||"")+'">';
  const input = nameEl.querySelector("input");
  input.focus(); input.select();
  function commit(){ nb.name = input.value.trim() || "Notebook"; renderBoardList(); queueIndexSave(); }
  input.addEventListener("blur", commit);
  input.addEventListener("keydown",(e)=>{ if(e.key==="Enter") input.blur(); if(e.key==="Escape"){ input.value=nb.name; input.blur(); } });
  input.addEventListener("click",e=>e.stopPropagation());
  input.addEventListener("dblclick",e=>e.stopPropagation());
}

/* No argument: a sub-notebook of the one being viewed. A parent id: a
   sub-notebook of that one. null: a new top-level notebook. The sidebar then
   shows the new notebook -- as a row to rename in its parent's level, or, for
   a top-level one, by moving into it. */
export function newNotebook(parentId){
  const pid = parentId===undefined ? viewNotebookId : (parentId || null);
  const nb = { id:"nb_"+uid().slice(0,8), name:"New Notebook", collapsed:false, parentId:pid, order:notebooksInParent(pid).length };
  state.notebooks.push(nb);
  viewNotebookId = pid || nb.id;
  resetFilter();
  renderBoardList(); queueIndexSave();
  startRenameNotebook(nb.id);
}

/* Deleting a notebook never deletes its contents: its pages move up to its
   parent (or another top-level notebook, if it had none), and any nested
   sub-notebooks are promoted to sit where it was, one level up. If it was the
   notebook being viewed, the view moves up with them. */
export async function deleteNotebook(id){
  if(state.notebooks.length===1){ showToast("Keep at least one notebook"); return; }
  const pages = boardsInNotebook(id);
  const children = notebooksInParent(id);
  const nb = notebookById(id);
  const parts = [];
  if(pages.length) parts.push(pages.length+" page(s)");
  if(children.length) parts.push(children.length+" sub-notebook(s)");
  const msg = parts.length ? "Its "+parts.join(" and ")+" will move up a level. (To delete them too, remove them first.)" : "";
  const ok = await confirmModal({ title:'Delete notebook "'+(nb?nb.name:"")+'"?', message:msg });
  if(!ok) return;
  const parentStillValid = nb.parentId && state.notebooks.some(n=>n.id===nb.parentId);
  const fallback = parentStillValid ? nb.parentId
    : (notebooksInParent(null).find(n=>n.id!==id) || state.notebooks.find(n=>n.id!==id)).id;
  pages.forEach(b=>b.notebookId=fallback);
  children.forEach(c=>{ c.parentId = nb.parentId; });
  state.notebooks = state.notebooks.filter(n=>n.id!==id);
  if(viewNotebookId===id) viewNotebookId = fallback;
  renumberNotebook(fallback);
  renumberNotebooksInParent(nb.parentId);
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

/* The page the user last asked for. A page still being fetched opens when it
   arrives -- unless they have clicked somewhere else in the meantime. */
let wantedBoardId = null;

export function switchBoard(id){
  if(id===state.currentBoardId) return;
  if(!isBoardReady(id)){
    wantedBoardId = id;
    const b = state.boards.find(x=>x.id===id);
    showToast("Loading “"+((b && b.name) || "page")+"”…");
    ensureBoardLoaded(id).then(ok=>{
      if(wantedBoardId!==id) return;
      if(ok) switchBoard(id);
      else showToast("Couldn't load that page — try again");
    });
    return;
  }
  wantedBoardId = null;
  state.currentBoardId = id; state.selection.clear(); state.selectedConnId=null;
  renderBoardList(); renderBoardHeader(); centerView(); renderBoard();
  historyReset(id);
}

/* A new page goes into the notebook being viewed, unless one is named. */
export function newBoard(nbId){
  if(!nbId || !notebookById(nbId)){
    const cur = getBoard();
    nbId = notebookById(viewNotebookId) ? viewNotebookId : ((cur && cur.notebookId) || state.notebooks[0].id);
  }
  const id = uid();
  state.boards.push({id, name:"Untitled page", description:"", notebookId:nbId, order:boardsInNotebook(nbId).length, pinned:false});
  state.boardsData[id] = {nodes:[],connections:[]};
  state.currentBoardId = id;
  resetFilter();   // the new page would otherwise be hidden by a filter it doesn't match
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
    state.pendingBoards.delete(id); state.failedBoards.delete(id);
    persistDeleteBoard(id);
  });
  state.boards = state.boards.filter(b=>!idSet.has(b.id));
  affectedNotebooks.forEach(nbId=>{ if(nbId) renumberNotebook(nbId); });
  if(idSet.has(state.currentBoardId)){
    // land on a page that is actually loaded, fetching one if need be
    const next = state.boards.find(b=>isBoardReady(b.id)) || state.boards[0];
    if(!isBoardReady(next.id)) await ensureBoardLoaded(next.id);
    state.currentBoardId = next.id;
  }
  selectedBoardIds.clear();
  lastClickedBoardId = null;
  renderBoardList(); renderBoardHeader(); centerView(); renderBoard(); queueIndexSave();
}

/* A page that's part of an active multi-selection deletes the whole
   selection, whichever page in it triggered the delete (context menu, its
   own button, or the bar) -- otherwise just itself. */
export function deleteBoard(id){
  return deleteBoards(pagesForAction(id));
}

/* Deep-copy a whole page (all blocks + connections) into the same notebook,
   placed right after the original. Node ids are regenerated and connections
   rewired to the new ids so nothing points back at the source page. */
export function duplicatePage(id){
  const src = state.boards.find(b=>b.id===id);
  if(!src) return;
  if(!isBoardReady(id)){ showToast("That page is still loading — try again in a moment"); return; }
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
  rememberBoard(state.currentBoardId);   // what to open first next time
  const b = getBoard();
  el("boardTitle").value = b.name || "";
  el("boardDesc").value = b.description || "";
  // the quick-access bar/hotkeys can differ per board (see toolbarConfig.js),
  // so refresh it whenever the current board changes -- every board-switch
  // path already calls this function right after updating currentBoardId
  renderQuickAccessToolbar();
}

/* Wire the page header fields and the sidebar buttons. */
export function initSidebar(){
  el("boardTitle").addEventListener("input",(e)=>{ getBoard().name=e.target.value; renderBoardList(); queueIndexSave(); });
  el("boardDesc").addEventListener("input",(e)=>{ getBoard().description=e.target.value; queueIndexSave(); });
  el("newBoardBtn").addEventListener("click", ()=>newBoard());
  el("newNotebookBtn").addEventListener("click", ()=>newNotebook());
  el("multiSelectDeleteBtn").addEventListener("click", ()=>{ deleteBoards([...selectedBoardIds]); });
  el("multiSelectClearBtn").addEventListener("click", clearMultiSelect);

  // the page filter is not the global search (search.js): it only narrows
  // the list below it, and is not remembered
  const filter = el("pageFilter");
  filter.addEventListener("input",()=>{
    filterText = filter.value.trim();
    el("pageFilterClear").hidden = !filter.value;
    renderBoardList();
  });
  filter.addEventListener("keydown",(e)=>{
    if(e.key!=="Escape" || !filter.value) return;
    // clears the filter and nothing else -- the canvas selection survives
    e.stopPropagation();
    resetFilter();
    renderBoardList();
  });
  el("pageFilterClear").addEventListener("click",()=>{
    resetFilter();
    renderBoardList();
    filter.focus();
  });

  initSwitcher();
}
