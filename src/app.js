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
import { initCanvas } from "./canvas.js";
import { initToolbar } from "./toolbar.js";
import { initKeyboard } from "./keyboard.js";
import { initDesigner } from "./designer.js";
import { renderTypeToolbar } from "./designer.js";


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


/* ---------- keyboard ---------- */


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


(async function init(){
  // Listeners that used to be registered while the script evaluated are
  // now wired explicitly. This still runs synchronously, before the first
  // await below, so nothing can interact with the page beforehand.
  initSidebar();
  initSearch();
  initCanvas();
  initPicker();
  initToolbar();
  initKeyboard();
  initDesigner();

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

