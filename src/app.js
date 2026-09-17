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
import { openNodePicker } from "./picker.js";
import { closeSearch, toggleSearch } from "./search.js";
import { closePageMenu, openPageMenu } from "./pageMenu.js";
import { renderBoardList, renderBoardHeader } from "./sidebar.js";
import { initSidebar } from "./sidebar.js";
import { initSearch } from "./search.js";
import { initPicker } from "./picker.js";


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

export function fromItemLabel(from){
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
  // Listeners that used to be registered while the script evaluated are
  // now wired explicitly. This still runs synchronously, before the first
  // await below, so nothing can interact with the page beforehand.
  initSidebar();
  initSearch();
  initPicker();

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

