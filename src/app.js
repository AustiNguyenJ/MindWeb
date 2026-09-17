import {
  IDX_KEY,
  TYPES_KEY,
  COLORS,
  DEFAULT_SIZE,
  HOTKEYS,
  FIELD_KINDS,
  SUBFIELD_KINDS,
  RICH_OK_TAGS,
  RICH_DROP_TAGS,
  COPY_ICON,
  APP_KEY_LIMIT,
  BUILTIN_KEYS,
  HISTORY_LIMIT,
  TYPE_ACCENTS,
  EDITABLE_BUILTINS,
  PROTECTED_BUILTINS,
} from "./constants.js";
import {
  uid,
  escapeHtml,
  escapeAttr,
  sanitizeHtml,
  plainToHtml,
  richToText,
  richValue,
  normalizeUrl,
  openLinkBackground,
  currentWeekLabel,
  isTextEntry,
  looksRich,
} from "./util.js";
import { state } from "./state.js";
import {
  getBoard,
  getData,
  findNode,
  ensureNotebookStructure,
  boardsInNotebook,
  renumberNotebook,
} from "./boards.js";
import {
  fsRead,
  boardFileName,
  parseBoardText,
  parseIndex,
  notifyCorrupt,
  persistIndex,
  persistBoard,
  persistDeleteBoard,
  saveIndexNow,
  saveBoardNow,
  queueTypesSave,
  queueIndexSave,
  queueBoardSave,
  readFromFolder,
  connectFolder,
  restoreFolderHandle,
  updateStorageBar,
} from "./storage.js";
import {
  el,
  viewport,
  canvasInner,
  connSvg,
  toastEl,
  imgFileInput,
} from "./dom.js";
import { showToast } from "./toast.js";
import { copyText, copyBtnHtml } from "./clipboard.js";
import {
  blankField,
  blankGroupRow,
  isCustomType,
  seedBuiltinTypes,
  reconstructMissingTypes,
  spawnableTypes,
  fieldVal,
  setFieldVal,
  fieldKindLabel,
  loadCustomTypes,
} from "./blockTypes.js";
import { historyReset, undo, redo } from "./history.js";
import { exportAll, importAll } from "./exportImport.js";
import {
  applyTransform,
  centerView,
  zoomAt,
  clientToCanvas,
  viewportCenterCanvasCoords,
} from "./view.js";
import {
  outgoingCount,
  descendantsOf,
  hiddenNodeIds,
  toggleCollapse,
} from "./collapse.js";
import {
  deselectAll,
  applySelectionClasses,
  selectNode,
  setSelection,
} from "./selection.js";
import {
  createConnection,
  deleteConnection,
  updateConnectionsTouching,
  renderConnections,
  renderConnLabelsAndDelete,
} from "./connections.js";
import {
  blankTicket,
  ticketSummary,
  migrateNode,
  createNode,
  focusNodeTitle,
  spawnAtCursor,
  processImageFile,
  deleteNode,
  deleteSelectedNodes,
  duplicateNode,
} from "./nodes.js";
import {
  itemHasConnection,
  groupKey,
  groupRowHasConnection,
  addGroupRow,
  removeGroupRow,
  addListItem,
  addTicketRow,
  removeTicketRow,
  removeListItem,
} from "./rows.js";
import { customBodyHtml, wireCustomFields } from "./customFields.js";
import { measureListOffsets, fitCanvasBounds, renderBoard } from "./render.js";


/* Custom block types the user defines in the Block Designer. Each is a
   schema: a list of fields, plus a default width. Stored per-file so a
   board carries its own block library. Persisted under mindmap:types. */


/* Recover custom block types whose definition file was lost but whose blocks
   still carry data. We scan every board for nodes of a ct_* type that isn't
   in customTypes, and rebuild a working schema by inspecting the field data:
     - a value that's an array of row objects  -> a "group" field, with
       subfields inferred from the row keys (HTML-looking values = richtext)
     - a string value                          -> a richtext field
   This makes orphaned blocks display and stay editable again. Reconstructed
   types are marked so we can tell the user and let them relabel in the designer. */


let searchScope = { mode:"all", id:null };   // all | notebook | page

let marqueeEl = null;
let linkTipEl = null;


/* ---------- storage backends ------------------------------------------
   Priority order:
     1. "folder" - a real folder on disk (File System Access API).
                   Layout, created automatically inside the folder you pick:
                     saved-boards/index.json          list of pages
                     saved-boards/board-<id>.json     one file per page
     2. "app"    - window.storage, present when this page runs inside Claude.
     3. "memory" - nothing persists; Export / Import still work.
   A browser page cannot create folders unattended, so "folder" mode needs
   you to pick the parent folder once. The handle is remembered after that.
------------------------------------------------------------------------ */


/* Track boards whose file existed but failed to parse, so we don't overwrite
   the (possibly recoverable) file with an empty one on the next autosave. */


/* ---------- custom block types ---------- */


async function loadAll(){
  // 1. try a previously connected folder
  const gotFolder = await restoreFolderHandle();
  if(gotFolder){
    const loaded = await readFromFolder();
    if(loaded) return;
  }

  // 2. fall back to Claude's storage if this page is running inside Claude
  if(state.backend!=="folder"){
    if(typeof window.storage !== "undefined" && window.storage){
      state.backend = "app";
      try{
        const res = await window.storage.get(IDX_KEY, false);
        if(res && res.value) parseIndex(res.value);
      }catch(err){ state.boards = []; }
    } else {
      state.backend = "memory";
    }
  }

  if(!state.boards.length){
    ensureNotebookStructure();
    const id = uid();
    state.boards = [{id, name:"My first mind map", description:"Sketch out how the pieces fit together.", notebookId:state.notebooks[0].id}];
    state.boardsData[id] = { nodes:[{id:uid(), type:"header", x:1980, y:1420, w:260, h:56, title:"Central topic", body:"", color:"#ffffff"}], connections:[] };
    state.currentBoardId = id;
    await saveIndexNow(); await saveBoardNow(id);
    return;
  }
  ensureNotebookStructure();
  for(const b of state.boards){
    let d = {nodes:[],connections:[]};
    try{
      if(state.backend==="folder"){
        const txt = await fsRead(boardFileName(b.id));
        const res = parseBoardText(txt);
        if(!res.ok) state.corruptBoards.add(b.id);
        d = res.data;
      } else if(state.backend==="app"){
        const res = await window.storage.get("mindmap:board:"+b.id, false);
        const parsed = parseBoardText(res && res.value);
        if(!parsed.ok) state.corruptBoards.add(b.id);
        d = parsed.data;
      }
    }catch(err){ state.corruptBoards.add(b.id); d = {nodes:[],connections:[]}; }
    d.nodes = (d.nodes||[]).map(migrateNode);
    d.connections = d.connections||[];
    state.boardsData[b.id] = d;
  }
  state.currentBoardId = state.boards[0].id;
  if(state.corruptBoards.size) notifyCorrupt();
}

/* ---------- sidebar ---------- */
const treeEl = () => el("notebookTree");
let favCollapsed = false;

/* Favorites = every pinned page, across all notebooks. Auto-hidden when none
   are pinned so the section never takes space until it's useful. */
function renderFavorites(){
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
          '<div class="board-item '+(b.id===state.currentBoardId?'active':'')+(b.pinned?' pinned':'')+'" draggable="true" data-id="'+b.id+'">' +
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
    item.addEventListener("click",(e)=>{ if(!e.target.closest(".board-menu-btn")) switchBoard(item.dataset.id); });
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
}

function clearDropMarks(){
  treeEl().querySelectorAll(".board-item.drop-above,.board-item.drop-below")
    .forEach(x=>x.classList.remove("drop-above","drop-below"));
}

/* Move a page next to a target page. If they're in different notebooks the
   dragged page joins the target's notebook. Pinned status follows the target
   so you can reorder within the pinned group or the unpinned group. */
function reorderPage(pageId, targetId, below){
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

function togglePin(pageId){
  const b = state.boards.find(x=>x.id===pageId);
  if(!b) return;
  b.pinned = !b.pinned;
  renumberNotebook(b.notebookId);
  renderBoardList(); queueIndexSave();
  showToast(b.pinned ? "Pinned to top" : "Unpinned");
}

function startRenameNotebook(id){
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

function newNotebook(){
  const nb = { id:"nb_"+uid().slice(0,8), name:"New Notebook", collapsed:false };
  state.notebooks.push(nb);
  renderBoardList(); queueIndexSave();
  startRenameNotebook(nb.id);
}

function deleteNotebook(id){
  if(state.notebooks.length===1){ showToast("Keep at least one notebook"); return; }
  const pages = boardsInNotebook(id);
  const nb = state.notebooks.find(n=>n.id===id);
  let msg = 'Delete notebook "'+(nb?nb.name:"")+'"?';
  if(pages.length){
    const other = state.notebooks.find(n=>n.id!==id);
    msg += "\n\nIts "+pages.length+" page(s) will move to \""+other.name+"\". (To delete the pages too, remove them first.)";
  }
  if(!confirm(msg)) return;
  const fallback = state.notebooks.find(n=>n.id!==id).id;
  pages.forEach(b=>b.notebookId=fallback);
  state.notebooks = state.notebooks.filter(n=>n.id!==id);
  renderBoardList(); queueIndexSave();
}

function startRenameBoard(id, itemEl){
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

function switchBoard(id){
  if(id===state.currentBoardId) return;
  state.currentBoardId = id; state.selection.clear(); state.selectedConnId=null;
  renderBoardList(); renderBoardHeader(); centerView(); renderBoard();
  historyReset(id);
}
function newBoard(nbId){
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
function deleteBoard(id){
  if(state.boards.length===1){ showToast("Can't delete your only page"); return; }
  if(!confirm("Delete this page and everything on it? This can't be undone.")) return;
  const nbId = (state.boards.find(b=>b.id===id)||{}).notebookId;
  state.boards = state.boards.filter(b=>b.id!==id);
  delete state.boardsData[id];
  persistDeleteBoard(id);
  if(nbId) renumberNotebook(nbId);
  if(state.currentBoardId===id) state.currentBoardId = state.boards[0].id;
  renderBoardList(); renderBoardHeader(); centerView(); renderBoard(); queueIndexSave();
}

/* Deep-copy a whole page (all blocks + connections) into the same notebook,
   placed right after the original. Node ids are regenerated and connections
   rewired to the new ids so nothing points back at the source page. */
function duplicatePage(id){
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

/* ---------- page context menu ---------- */
function closePageMenu(){
  const m = el("pageMenu");
  if(m){ m.remove(); document.removeEventListener("pointerdown", pageMenuOutside, true); }
}
function pageMenuOutside(e){
  const m = el("pageMenu");
  if(m && !m.contains(e.target)) closePageMenu();
}
function openPageMenu(pageId, x, y){
  closePageMenu();
  const b = state.boards.find(p=>p.id===pageId);
  if(!b) return;
  const menu = document.createElement("div");
  menu.id = "pageMenu"; menu.className = "page-menu";
  const items = [
    { act:"open",  label:"Open" },
    { act:"pin",   label:b.pinned ? "Unpin from top" : "Pin to top" },
    { act:"rename",label:"Rename" },
    { act:"dupe",  label:"Duplicate page" },
    { act:"sep" },
    { act:"del",   label:"Delete page", danger:true }
  ];
  menu.innerHTML = items.map(it=> it.act==="sep"
    ? '<div class="pm-sep"></div>'
    : '<button class="pm-item'+(it.danger?" danger":"")+'" data-act="'+it.act+'">'+escapeHtml(it.label)+'</button>'
  ).join('');
  document.body.appendChild(menu);
  // position, clamped to viewport
  const mw = 176, mh = menu.offsetHeight || 200;
  let left = x, top = y+4;
  if(left+mw > window.innerWidth-8) left = window.innerWidth-mw-8;
  if(top+mh > window.innerHeight-8) top = Math.max(8, y-mh-4);
  menu.style.left = left+"px"; menu.style.top = top+"px";

  menu.querySelectorAll(".pm-item").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const act = btn.dataset.act;
      closePageMenu();
      if(act==="open") switchBoard(pageId);
      else if(act==="pin") togglePin(pageId);
      else if(act==="rename"){
        switchBoard(pageId);
        const itemEl = treeEl().querySelector('.board-item[data-id="'+pageId+'"]');
        if(itemEl) startRenameBoard(pageId, itemEl);
      }
      else if(act==="dupe") duplicatePage(pageId);
      else if(act==="del") deleteBoard(pageId);
    });
  });
  setTimeout(()=>document.addEventListener("pointerdown", pageMenuOutside, true), 0);
}

export function renderBoardHeader(){
  const b = getBoard();
  el("boardTitle").value = b.name || "";
  el("boardDesc").value = b.description || "";
}
el("boardTitle").addEventListener("input",(e)=>{ getBoard().name=e.target.value; renderBoardList(); queueIndexSave(); });
el("boardDesc").addEventListener("input",(e)=>{ getBoard().description=e.target.value; queueIndexSave(); });
el("newBoardBtn").addEventListener("click", ()=>newBoard());
el("newNotebookBtn").addEventListener("click", newNotebook);
el("favHead").addEventListener("click", ()=>{
  favCollapsed = !favCollapsed;
  el("favWrap").classList.toggle("collapsed", favCollapsed);
});

/* ---------- search (modal, scoped, highlighted) ---------- */
let lastQuery = "";

function openSearch(){
  el("searchOverlay").classList.add("open");
  const inp = el("searchInput");
  renderSearchScopes();
  inp.focus(); inp.select();
  runSearch();
}
function closeSearch(){
  el("searchOverlay").classList.remove("open");
}
function toggleSearch(){
  if(el("searchOverlay").classList.contains("open")) closeSearch(); else openSearch();
}

function renderSearchScopes(){
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

function boardsInScope(){
  if(searchScope.mode==="page"){
    const b = state.boards.find(x=>x.id===searchScope.id) || getBoard();
    return b ? [b] : [];
  }
  if(searchScope.mode==="notebook"){
    return state.boards.filter(b=>b.notebookId===searchScope.id);
  }
  return state.boards;
}

function nodeHaystack(n){
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

function highlight(text, q){
  const esc = escapeHtml(text);
  if(!q) return esc;
  const qi = esc.toLowerCase().indexOf(q.toLowerCase());
  if(qi<0) return esc;
  // escape may shift indices; re-find on the escaped string safely by splitting on a case-insensitive match of the escaped query
  const eq = escapeHtml(q);
  const re = new RegExp(eq.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"), "ig");
  return esc.replace(re, m=>"<mark>"+m+"</mark>");
}

function runSearch(){
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

function goToNode(boardId, nodeId){
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

el("zoomIn").addEventListener("click",()=>{const r=viewport.getBoundingClientRect();zoomAt(r.left+r.width/2,r.top+r.height/2,1.2);});
el("zoomOut").addEventListener("click",()=>{const r=viewport.getBoundingClientRect();zoomAt(r.left+r.width/2,r.top+r.height/2,0.83);});
el("zoomReset").addEventListener("click", centerView);

viewport.addEventListener("wheel",(e)=>{
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, e.deltaY<0 ? 1.09 : 0.915);
},{passive:false});

viewport.addEventListener("pointermove",(e)=>{ state.cursorCanvas = clientToCanvas(e.clientX,e.clientY); });

/* right button anywhere on the canvas = rubber-band select.
   Registered in the capture phase so it wins even over a box. */
viewport.addEventListener("contextmenu", e=>e.preventDefault());
viewport.addEventListener("pointerdown",(e)=>{
  if(e.button!==2) return;
  e.preventDefault();
  e.stopPropagation();
  if(!e.ctrlKey && !e.metaKey && !e.shiftKey) deselectAll();
  const c = clientToCanvas(e.clientX, e.clientY);
  marqueeEl = document.createElement("div");
  marqueeEl.className = "marquee";
  marqueeEl.style.left = c.x+"px"; marqueeEl.style.top = c.y+"px";
  marqueeEl.style.width="0px"; marqueeEl.style.height="0px";
  canvasInner.appendChild(marqueeEl);
  state.dragState = { mode:"marquee", startCx:c.x, startCy:c.y,
    additive:(e.ctrlKey||e.metaKey||e.shiftKey), base:new Set(state.selection) };
  viewport.setPointerCapture(e.pointerId);
}, true);

/* left button on empty canvas = pan */
viewport.addEventListener("pointerdown",(e)=>{
  if(e.button!==0 && e.button!==1) return;
  if(e.target!==viewport && e.target!==canvasInner && e.target.id!=="connSvg" && e.target.tagName!=="svg") return;
  deselectAll();
  viewport.classList.add("panning");
  state.dragState = { mode:"pan", startX:e.clientX, startY:e.clientY, ox:state.view.x, oy:state.view.y };
  viewport.setPointerCapture(e.pointerId);
});

document.addEventListener("pointermove",(e)=>{
  if(!state.dragState) return;
  if(state.dragState.mode==="pan"){
    state.view.x = state.dragState.ox+(e.clientX-state.dragState.startX);
    state.view.y = state.dragState.oy+(e.clientY-state.dragState.startY);
    applyTransform();
  } else if(state.dragState.mode==="marquee"){
    const c = clientToCanvas(e.clientX, e.clientY);
    const x = Math.min(c.x, state.dragState.startCx), y = Math.min(c.y, state.dragState.startCy);
    const w = Math.abs(c.x-state.dragState.startCx), h = Math.abs(c.y-state.dragState.startCy);
    marqueeEl.style.left=x+"px"; marqueeEl.style.top=y+"px";
    marqueeEl.style.width=w+"px"; marqueeEl.style.height=h+"px";
    const hiddenNow = hiddenNodeIds();
    const hits = getData().nodes.filter(n=>
      !hiddenNow.has(n.id) &&
      n.x < x+w && n.x+n.w > x && n.y < y+h && n.y+n.h > y).map(n=>n.id);
    const next = state.dragState.additive ? new Set([...state.dragState.base, ...hits]) : new Set(hits);
    state.selection = next;
    applySelectionClasses();
  } else if(state.dragState.mode==="drag"){
    const dx=(e.clientX-state.dragState.startX)/state.view.scale, dy=(e.clientY-state.dragState.startY)/state.view.scale;
    state.dragState.moving.forEach(m=>{
      m.node.x = m.ox+dx; m.node.y = m.oy+dy;
      m.el.style.left = m.node.x+"px";
      m.el.style.top = m.node.y+"px";
      updateConnectionsTouching(m.node.id);
    });
    fitCanvasBounds();
  } else if(state.dragState.mode==="resize"){
    const dx=(e.clientX-state.dragState.startX)/state.view.scale, dy=(e.clientY-state.dragState.startY)/state.view.scale;
    state.dragState.node.w = Math.max(150, state.dragState.ow+dx);
    state.dragState.el.style.width = state.dragState.node.w+"px";
    const autoH = (state.dragState.node.type==="list" || state.dragState.node.type==="ticket" || state.dragState.node.type==="week" || isCustomType(state.dragState.node.type));
    if(!autoH){
      state.dragState.node.h = Math.max(50, state.dragState.oh+dy);
      state.dragState.el.style.height = state.dragState.node.h+"px";
    } else {
      state.dragState.node.h = state.dragState.el.offsetHeight;
    }
    updateConnectionsTouching(state.dragState.node.id);
  } else if(state.dragState.mode==="connect"){
    const c = clientToCanvas(e.clientX,e.clientY);
    state.cursorCanvas = c;
    const line = el("tempConnLine");
    if(line){ line.setAttribute("x2",c.x); line.setAttribute("y2",c.y); }
    highlightDropTarget(e.clientX, e.clientY);
  }
});

function clearDropHighlights(){
  canvasInner.querySelectorAll(".drop-target").forEach(n=>n.classList.remove("drop-target"));
  canvasInner.querySelectorAll(".row-target").forEach(n=>n.classList.remove("row-target"));
}
function highlightDropTarget(clientX, clientY){
  clearDropHighlights();
  const t = document.elementFromPoint(clientX, clientY);
  if(!t) return;
  const row = t.closest(".list-row");
  if(row){ row.classList.add("row-target"); return; }
  const nodeEl = t.closest(".node");
  if(nodeEl && nodeEl.dataset.id !== state.dragState.fromId) nodeEl.classList.add("drop-target");
}

document.addEventListener("pointerup",(e)=>{
  if(!state.dragState) return;
  if(state.dragState.mode==="pan") viewport.classList.remove("panning");
  if(state.dragState.mode==="marquee"){
    if(marqueeEl){ marqueeEl.remove(); marqueeEl=null; }
    applySelectionClasses();
    renderConnLabelsAndDelete();
    state.dragState = null;
    return;
  }
  if(state.dragState.mode==="drag"){
    measureListOffsets();
    state.dragState.moving.forEach(m=>updateConnectionsTouching(m.node.id));
    queueBoardSave(state.currentBoardId);
  }
  if(state.dragState.mode==="resize"){
    measureListOffsets();
    updateConnectionsTouching(state.dragState.node.id);
    queueBoardSave(state.currentBoardId);
  }
  if(state.dragState.mode==="connect"){
    endConnectDrag(e.clientX, e.clientY);
    return;
  }
  state.dragState = null;
});

function fromItemLabel(from){
  if(from.fromItem===null || from.fromItem===undefined) return "";
  const n = findNode(from.fromId);
  if(!n) return "";
  // group row: "g:fieldKey:rowIdx"
  if(typeof from.fromItem==="string" && from.fromItem.indexOf("g:")===0){
    const parts = from.fromItem.split(":");
    const fieldKey = parts[1], ri = parseInt(parts[2],10);
    const rows = n.fields ? n.fields[fieldKey] : null;
    const def = state.customTypes[n.type];
    const f = def ? def.fields.find(x=>x.key===fieldKey) : null;
    if(rows && rows[ri] && f && f.subfields){
      for(const sf of f.subfields){
        const v = (rows[ri][sf.key]||"").toString().trim();
        if(v) return v.slice(0,40);
      }
    }
    return "";
  }
  if(n.type==="week" && Array.isArray(n.tickets)){
    const t = n.tickets[from.fromItem];
    if(!t) return "";
    return (t.no||"").trim() || (t.note||"").trim().slice(0,40);
  }
  if(!Array.isArray(n.items)) return "";
  return (n.items[from.fromItem]||"").trim();
}

function endConnectDrag(clientX, clientY){
  const from = state.dragState;
  cleanupConnectVisuals();
  const target = document.elementFromPoint(clientX, clientY);
  const nodeEl = target ? target.closest(".node") : null;
  const listRowEl = target ? target.closest(".list-row") : null;
  const tickRowEl = target ? target.closest(".ticket-row") : null;
  const groupRowEl = target ? target.closest(".group-row") : null;

  if(nodeEl && nodeEl.dataset.id !== from.fromId){
    let toItem = null;
    if(listRowEl && listRowEl.closest(".node")===nodeEl) toItem = parseInt(listRowEl.dataset.idx,10);
    else if(tickRowEl && tickRowEl.closest(".node")===nodeEl) toItem = parseInt(tickRowEl.dataset.idx,10);
    else if(groupRowEl && groupRowEl.closest(".node")===nodeEl) toItem = groupKey(groupRowEl.dataset.gk, parseInt(groupRowEl.dataset.ri,10));
    createConnection(from.fromId, from.fromItem, nodeEl.dataset.id, toItem);
    state.dragState = null;
  } else if(!nodeEl){
    // dropped on empty canvas: open a searchable picker to choose the block type
    state.dragState = null;
    openNodePicker(from, clientX, clientY);
  } else {
    state.dragState = null;
  }
}

/* ---------- connection-drop node picker (TouchDesigner-style) ---------- */
let pickerState = null;   // { from, canvasPt, filtered:[], active:0 }

function openNodePicker(from, clientX, clientY){
  const canvasPt = clientToCanvas(clientX, clientY);
  pickerState = { from, canvasPt, filtered:[], active:0 };
  const overlay = el("pickerOverlay");
  const modal = el("pickerModal");
  overlay.classList.add("open");

  // position the modal near the drop point, clamped to the viewport
  const mw = 230, mh = 300;
  let left = clientX + 6, top = clientY + 6;
  if(left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
  if(top + mh > window.innerHeight - 8) top = Math.max(8, clientY - mh - 6);
  modal.style.left = left+"px";
  modal.style.top = top+"px";

  const inp = el("pickerInput");
  inp.value = "";
  renderPickerList("");
  inp.focus();
}

function closeNodePicker(){
  el("pickerOverlay").classList.remove("open");
  pickerState = null;
}

function renderPickerList(query){
  if(!pickerState) return;
  const q = (query||"").trim().toLowerCase();
  const all = spawnableTypes();
  const filtered = q ? all.filter(t=>t.name.toLowerCase().indexOf(q)>-1) : all;
  pickerState.filtered = filtered;
  if(pickerState.active >= filtered.length) pickerState.active = Math.max(0, filtered.length-1);
  const list = el("pickerList");
  if(!filtered.length){
    list.innerHTML = '<div class="picker-none">No block matches \u201c'+escapeHtml(query)+'\u201d</div>';
    return;
  }
  list.innerHTML = filtered.map((t,i)=>
    '<div class="picker-opt'+(i===pickerState.active?" active":"")+'" data-i="'+i+'">' +
      '<span class="sw" style="background:'+t.accent+'"></span>' +
      '<span class="pk-name">'+escapeHtml(t.name)+'</span>' +
      (state.customTypes[t.type] && !state.customTypes[t.type].builtin ? '<span class="pk-tag">custom</span>' : '') +
    '</div>').join('');
  list.querySelectorAll(".picker-opt").forEach(opt=>{
    opt.addEventListener("mouseenter",()=>{ pickerState.active = parseInt(opt.dataset.i,10); highlightPicker(); });
    opt.addEventListener("click",()=>{ pickerState.active = parseInt(opt.dataset.i,10); commitPicker(); });
  });
}

function highlightPicker(){
  el("pickerList").querySelectorAll(".picker-opt").forEach((o,i)=>o.classList.toggle("active", i===pickerState.active));
}
function movePicker(delta){
  if(!pickerState || !pickerState.filtered.length) return;
  const n = pickerState.filtered.length;
  pickerState.active = (pickerState.active + delta + n) % n;
  highlightPicker();
  const activeEl = el("pickerList").querySelector(".picker-opt.active");
  if(activeEl) activeEl.scrollIntoView({block:"nearest"});
}

function commitPicker(){
  if(!pickerState || !pickerState.filtered.length){ closeNodePicker(); return; }
  const choice = pickerState.filtered[pickerState.active];
  const from = pickerState.from;
  const pt = pickerState.canvasPt;
  closeNodePicker();
  const node = createNode(choice.type, pt.x+80, pt.y, {silent:true});
  const label = fromItemLabel(from);
  if(label && choice.type!=="image") node.title = label;
  createConnection(from.fromId, from.fromItem, node.id, null);
  renderBoard();
  focusNodeTitle(node.id);
}

el("pickerInput").addEventListener("input",(e)=>{ pickerState && (pickerState.active=0); renderPickerList(e.target.value); });
el("pickerInput").addEventListener("keydown",(e)=>{
  e.stopPropagation();
  if(e.key==="ArrowDown"){ e.preventDefault(); movePicker(1); }
  else if(e.key==="ArrowUp"){ e.preventDefault(); movePicker(-1); }
  else if(e.key==="Enter"){ e.preventDefault(); commitPicker(); }
  else if(e.key==="Escape"){ e.preventDefault(); closeNodePicker(); }
});
el("pickerOverlay").addEventListener("pointerdown",(e)=>{ if(e.target===el("pickerOverlay")) closeNodePicker(); });

function cleanupConnectVisuals(){
  const tempLine = el("tempConnLine");
  if(tempLine) tempLine.remove();
  clearDropHighlights();
  viewport.classList.remove("linking");
  if(linkTipEl){ linkTipEl.remove(); linkTipEl = null; }
}

export function startConnectDrag(fromId, fromItem, startX, startY){
  state.dragState = { mode:"connect", fromId, fromItem };
  viewport.classList.add("linking");
  const line = document.createElementNS("http://www.w3.org/2000/svg","line");
  line.id="tempConnLine";
  line.setAttribute("x1",startX); line.setAttribute("y1",startY);
  line.setAttribute("x2",startX); line.setAttribute("y2",startY);
  line.setAttribute("stroke","#4757d1"); line.setAttribute("stroke-width","2"); line.setAttribute("stroke-dasharray","5,4");
  connSvg.appendChild(line);
  linkTipEl = document.createElement("div");
  linkTipEl.className = "link-tip";
  linkTipEl.innerHTML = 'Drop on a box to link \u00b7 drop on empty space to pick a block';
  document.body.appendChild(linkTipEl);
}


document.querySelectorAll(".add-btn[data-type]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const c = viewportCenterCanvasCoords();
    createNode(btn.dataset.type, c.x+(Math.random()*60-30), c.y+(Math.random()*60-30));
  });
});


el("addImageBtn").addEventListener("click", ()=>{
  imgFileInput.onchange = (e)=>{
    const file = e.target.files[0];
    if(file) processImageFile(file,(dataUrl,w,h)=>{
      const c = viewportCenterCanvasCoords();
      const node = createNode("image", c.x, c.y, {silent:true});
      node.image = dataUrl; node.w = Math.min(320,w); node.h = node.w*(h/w);
      renderBoard(); queueBoardSave(state.currentBoardId);
    });
    imgFileInput.value=""; imgFileInput.onchange=null;
  };
  imgFileInput.click();
});


/* ---------- keyboard ---------- */
document.addEventListener("keydown",(e)=>{
  const ae = document.activeElement;
  const inField = isTextEntry(ae);
  const plain = !e.ctrlKey && !e.metaKey && !e.altKey;

  // Shift+F opens/toggles the search modal (not while typing in a field)
  if(e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase()==="f" && !inField){
    e.preventDefault();
    toggleSearch();
    return;
  }
  // Escape closes search if it's open, before doing anything else
  if(e.key==="Escape" && el("searchOverlay").classList.contains("open")){
    e.preventDefault();
    closeSearch();
    return;
  }

  // spawn-connected while dragging a link
  if(state.dragState && state.dragState.mode==="connect" && plain){
    const type = HOTKEYS[e.key.toLowerCase()];
    if(type && type!=="image"){
      e.preventDefault();
      const from = state.dragState;
      cleanupConnectVisuals();
      state.dragState = null;
      const node = createNode(type, state.cursorCanvas.x+90, state.cursorCanvas.y, {silent:true});
      const label = fromItemLabel(from);
      if(label) node.title = label;
      createConnection(from.fromId, from.fromItem, node.id, null);
      renderBoard();
      focusNodeTitle(node.id);
      return;
    }
  }

  if(plain && !inField){
    const type = HOTKEYS[e.key.toLowerCase()];
    if(type){ e.preventDefault(); spawnAtCursor(type); return; }
  }

  if((e.key==="Delete"||e.key==="Backspace") && !inField){
    if(state.selection.size){ e.preventDefault(); deleteSelectedNodes(); }
    else if(state.selectedConnId){ e.preventDefault(); deleteConnection(state.selectedConnId); }
  }
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==="z" && !inField){
    e.preventDefault();
    if(e.shiftKey) redo(); else undo();
    return;
  }
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==="y" && !inField){
    e.preventDefault(); redo(); return;
  }
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==="a" && !inField){
    e.preventDefault();
    const hid = hiddenNodeIds(); setSelection(getData().nodes.filter(n=>!hid.has(n.id)).map(n=>n.id));
    return;
  }
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==="c" && !inField && state.selection.size){
    const nodes = [...state.selection].map(findNode).filter(Boolean);
    if(nodes.length){
      const ids = new Set(nodes.map(n=>n.id));
      // capture connections whose BOTH ends are in the selection, so a copied
      // cluster keeps its internal wiring when pasted (even on another page)
      const conns = getData().connections.filter(c=>ids.has(c.from) && ids.has(c.to));
      const payload = { nodes:JSON.parse(JSON.stringify(nodes)), connections:JSON.parse(JSON.stringify(conns)) };
      state.clipboardNode = payload;
      try{ navigator.clipboard.writeText("MINDMAP_NODE::"+JSON.stringify(payload)); }catch(err){}
      showToast(nodes.length>1 ? "Copied "+nodes.length+" boxes" : "Copied");
    }
  }
  if(e.key==="Escape"){
    if(el("pageMenu")){ closePageMenu(); return; }
    if(state.dragState && state.dragState.mode==="connect"){ cleanupConnectVisuals(); state.dragState=null; }
    deselectAll();
  }
});

function pasteNodeCopy(src){
  // accept the new {nodes, connections} shape or the old bare array
  const nodesIn = Array.isArray(src) ? src : (src && src.nodes) || [];
  const connsIn = (src && src.connections) || [];
  if(!nodesIn.length) return;
  const minX = Math.min(...nodesIn.map(n=>n.x));
  const minY = Math.min(...nodesIn.map(n=>n.y));
  const idMap = {};
  const newIds = [];
  nodesIn.forEach(n=>{
    const copy = JSON.parse(JSON.stringify(n));
    copy.id = uid(); idMap[n.id] = copy.id;
    copy.x = Math.round(state.cursorCanvas.x + (n.x-minX));
    copy.y = Math.round(state.cursorCanvas.y + (n.y-minY));
    copy.collapsed = false;
    getData().nodes.push(copy);
    newIds.push(copy.id);
  });
  // recreate internal connections with remapped ids
  connsIn.forEach(c=>{
    if(idMap[c.from] && idMap[c.to]){
      getData().connections.push({
        id: uid(), from: idMap[c.from], to: idMap[c.to],
        fromItem: (c.fromItem===undefined?null:c.fromItem),
        toItem: (c.toItem===undefined?null:c.toItem),
        label: c.label || ""
      });
    }
  });
  renderBoard(); setSelection(newIds); queueBoardSave(state.currentBoardId);
  showToast(newIds.length>1 ? "Pasted "+newIds.length+" boxes" : "Pasted");
}
function createNoteNodeWithText(text){
  const node = createNode("note", state.cursorCanvas.x, state.cursorCanvas.y, {silent:true});
  node.body = text.slice(0,600);
  node.title = text.slice(0,40);
  renderBoard(); queueBoardSave(state.currentBoardId);
}

document.addEventListener("paste",(e)=>{
  const ae = document.activeElement;
  if(isTextEntry(ae)) return;
  const cd = e.clipboardData;
  if(cd && cd.items){
    for(const item of cd.items){
      if(item.type.indexOf("image")===0){
        e.preventDefault();
        processImageFile(item.getAsFile(),(dataUrl,w,h)=>{
          const node = createNode("image", state.cursorCanvas.x, state.cursorCanvas.y, {silent:true});
          node.image = dataUrl; node.w = Math.min(320,w); node.h = node.w*(h/w);
          renderBoard(); queueBoardSave(state.currentBoardId);
        });
        return;
      }
    }
  }
  const text = cd ? cd.getData("text/plain") : "";
  if(text && text.indexOf("MINDMAP_NODE::")===0){
    e.preventDefault();
    try{ pasteNodeCopy(JSON.parse(text.slice(14))); }
    catch(err){ if(state.clipboardNode) pasteNodeCopy(state.clipboardNode); }
    return;
  }
  if(state.clipboardNode){ e.preventDefault(); pasteNodeCopy(state.clipboardNode); return; }
  if(text && text.trim()){ e.preventDefault(); createNoteNodeWithText(text.trim()); }
});

/* ---------- init ---------- */
el("connectFolderBtn").addEventListener("click", connectFolder);
el("exportBtn").addEventListener("click", exportAll);
el("importBtn").addEventListener("click", ()=>el("jsonFileInput").click());
el("jsonFileInput").addEventListener("change",(e)=>{
  const f = e.target.files[0];
  if(f) importAll(f);
  e.target.value = "";
});

window.addEventListener("beforeunload",(e)=>{
  if(state.backend==="memory" && getData().nodes.length){
    e.preventDefault();
    e.returnValue = "";
  }
});

/* ---------- block designer ---------- */
let bdEditingId = null;

export function renderTypeToolbar(){
  const wrap = el("customTypeBtns");
  if(!wrap) return;
  const ids = Object.keys(state.customTypes).filter(id=>!state.customTypes[id].builtin);
  wrap.innerHTML = ids.map(id=>{
    const t = state.customTypes[id];
    return '<button class="add-btn" data-ctype="'+id+'" title="Add a '+escapeAttr(t.name)+' block">' +
      '<span class="swab" style="background:'+(t.accent||"#ddd")+'"></span>'+escapeHtml(t.name)+'</button>';
  }).join('');
  wrap.querySelectorAll("[data-ctype]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const c = viewportCenterCanvasCoords();
      createNode(btn.dataset.ctype, c.x+(Math.random()*50-25), c.y+(Math.random()*50-25));
    });
  });
}

function openDesigner(){
  el("bdOverlay").classList.add("open");
  renderTypeList();
  const ids = Object.keys(state.customTypes);
  if(ids.length) editType(ids[0]); else { bdEditingId=null; renderEditor(); }
}
function closeDesigner(){
  el("bdOverlay").classList.remove("open");
  renderTypeToolbar();
  renderBoard();
}

function renderTypeList(){
  const list = el("bdTypeList");
  const ids = Object.keys(state.customTypes);
  // built-in editable first, then user-created
  const builtinIds = ids.filter(id=>state.customTypes[id].builtin);
  const customIds = ids.filter(id=>!state.customTypes[id].builtin);

  let html = "";
  if(builtinIds.length){
    html += '<div style="font-family:var(--mono);font-size:9px;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted-2);margin:2px 0 5px">Built-in blocks</div>';
    html += builtinIds.map(id=>typeBtnHtml(id)).join('');
  }
  // protected (non-editable) built-ins, shown for reference
  html += Object.keys(PROTECTED_BUILTINS).map(id=>{
    const t = PROTECTED_BUILTINS[id];
    return '<button class="bd-typebtn" data-protected="'+id+'" style="opacity:0.7">' +
      '<span class="sw" style="background:'+t.accent+'"></span>' +
      '<span>'+escapeHtml(t.name)+'</span>' +
      '<span style="font-size:10px;color:var(--muted-2)">locked</span></button>';
  }).join('');
  if(customIds.length){
    html += '<div style="font-family:var(--mono);font-size:9px;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted-2);margin:12px 0 5px">Your blocks</div>';
    html += customIds.map(id=>typeBtnHtml(id)).join('');
  } else {
    html += '<div style="font-size:11.5px;color:var(--muted);padding:10px 4px 4px">No custom types yet. Create one below.</div>';
  }
  list.innerHTML = html;

  list.querySelectorAll(".bd-typebtn[data-id]").forEach(btn=>{
    btn.addEventListener("click",(e)=>{ if(e.target.dataset.del) return; editType(btn.dataset.id); });
  });
  list.querySelectorAll("[data-del]").forEach(btn=>{
    btn.addEventListener("click",(e)=>{ e.stopPropagation(); deleteType(btn.dataset.del); });
  });
  list.querySelectorAll("[data-protected]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const t = PROTECTED_BUILTINS[btn.dataset.protected];
      el("bdEditor").innerHTML = '<div class="bd-empty"><b>'+escapeHtml(t.name)+'</b> is a built-in block with special behaviour.<br><br>'+escapeHtml(t.note)+'<br><br>It can\'t be edited here, but you can build a similar custom block from scratch.</div>';
      el("bdDuplicate").style.display="none";
      bdEditingId = null;
      list.querySelectorAll(".bd-typebtn").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
    });
  });
}
function typeBtnHtml(id){
  const t = state.customTypes[id];
  const canDelete = !t.builtin;
  return '<button class="bd-typebtn '+(id===bdEditingId?"active":"")+'" data-id="'+id+'">' +
    '<span class="sw" style="background:'+(t.accent||"#ddd")+'"></span>' +
    '<span>'+escapeHtml(t.name||"Untitled")+'</span>' +
    (canDelete ? '<span class="del" data-del="'+id+'" title="Delete type">&times;</span>' : '<span style="font-size:10px;color:var(--muted-2)">built-in</span>') +
    '</button>';
}

function newType(){
  const id = "ct_"+uid().slice(0,8);
  state.customTypes[id] = { id, name:"New block", accent:"#bfdbfe", width:240,
    fields:[ {key:uid().slice(0,6), label:"Detail", kind:"text", placeholder:"", options:""} ] };
  bdEditingId = id;
  queueTypesSave();
  renderTypeList();
  renderEditor();
}
function deleteType(id){
  if(state.customTypes[id] && state.customTypes[id].builtin){ showToast("Built-in blocks can't be deleted"); return; }
  const inUse = getData().nodes.some(n=>n.type===id) ||
    state.boards.some(b=>(state.boardsData[b.id]||{nodes:[]}).nodes.some(n=>n.type===id));
  const msg = inUse
    ? "Delete this block type? Blocks already placed with it will keep their data but show as plain. This can't be undone."
    : "Delete this block type? This can't be undone.";
  if(!confirm(msg)) return;
  delete state.customTypes[id];
  if(bdEditingId===id) bdEditingId = Object.keys(state.customTypes)[0] || null;
  queueTypesSave();
  renderTypeList();
  renderEditor();
}
function duplicateType(){
  const src = state.customTypes[bdEditingId];
  if(!src) return;
  const id = "ct_"+uid().slice(0,8);
  state.customTypes[id] = JSON.parse(JSON.stringify(src));
  state.customTypes[id].id = id;
  state.customTypes[id].name = src.name+" copy";
  state.customTypes[id].fields.forEach(f=>{
    f.key = uid().slice(0,6);
    if(f.kind==="group" && Array.isArray(f.subfields)) f.subfields.forEach(sf=>sf.key = uid().slice(0,6));
  });
  bdEditingId = id;
  queueTypesSave();
  renderTypeList();
  renderEditor();
}
function editType(id){ bdEditingId = id; renderTypeList(); renderEditor(); }

function renderEditor(){
  const ed = el("bdEditor");
  el("bdDuplicate").style.display = bdEditingId ? "" : "none";
  const t = state.customTypes[bdEditingId];
  if(!t){ ed.innerHTML = '<div class="bd-empty">Select a block type to edit,<br>or create a new one.</div>'; return; }

  ed.innerHTML =
    '<div class="bd-field-grp"><label>Block name</label>' +
      '<input type="text" id="bdName" value="'+escapeAttr(t.name)+'" placeholder="e.g. Incident, Server, Contact"></div>' +
    '<div class="bd-field-grp"><label>Header colour</label>' +
      '<div class="bd-color-picks">'+TYPE_ACCENTS.map(c=>'<button data-accent="'+c+'" class="'+(t.accent===c?"active":"")+'" style="background:'+c+'"></button>').join('')+'</div></div>' +
    '<div class="bd-field-grp"><label>Default width ('+ (t.width||240) +'px)</label>' +
      '<input type="range" id="bdWidth" min="180" max="420" step="10" value="'+(t.width||240)+'" style="width:100%"></div>' +
    '<div class="bd-fields-label"><span>Fields</span></div>' +
    '<div id="bdFields"></div>' +
    '<button class="bd-addfield" id="bdAddField">+ Add field</button>' +
    '<div class="bd-preview"><div class="bd-preview-label">Live preview</div><div id="bdPreview"></div></div>';

  el("bdName").addEventListener("input",(e)=>{ t.name=e.target.value; queueTypesSave(); renderTypeList(); });
  ed.querySelectorAll("[data-accent]").forEach(b=>{
    b.addEventListener("click",()=>{
      t.accent=b.dataset.accent;
      ed.querySelectorAll("[data-accent]").forEach(x=>x.classList.toggle("active", x.dataset.accent===t.accent));
      queueTypesSave(); renderTypeList(); renderPreview();
    });
  });
  el("bdWidth").addEventListener("input",(e)=>{
    t.width=parseInt(e.target.value,10);
    e.target.previousElementSibling; // label
    ed.querySelector(".bd-field-grp:nth-child(3) label").textContent = "Default width ("+t.width+"px)";
    queueTypesSave(); renderPreview();
  });
  el("bdAddField").addEventListener("click",()=>{
    t.fields.push(blankField());
    queueTypesSave(); renderFields(); renderPreview();
  });

  renderFields();
  renderPreview();
}

function renderFields(){
  const t = state.customTypes[bdEditingId];
  const wrap = el("bdFields");
  wrap.innerHTML = t.fields.map((f,i)=>{
    const isGroup = f.kind==="group";
    let extra = "";
    if(f.kind==="select"){
      extra = '<input type="text" class="bd-fopts full" value="'+escapeAttr(f.options||"")+'" placeholder="Options, comma separated">';
    }
    let groupBlock = "";
    if(isGroup){
      if(!Array.isArray(f.subfields)) f.subfields = [];
      const layout = f.layout==="columns" ? "columns" : "rows";
      const subCards = f.subfields.map((sf,si)=>
        '<div class="bd-subcard" data-si="'+si+'">' +
          '<span class="bd-subdrag" title="Drag to reorder columns">\u2630</span>' +
          '<input type="text" class="bd-sublabel" value="'+escapeAttr(sf.label||"")+'" placeholder="Column label">' +
          '<select class="bd-subkind">'+SUBFIELD_KINDS.map(k=>'<option value="'+k+'" '+(sf.kind===k?"selected":"")+'>'+fieldKindLabel(k)+'</option>').join('')+'</select>' +
          '<input type="text" class="bd-subph" value="'+escapeAttr(sf.placeholder||"")+'" placeholder="Placeholder">' +
          '<button class="bd-subdel" title="Remove column">&times;</button>' +
        '</div>').join('');
      groupBlock =
        '<div class="bd-groupedit">' +
          '<div class="bd-layoutrow">' +
            '<span class="bd-group-title" style="margin:0">Arrange each row\u2019s columns:</span>' +
            '<div class="bd-layout-toggle">' +
              '<button class="bd-layopt '+(layout==="rows"?"active":"")+'" data-layout="rows" title="Stack columns vertically">\u2261 Stacked</button>' +
              '<button class="bd-layopt '+(layout==="columns"?"active":"")+'" data-layout="columns" title="Place columns side by side">\u2590\u2590 Side by side</button>' +
            '</div>' +
          '</div>' +
          '<div class="bd-subcards">'+subCards+'</div>' +
          '<button class="bd-addsub">+ Add column</button>' +
          '<input type="text" class="bd-addlabel" value="'+escapeAttr(f.addLabel||"")+'" placeholder="Button text (e.g. add step)" style="margin-top:6px">' +
        '</div>';
    }
    return '<div class="bd-fieldcard'+(isGroup?' is-group':'')+'" data-i="'+i+'">' +
      '<div class="bd-fieldcard-top">' +
        '<span class="bd-drag" title="Drag to reorder">\u2630</span>' +
        '<input type="text" class="bd-flabel" value="'+escapeAttr(f.label)+'" placeholder="Field label">' +
        '<button class="fdel" title="Remove field">&times;</button>' +
      '</div>' +
      '<div class="bd-fieldcard-grid">' +
        '<select class="bd-fkind">'+FIELD_KINDS.map(k=>'<option value="'+k+'" '+(f.kind===k?"selected":"")+'>'+fieldKindLabel(k)+'</option>').join('')+'</select>' +
        (isGroup ? '' : '<input type="text" class="bd-fph" value="'+escapeAttr(f.placeholder||"")+'" placeholder="Placeholder text">') +
        extra +
      '</div>' +
      groupBlock +
    '</div>';
  }).join('');

  wrap.querySelectorAll(".bd-fieldcard").forEach(card=>{
    const i = parseInt(card.dataset.i,10);
    const f = t.fields[i];
    card.querySelector(".bd-flabel").addEventListener("input",(e)=>{ f.label=e.target.value; queueTypesSave(); renderPreview(); });
    card.querySelector(".bd-fkind").addEventListener("change",(e)=>{
      f.kind=e.target.value;
      if(f.kind==="group" && (!f.subfields || !f.subfields.length)){
        f.subfields = [ {key:uid().slice(0,6), label:"Step", kind:"text", placeholder:""},
                        {key:uid().slice(0,6), label:"Description", kind:"richtext", placeholder:""} ];
        if(!f.addLabel) f.addLabel = "step";
      }
      queueTypesSave(); renderFields(); renderPreview();
    });
    const ph = card.querySelector(".bd-fph");
    if(ph) ph.addEventListener("input",(e)=>{ f.placeholder=e.target.value; queueTypesSave(); renderPreview(); });
    const opts = card.querySelector(".bd-fopts");
    if(opts) opts.addEventListener("input",(e)=>{ f.options=e.target.value; queueTypesSave(); renderPreview(); });
    card.querySelector(".fdel").addEventListener("click",()=>{
      if(t.fields.length===1){ showToast("Keep at least one field"); return; }
      t.fields.splice(i,1); queueTypesSave(); renderFields(); renderPreview();
    });

    // group subfield wiring
    if(f.kind==="group"){
      const addLabel = card.querySelector(".bd-addlabel");
      if(addLabel) addLabel.addEventListener("input",(e)=>{ f.addLabel=e.target.value; queueTypesSave(); renderPreview(); });
      card.querySelector(".bd-addsub").addEventListener("click",()=>{
        f.subfields.push({key:uid().slice(0,6), label:"Column", kind:"text", placeholder:""});
        queueTypesSave(); renderFields(); renderPreview();
      });
      // layout toggle: rows (stacked) vs columns (side by side)
      card.querySelectorAll(".bd-layopt").forEach(btn=>{
        btn.addEventListener("click",()=>{
          f.layout = btn.dataset.layout;
          card.querySelectorAll(".bd-layopt").forEach(b=>b.classList.toggle("active", b.dataset.layout===f.layout));
          queueTypesSave(); renderPreview();
        });
      });
      card.querySelectorAll(".bd-subcard").forEach(sc=>{
        const si = parseInt(sc.dataset.si,10);
        const sf = f.subfields[si];
        sc.querySelector(".bd-sublabel").addEventListener("input",(e)=>{ sf.label=e.target.value; queueTypesSave(); renderPreview(); });
        sc.querySelector(".bd-subkind").addEventListener("change",(e)=>{ sf.kind=e.target.value; queueTypesSave(); renderPreview(); });
        sc.querySelector(".bd-subph").addEventListener("input",(e)=>{ sf.placeholder=e.target.value; queueTypesSave(); renderPreview(); });
        sc.querySelector(".bd-subdel").addEventListener("click",()=>{
          if(f.subfields.length===1){ showToast("A group needs at least one column"); return; }
          f.subfields.splice(si,1); queueTypesSave(); renderFields(); renderPreview();
        });
        // drag-reorder columns within this group
        const sgrip = sc.querySelector(".bd-subdrag");
        if(sgrip) sgrip.addEventListener("pointerdown",(e)=>{
          e.preventDefault(); e.stopPropagation();
          const fromSi = si;
          sc.classList.add("dragging");
          function up(ev){
            document.removeEventListener("pointerup", up);
            sc.classList.remove("dragging");
            const cards = [...card.querySelectorAll(".bd-subcard")];
            let to = fromSi;
            const y = ev.clientY;
            cards.forEach((c,ci)=>{
              const r = c.getBoundingClientRect();
              if(y > r.top+r.height/2) to = ci;
            });
            if(to!==fromSi){
              const moved = f.subfields.splice(fromSi,1)[0];
              f.subfields.splice(to,0,moved);
              queueTypesSave(); renderFields(); renderPreview();
            }
          }
          document.addEventListener("pointerup", up);
        });
      });
    }

    // simple drag-reorder
    const grip = card.querySelector(".bd-drag");
    grip.addEventListener("pointerdown",(e)=>{
      e.preventDefault();
      const from = i;
      function up(ev){
        document.removeEventListener("pointerup", up);
        const cards = [...wrap.querySelectorAll(".bd-fieldcard")];
        let to = from;
        const y = ev.clientY;
        cards.forEach((c,ci)=>{
          const r = c.getBoundingClientRect();
          if(y > r.top+r.height/2) to = ci;
        });
        if(to!==from){
          const moved = t.fields.splice(from,1)[0];
          t.fields.splice(to,0,moved);
          queueTypesSave(); renderFields(); renderPreview();
        }
      }
      document.addEventListener("pointerup", up);
    });
  });
}


function renderPreview(){
  const t = state.customTypes[bdEditingId];
  if(!t) return;
  const fake = { id:"__preview", type:bdEditingId, title:t.name, fields:{}, w:t.width||240, color:t.accent };
  // seed one sample row for each group field so the preview shows a row
  t.fields.forEach(f=>{
    if(f.kind==="group"){ fake.fields[f.key] = [ blankGroupRow(f.subfields) ]; }
  });
  // build a standalone preview node (not on canvas)
  const div = document.createElement("div");
  div.className = "node type-custom";
  div.style.position="relative"; div.style.width=(t.width||240)+"px"; div.style.background=t.accent||"#fff";
  div.style.border="1.5px solid var(--line)"; div.style.borderRadius="10px"; div.style.boxShadow="var(--shadow)";
  div.innerHTML =
    '<div class="node-header"><span class="grip">\u2837\u2801</span>' +
    '<input class="node-title" value="'+escapeAttr(t.name)+'" readonly style="pointer-events:none"></div>' +
    customBodyHtml(fake);
  const host = el("bdPreview");
  host.innerHTML="";
  host.appendChild(div);
  // make preview inputs inert
  host.querySelectorAll("input,textarea,select,.cf-rich,button").forEach(x=>{
    x.setAttribute("tabindex","-1");
    x.style.pointerEvents="none";
  });
}

el("designBlocksBtn").addEventListener("click", openDesigner);
el("bdClose").addEventListener("click", closeDesigner);
el("bdDone").addEventListener("click", closeDesigner);
el("bdNewType").addEventListener("click", newType);
el("bdDuplicate").addEventListener("click", duplicateType);
el("bdOverlay").addEventListener("click",(e)=>{ if(e.target===el("bdOverlay")) closeDesigner(); });

(async function init(){
  // determine backend first (restore folder handle if present)
  await restoreFolderHandle();
  if(state.backend!=="folder" && typeof window.storage!=="undefined" && window.storage) state.backend="app";
  await loadCustomTypes();
  seedBuiltinTypes();
  await loadAll();
  reconstructMissingTypes();
  renderTypeToolbar();
  renderBoardList(); renderBoardHeader(); centerView(); renderBoard();
  historyReset(state.currentBoardId);
  updateStorageBar();
})();

