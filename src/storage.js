import { state } from "./state.js";
import { el } from "./dom.js";
import { showToast } from "./toast.js";
import { IDX_KEY, TYPES_KEY, APP_KEY_LIMIT } from "./constants.js";
import { ensureNotebookStructure } from "./boards.js";
import { migrateNode, recordChange, renderBoard, renderBoardList, renderBoardHeader, centerView } from "./app.js";
import { cloudPersistIndex, cloudPersistBoard, cloudPersistDeleteBoard, cloudSaveTypes } from "./cloud.js";

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
  return { ok:true, data:{ nodes:p.nodes, connections:Array.isArray(p.connections)?p.connections:[] } };
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
    nodes: d.nodes, connections: d.connections
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
  }catch(err){ console.error("board save", err); showToast("Save failed \u2014 see console"); }
}

export async function persistDeleteBoard(id){
  try{
    if(state.backend==="folder"){ await fsDelete(boardFileName(id)); await fsWrite("index.json", indexPayload()); }
    else if(state.backend==="cloud"){ await cloudPersistDeleteBoard(id); }
    else if(state.backend==="app"){ await window.storage.delete("mindmap:board:"+id, false); }
  }catch(err){}
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
  clearTimeout(state.saveTimers[id]);
  state.saveTimers[id] = setTimeout(()=>saveBoardNow(id), 500);
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

export function updateStorageBar(){
  const bar = el("storageBar");
  if(!bar) return;
  let cls, label, sub;
  if(state.backend==="folder"){
    cls="ok"; label="Saving to folder";
    sub=(state.rootHandle && state.rootHandle.name ? state.rootHandle.name+"/" : "")+"saved-boards/";
  } else if(state.backend==="cloud"){
    cls="ok"; label="Saving to cloud";
    sub=(state.supabaseSession && state.supabaseSession.user) ? state.supabaseSession.user.email : "Supabase";
  } else if(state.backend==="app"){
    cls="ok"; label="Saving in this browser";
    sub="Connect a folder to save real files";
  } else {
    cls="warn"; label="Not saving yet";
    sub="Connect a folder to keep your work";
  }
  bar.className = "storage-bar "+cls;
  bar.querySelector(".sb-label").textContent = label;
  bar.querySelector(".sb-sub").textContent = sub;
  el("connectFolderBtn").textContent = state.backend==="folder" ? "Change folder" : "Connect folder";
}
