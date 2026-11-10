import { state } from "./state.js";

/* Staged loading of page contents.
 *
 * Startup used to fetch every page's blocks before anything drew. Now the
 * page list, block types and settings arrive first, then the page you will
 * look at, and everything else fills in behind it. Until a page's blocks have
 * arrived it is "pending": it has no entry in state.boardsData and, crucially,
 * it must never be saved. cloudPersistBoard() diffs local blocks against the
 * database and deletes what is missing locally, so saving a not-yet-loaded
 * page would erase it. persistBoard() therefore refuses any pending page, the
 * same way it refuses a corrupt one.
 *
 * This module knows nothing about where pages come from. The backend hands it
 * a loader -- ids in, {id: {nodes, connections}} out -- and it handles the
 * ordering, batching, de-duplication, retries and progress.
 */

const LAST_BOARD_KEY = "mindmap:lastBoard";
const CHUNK = 5;   // pages per request in the background pass

let loader = null;
const inflight = new Map();   // id -> promise, so one page is never fetched twice
const listeners = [];
let background = null;        // promise of the running background pass

export function onLoadProgress(fn){ listeners.push(fn); }
function notify(){ listeners.forEach(fn=>{ try{ fn(); }catch(e){ console.error(e); } }); }

export function isBoardReady(id){ return !state.pendingBoards.has(id); }
export function pendingCount(){ return state.pendingBoards.size; }

/* Register the backend's loader and mark which pages still need fetching. */
export function setPending(ids, backendLoader){
  loader = backendLoader;
  state.pendingBoards = new Set(ids);
  state.bgLoad = { active:false, total:ids.length, done:0 };
}

function finish(id, data){
  // deleted while its fetch was in flight: don't bring it back
  if(!state.boards.some(b=>b.id===id)){ state.pendingBoards.delete(id); return; }
  state.boardsData[id] = data;
  state.pendingBoards.delete(id);
  state.failedBoards.delete(id);
  if(state.bgLoad.total) state.bgLoad.done = Math.min(state.bgLoad.total, state.bgLoad.done + 1);
}

/* Fetch these pages now (those not already ready or on their way). Never
   rejects: pages that fail stay pending, are recorded in failedBoards, and
   are retried the next time something asks for them. */
export function loadBoards(ids){
  const waits = [];
  const fresh = [];
  ids.forEach(id=>{
    if(!state.pendingBoards.has(id)) return;
    if(inflight.has(id)) waits.push(inflight.get(id)); else fresh.push(id);
  });
  if(fresh.length && loader){
    const p = (async ()=>{
      let got = {};
      try{ got = await loader(fresh) || {}; }
      catch(err){ console.error("[mindmap] page load failed", fresh, err); }
      fresh.forEach(id=>{
        if(got[id]) finish(id, got[id]); else state.failedBoards.add(id);
      });
    })().then(()=>{ fresh.forEach(id=>inflight.delete(id)); notify(); });
    fresh.forEach(id=>inflight.set(id, p));
    waits.push(p);
  }
  return Promise.all(waits).then(()=>{});
}

/* Jump the queue: fetch this one page immediately, alongside any background
   batch already in flight. Resolves true if the page is ready afterwards. */
export async function ensureBoardLoaded(id){
  await loadBoards([id]);
  return isBoardReady(id);
}

/* Start filling in the rest, in the order given, a few pages at a time.
   Resolves when the pass is over (pages that failed stay pending). */
export function startBackgroundLoad(orderedIds, onDone){
  if(background) return background;
  state.bgLoad.active = true;
  notify();
  background = (async ()=>{
    for(let i=0; i<orderedIds.length; i+=CHUNK){
      const batch = orderedIds.slice(i, i+CHUNK).filter(id=>state.pendingBoards.has(id));
      if(batch.length) await loadBoards(batch);
      await new Promise(r=>setTimeout(r, 0));   // let input and paint through
    }
    state.bgLoad.active = false;
    background = null;
    notify();
    if(onDone) onDone();
  })();
  return background;
}

/* Resolves true once every page is loaded. Waits for the background pass, then
   retries anything that failed; false means some pages still could not be
   loaded, so a caller that needs all of them must not carry on as if it had. */
export async function whenAllLoaded(){
  if(!state.pendingBoards.size) return true;
  if(background) await background;
  if(state.pendingBoards.size) await loadBoards([...state.pendingBoards]);
  return !state.pendingBoards.size;
}

/* ---- which page to open first -------------------------------------------- */

export function rememberBoard(id){
  try{ localStorage.setItem(LAST_BOARD_KEY, id); }catch(e){ /* storage blocked */ }
}

export function recallBoard(){
  try{ return localStorage.getItem(LAST_BOARD_KEY); }catch(e){ return null; }
}

/* Background order: the open page's notebook first, then the rest in the
   order the sidebar shows them. */
export function backgroundOrder(openId){
  const open = state.boards.find(b=>b.id===openId);
  const nb = open && open.notebookId;
  const pending = state.boards.filter(b=>state.pendingBoards.has(b.id));
  return pending.filter(b=>nb && b.notebookId===nb)
    .concat(pending.filter(b=>!(nb && b.notebookId===nb)))
    .map(b=>b.id);
}
