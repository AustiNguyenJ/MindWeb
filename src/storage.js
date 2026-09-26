import { state } from "./state.js";
import { el } from "./dom.js";
import { showToast } from "./toast.js";
import { IDX_KEY, TYPES_KEY, APP_KEY_LIMIT, TOOLBAR_KEY } from "./constants.js";
import { ensureNotebookStructure } from "./boards.js";
import {
  cloudPersistIndex,
  cloudPersistBoard,
  cloudPersistDeleteBoard,
  cloudPersistDeleteNotebook,
  cloudSaveTypes,
  cloudSaveToolbarConfig,
} from "./cloud.js";
import { recordChange } from "./history.js";
import { centerView } from "./view.js";
import { migrateNode } from "./nodes.js";
import { renderBoard } from "./render.js";
import { renderBoardList, renderBoardHeader } from "./sidebar.js";

/* Persistence, across four backends chosen at load time:
 *
 *   folder  a real directory on disk via the File System Access API,
 *           laid out as saved-boards/index.json plus one file per page
 *   cloud   Supabase (see cloud.js)
 *   app     window.storage, when the page runs inside a Claude artifact
 *   memory  nothing persists; Export / Import still work
 *
 * A browser page cannot create folders unattended, so folder mode needs the
 * user to pick a parent directory once; the handle is then remembered.
 *
 * Two protections matter more than the rest. Writes to a given file are
 * serialised and verified by reading back, so a partial write cannot pass
 * silently. And a stored payload that exists but will not parse is treated
 * as damaged rather than empty: it is never overwritten, and the user is
 * asked once before anything clobbers it.
 */

export const FS_SUPPORTED = (typeof window.showDirectoryPicker === "function");

/* tiny IndexedDB helper, only used to remember the folder handle */
export function idb(mode, key, val){
  return new Promise((res)=>{
    try{
      const req = indexedDB.open("mindmap-fs", 1);
      req.onupgradeneeded = ()=>{ req.result.createObjectStore("h"); };
      req.onsuccess = ()=>{
        try{
          const db = req.result;
          const tx = db.transaction("h", mode==="get"?"readonly":"readwrite");
          const os = tx.objectStore("h");
          const r = mode==="get" ? os.get(key) : os.put(val, key);
          r.onsuccess = ()=>res(mode==="get" ? (r.result||null) : true);
          r.onerror = ()=>res(null);
        }catch(e){ res(null); }
      };
      req.onerror = ()=>res(null);
    }catch(e){ res(null); }
  });
}

/* All writes to a given file are chained so two createWritable() calls never
   overlap on the same handle (which truncates or throws). Each file name gets
   its own tail promise; new writes wait for the previous one to finish. */
export const writeChains = {};

export function serializeWrite(name, fn){
  const prev = writeChains[name] || Promise.resolve();
  const next = prev.then(fn, fn);   // run regardless of prior success/failure
  writeChains[name] = next.catch(()=>{});   // keep the chain alive on rejection
  return next;
}

/* Write, then read the file back and confirm it matches byte-for-byte. The
   File System Access API's createWritable() writes to a swap file and only
   replaces the target on a successful close(), so a failed write leaves the
   PREVIOUS good content in place. We additionally verify, and on mismatch we
   retry once, so a transient glitch can't silently leave a blank/partial file. */
export async function fsWrite(name, text){
  return serializeWrite(name, async ()=>{
    for(let attempt=0; attempt<2; attempt++){
      try{
        const fh = await state.dirHandle.getFileHandle(name, {create:true});
        const w = await fh.createWritable({keepExistingData:false});
        await w.write(text);
        await w.close();
        // verify round-trip
        const back = await (await fh.getFile()).text();
        if(back===text) return true;
      }catch(err){
        if(attempt===1){ console.error("fsWrite failed for "+name, err); throw err; }
      }
      // brief backoff before the retry
      await new Promise(r=>setTimeout(r, 60));
    }
    throw new Error("write verification failed for "+name);
  });
}

export async function fsRead(name){
  try{
    const fh = await state.dirHandle.getFileHandle(name, {create:false});
    const file = await fh.getFile();
    return await file.text();
  }catch(e){ return null; }
}

export async function fsDelete(name){
  return serializeWrite(name, async ()=>{
    try{ await state.dirHandle.removeEntry(name); }catch(e){}
  });
}

export function boardFileName(id){ return "board-"+id+".json"; }

/* Parse a stored board payload defensively. Returns {ok, data}. A file that
   exists but doesn't parse, or parses to something without a nodes array, is
   treated as corrupt (ok:false) rather than being silently read as empty. */
export function parseBoardText(txt){
  if(txt===null || txt===undefined) return { ok:true, data:{nodes:[], connections:[]} }; // no file yet = genuinely empty
  if(typeof txt==="string" && txt.trim()===""){ return { ok:false, data:{nodes:[], connections:[]} }; } // blank file = truncated write
  let p;
  try{ p = JSON.parse(txt); }
  catch(e){ return { ok:false, data:{nodes:[], connections:[]} }; }
  if(!p || typeof p!=="object" || !Array.isArray(p.nodes)){
    return { ok:false, data:{nodes:[], connections:[]} };
  }
  return { ok:true, data:{
    nodes:p.nodes, connections:Array.isArray(p.connections)?p.connections:[],
    toolbarOverride: !!p.toolbarOverride,
    toolbarConfig: (p.toolbarConfig && typeof p.toolbarConfig==="object") ? p.toolbarConfig : null,
  } };
}

export function parseIndex(raw){
  // accepts either the old bare-array form or the new {notebooks, boards} object
  let parsed;
  try{ parsed = JSON.parse(raw); }catch(e){ return; }
  if(Array.isArray(parsed)){
    state.boards = parsed.map(b=>({id:b.id, name:b.name, description:b.description||"", notebookId:b.notebookId||null, order:b.order, pinned:!!b.pinned}));
    state.notebooks = [];
  } else if(parsed && Array.isArray(parsed.boards)){
    state.boards = parsed.boards.map(b=>({id:b.id, name:b.name, description:b.description||"", notebookId:b.notebookId||null, order:b.order, pinned:!!b.pinned}));
    state.notebooks = Array.isArray(parsed.notebooks) ? parsed.notebooks.slice() : [];
  }
}

export function boardPayload(id){
  const b = state.boards.find(x=>x.id===id) || {};
  const d = state.boardsData[id] || {nodes:[],connections:[]};
  return JSON.stringify({
    id, name:b.name||"", description:b.description||"",
    updated: new Date().toISOString(),
    nodes: d.nodes, connections: d.connections,
    toolbarOverride: !!d.toolbarOverride,
    toolbarConfig: d.toolbarConfig || null,
  }, null, 2);
}

export function indexPayload(){
  return JSON.stringify({
    version: 2,
    updated: new Date().toISOString(),
    notebooks: state.notebooks,
    boards: state.boards.map(b=>({id:b.id, name:b.name, description:b.description, notebookId:b.notebookId||null, order:(typeof b.order==="number"?b.order:0), pinned:!!b.pinned, file:boardFileName(b.id)}))
  }, null, 2);
}

export let sizeWarned = false;

export function checkAppSize(payload){
  const bytes = (typeof Blob!=="undefined") ? new Blob([payload]).size : payload.length;
  if(bytes > APP_KEY_LIMIT * 0.9 && !sizeWarned){
    sizeWarned = true;
    showToast("This page is large \u2014 connect a folder to avoid save limits");
  }
  if(bytes > APP_KEY_LIMIT){
    throw new Error("Board exceeds app storage limit ("+Math.round(bytes/1048576)+"MB). Connect a folder to save it.");
  }
}

export let corruptNotified = false;

export function notifyCorrupt(){
  if(corruptNotified) return;
  corruptNotified = true;
  const n = state.corruptBoards.size;
  setTimeout(()=>{
    showToast(n+" page"+(n>1?"s":"")+" couldn't be read \u2014 protected from overwrite");
    console.warn("Corrupt/unreadable board ids (their files are left untouched so you can recover them):", [...state.corruptBoards]);
  }, 400);
}

export async function persistIndex(){
  try{
    if(state.backend==="folder"){ await fsWrite("index.json", indexPayload()); showToast("Saved to folder"); }
    else if(state.backend==="cloud"){ await cloudPersistIndex(); showToast("Saved to cloud"); }
    else if(state.backend==="app"){ await window.storage.set(IDX_KEY, indexPayload(), false); showToast("Saved"); }
    else { showToast("Not saving \u2014 connect a folder"); }
  }catch(err){ console.error("index save", err); showToast("Save failed"); }
}

export async function persistBoard(id){
  // never overwrite a file we couldn't read — the data on disk may be
  // recoverable and clobbering it with the in-memory (empty) version loses it
  if(state.corruptBoards.has(id)){
    showToast("Not saving this page \u2014 its file couldn't be read (protected)");
    return;
  }
  try{
    if(state.backend==="folder"){ await fsWrite(boardFileName(id), boardPayload(id)); await fsWrite("index.json", indexPayload()); showToast("Saved to folder"); }
    else if(state.backend==="cloud"){ await cloudPersistBoard(id); await cloudPersistIndex(); showToast("Saved to cloud"); }
    else if(state.backend==="app"){
      const payload = JSON.stringify(state.boardsData[id]);
      checkAppSize(payload);
      await window.storage.set("mindmap:board:"+id, payload, false); showToast("Saved");
    }
    else { showToast("Not saving \u2014 connect a folder"); }
    clearTimeout(state.saveTimers["__max_"+id]); delete state.saveTimers["__max_"+id];
    state.saveStatus = "idle"; state.lastSavedAt = Date.now(); updateStorageBar();
  }catch(err){
    console.error("board save", err); showToast("Save failed \u2014 see console");
    state.saveStatus = "error"; updateStorageBar();
  }
}

export async function persistDeleteBoard(id){
  try{
    if(state.backend==="folder"){ await fsDelete(boardFileName(id)); await fsWrite("index.json", indexPayload()); }
    else if(state.backend==="cloud"){ await cloudPersistDeleteBoard(id); }
    else if(state.backend==="app"){ await window.storage.delete("mindmap:board:"+id, false); }
  }catch(err){ console.error("board delete", err); showToast("Couldn't delete the page from "+state.backend+" — see console"); }
}

/* Only the cloud backend needs an explicit call here: folder/app both
   persist the whole notebook list as one document via the queueIndexSave()
   that follows this, so removing a notebook from state.notebooks is already
   enough for them. Cloud stores notebooks as individual rows, which
   cloudPersistIndex()'s upsert-only pass can never remove on its own. */
export async function persistDeleteNotebook(id){
  if(state.backend!=="cloud") return;
  try{ await cloudPersistDeleteNotebook(id); }
  catch(err){ console.error("notebook delete", err); showToast("Couldn't delete the notebook from cloud — see console"); }
}

/* names kept from before so the rest of the app is unchanged */
export async function saveIndexNow(){ await persistIndex(); }

export async function saveBoardNow(id){ await persistBoard(id); }

export async function saveTypesNow(){
  try{
    if(state.backend==="folder"){ await fsWrite("block-types.json", JSON.stringify(state.customTypes,null,2)); }
    else if(state.backend==="cloud"){ await cloudSaveTypes(); }
    else if(state.backend==="app"){ await window.storage.set(TYPES_KEY, JSON.stringify(state.customTypes), false); }
  }catch(err){ console.error("types save", err); }
}

export function queueTypesSave(){ clearTimeout(state.saveTimers.__types); state.saveTimers.__types = setTimeout(saveTypesNow, 400); }

/* The global quick-access toolbar / hotkey config: which blocks are
   assigned/unassigned to the bar, and their hotkeys. */
export async function saveToolbarConfigNow(){
  try{
    if(state.backend==="folder"){ await fsWrite("toolbar-config.json", JSON.stringify(state.toolbarConfig,null,2)); }
    else if(state.backend==="cloud"){ await cloudSaveToolbarConfig(); }
    else if(state.backend==="app"){ await window.storage.set(TOOLBAR_KEY, JSON.stringify(state.toolbarConfig), false); }
  }catch(err){ console.error("toolbar config save", err); }
}

export function queueToolbarConfigSave(){ clearTimeout(state.saveTimers.__toolbarConfig); state.saveTimers.__toolbarConfig = setTimeout(saveToolbarConfigNow, 400); }

export function queueIndexSave(){ clearTimeout(state.saveTimers.__index); state.saveTimers.__index = setTimeout(saveIndexNow, 500); }

export function queueBoardSave(id){
  if(id===state.currentBoardId && typeof recordChange==="function") recordChange();
  // If the user is actively editing a board whose file we refused to overwrite,
  // ask once whether to release the protection (they accept losing the old file)
  // so their new edits can start saving again.
  if(state.corruptBoards.has(id) && !state.corruptPrompted.has(id)){
    state.corruptPrompted.add(id);
    const ok = confirm(
      "This page's saved file couldn't be read, so saving has been paused to protect it.\n\n"+
      "Its file is still on disk (or in storage) exactly as it was, so you can back it up manually.\n\n"+
      "Start saving again from here? (Your current on-screen version will overwrite the unreadable file.)"
    );
    if(ok){ state.corruptBoards.delete(id); }
    else { return; }
  }
  state.saveStatus = "pending";
  updateStorageBar();
  clearTimeout(state.saveTimers[id]);
  // Cloud writes hit a real database on every call, so a debounce this short
  // would fire on close to every keystroke -- stretch it out for that backend
  // specifically. A steady stream of edits would otherwise keep pushing the
  // debounce back forever, so a separate, un-reset timer forces a flush after
  // a bounded wait regardless of how much typing is still happening.
  const delay = state.backend==="cloud" ? 4000 : 500;
  state.saveTimers[id] = setTimeout(()=>saveBoardNow(id), delay);
  if(state.backend==="cloud" && !state.saveTimers["__max_"+id]){
    state.saveTimers["__max_"+id] = setTimeout(()=>saveBoardNow(id), 15000);
  }
}

export async function openSavedBoardsDir(handle){
  state.rootHandle = handle;
  state.dirHandle = await handle.getDirectoryHandle("saved-boards", {create:true});
  state.backend = "folder";
}

/* returns true if boards were loaded out of the folder */
export async function readFromFolder(){
  const idxText = await fsRead("index.json");
  if(!idxText) return false;
  let idx;
  try{ idx = JSON.parse(idxText); }catch(e){ return false; }
  if(!idx || !Array.isArray(idx.boards) || !idx.boards.length) return false;
  state.boards = idx.boards.map(b=>({id:b.id, name:b.name, description:b.description||"", notebookId:b.notebookId||null, order:b.order, pinned:!!b.pinned}));
  state.notebooks = Array.isArray(idx.notebooks) ? idx.notebooks.slice() : [];
  ensureNotebookStructure();
  state.boardsData = {};
  for(const b of state.boards){
    const txt = await fsRead(boardFileName(b.id));
    const res = parseBoardText(txt);
    if(!res.ok){ state.corruptBoards.add(b.id); console.warn("Board file unreadable, protecting it from overwrite:", boardFileName(b.id)); }
    const d = res.data;
    d.nodes = (d.nodes||[]).map(migrateNode);
    d.connections = d.connections||[];
    state.boardsData[b.id] = d;
  }
  state.currentBoardId = state.boards[0].id;
  if(state.corruptBoards.size) notifyCorrupt();
  return true;
}

export async function writeAllToFolder(){
  await fsWrite("index.json", indexPayload());
  for(const b of state.boards){ await fsWrite(boardFileName(b.id), boardPayload(b.id)); }
}

export async function connectFolder(){
  if(!FS_SUPPORTED){
    alert("This browser can't write to a folder.\n\nFolder saving needs Chrome, Edge, or another Chromium browser, served over http://localhost or https:// (a file:// page is often blocked too).\n\nUse Export / Import below to keep backups instead.");
    return;
  }
  try{
    const handle = await window.showDirectoryPicker({mode:"readwrite"});
    const perm = await handle.requestPermission({mode:"readwrite"});
    if(perm!=="granted"){ showToast("Permission denied"); return; }
    await openSavedBoardsDir(handle);
    await idb("set","root",handle);

    const loaded = await readFromFolder();
    if(loaded){
      showToast("Loaded from folder");
      renderBoardList(); renderBoardHeader(); centerView(); renderBoard();
    } else {
      await writeAllToFolder();
      showToast("Folder connected");
    }
    updateStorageBar();
  }catch(err){
    if(err && err.name==="AbortError") return;
    console.error(err);
    alert("Couldn't open that folder.\n\n"+(err && err.message ? err.message : "Unknown error")+"\n\nIf this page was opened directly from a file, try serving it over localhost instead.");
  }
}

export async function restoreFolderHandle(){
  if(!FS_SUPPORTED) return false;
  const handle = await idb("get","root");
  if(!handle) return false;
  try{
    const perm = await handle.queryPermission({mode:"readwrite"});
    if(perm!=="granted") return false;   // needs a click to re-grant
    await openSavedBoardsDir(handle);
    return true;
  }catch(e){ return false; }
}

/* Backend-only status (what/where we're saving to), independent of whether
   a save is currently pending -- used for both the storage panel inside the
   account modal and as the base state for the footer bar below. */
function backendStatus(){
  if(state.backend==="folder"){
    return { cls:"ok", label:"Saving to folder",
      sub:(state.rootHandle && state.rootHandle.name ? state.rootHandle.name+"/" : "")+"saved-boards/" };
  }
  if(state.backend==="cloud"){
    return { cls:"ok", label:"Saving to cloud",
      sub:(state.supabaseSession && state.supabaseSession.user) ? state.supabaseSession.user.email : "Supabase" };
  }
  if(state.backend==="app"){
    return { cls:"ok", label:"Saving in this browser", sub:"Connect a folder to save real files" };
  }
  return { cls:"warn", label:"Not saving yet", sub:"Connect a folder to keep your work" };
}

function formatClock(ts){
  return new Date(ts).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
}

/* Refreshes both status displays: the storage panel inside the account
   modal (unchanged wording, so existing tests/harness boot-detection that
   read #storageBar keep working) and the always-visible footer bar, which
   additionally folds in save-in-flight/error state that the modal doesn't
   need to show. */
export function updateStorageBar(){
  const info = backendStatus();
  const bar = el("storageBar");
  if(bar){
    bar.className = "storage-bar "+info.cls;
    bar.querySelector(".sb-label").textContent = info.label;
    bar.querySelector(".sb-sub").textContent = info.sub;
  }
  const cfBtn = el("connectFolderBtn");
  if(cfBtn) cfBtn.textContent = state.backend==="folder" ? "Change folder" : "Connect folder";

  const foot = el("footerBar");
  if(!foot) return;
  let cls = info.cls, label = info.label;
  if(state.saveStatus==="error"){ cls="warn"; label="Save failed — see console"; }
  else if(state.saveStatus==="pending"){ cls="warn"; label="Unsaved changes…"; }
  foot.className = "footer-bar "+cls;
  const lbl = el("footerLabel"); if(lbl) lbl.textContent = label;
  const saved = el("footerSaved");
  if(saved) saved.textContent = state.lastSavedAt ? "Last saved "+formatClock(state.lastSavedAt) : "";
}

/* Clears whatever save timers are pending for the current board/index and
   saves right now -- the footer bar's manual "Save now" button. */
export function flushPendingSaves(){
  const id = state.currentBoardId;
  if(id){
    clearTimeout(state.saveTimers[id]);
    clearTimeout(state.saveTimers["__max_"+id]);
    delete state.saveTimers["__max_"+id];
    saveBoardNow(id);
  }
  clearTimeout(state.saveTimers.__index);
  saveIndexNow();
}
