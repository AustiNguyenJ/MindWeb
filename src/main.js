/* Entry point.
 *
 * Everything below is orchestration: load whatever backend is available,
 * bring stored data up to the current shape, and draw the first page.
 *
 * The init order matters. Listeners are attached first, synchronously,
 * before the first await, so nothing can reach a half-built page. Block
 * types are loaded and the built-ins seeded before any board data is read,
 * because a block cannot render without its schema -- and only then is
 * reconstructMissingTypes() able to tell a genuinely orphaned type from one
 * whose definition simply had not loaded yet.
 */

import { IDX_KEY } from "./constants.js";
import { uid } from "./util.js";
import { state } from "./state.js";
import { getData, ensureNotebookStructure } from "./boards.js";
import {
  fsRead,
  boardFileName,
  parseBoardText,
  parseIndex,
  notifyCorrupt,
  saveIndexNow,
  saveBoardNow,
  readFromFolder,
  connectFolder,
  restoreFolderHandle,
  updateStorageBar,
} from "./storage.js";
import { el } from "./dom.js";
import { seedBuiltinTypes, reconstructMissingTypes, loadCustomTypes } from "./blockTypes.js";
import { historyReset } from "./history.js";
import { exportAll, importAll } from "./exportImport.js";
import { centerView } from "./view.js";
import { migrateNode } from "./nodes.js";
import { renderBoard } from "./render.js";
import { renderBoardList, renderBoardHeader, initSidebar } from "./sidebar.js";
import { initSearch } from "./search.js";
import { initPicker } from "./picker.js";
import { initCanvas } from "./canvas.js";
import { initToolbar } from "./toolbar.js";
import { initKeyboard } from "./keyboard.js";
import { initDesigner, renderTypeToolbar } from "./designer.js";
import { initAuthGate, requireCloudAuth } from "./cloud.js";


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
  initAuthGate();

  // when Supabase is configured, block here until someone is signed in --
  // the rest of boot (loading board data, first render) waits on it
  await requireCloudAuth();

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

