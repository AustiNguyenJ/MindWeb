import { createClient } from "@supabase/supabase-js";
import { state } from "./state.js";
import { el } from "./dom.js";
import { showToast } from "./toast.js";
import { ensureNotebookStructure } from "./boards.js";
import { updateStorageBar } from "./storage.js";
import { historyReset } from "./history.js";
import { centerView } from "./view.js";
import { migrateNode } from "./nodes.js";
import { renderBoard } from "./render.js";
import { renderBoardList, renderBoardHeader } from "./sidebar.js";
import { renderTypeToolbar } from "./designer.js";

/* Supabase: client construction, the email magic-link sign-in flow, the
   sidebar's cloud status bar, and the cloud storage backend.

   The client is constructed and the auth listeners registered while this
   module evaluates, exactly as they were in the single-file version, so the
   sign-in flow keeps its original ordering. */

/* ---------- Supabase client (cloud backend, work in progress) ---------
   Configured through .env (see .env.example), not hardcoded here.

   Note that Vite inlines every VITE_* value into the built bundle, so
   these are visible to anyone who opens the page. That is fine for a
   PUBLISHABLE key, which is gated by the RLS policies in
   mindmap-studio-schema-fix.sql -- but a secret key (sb_secret_...) must
   never be put in a VITE_* variable.

   Leaving the variables blank switches the cloud backend off entirely,
   which is how the test suite runs.
------------------------------------------------------------------------ */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

if(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY){
  // Guarded because supabase-js is now a hard import rather than an optional
  // CDN global: an exception here would otherwise abort the whole script and
  // leave a blank page, where the CDN version merely lost cloud sync.
  try{
    state.supabaseClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    console.log("[mindmap] Supabase client created for", SUPABASE_URL);
  }catch(err){
    state.supabaseClient = null;
    console.warn("[mindmap] Supabase client failed to start; continuing without cloud sync.", err);
  }
} else {
  console.warn("[mindmap] Supabase not configured -- set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env to enable cloud sync.");
}

/* ---------- Supabase auth (email magic link) ---------------------------
   Every RLS policy in the schema checks auth.uid(), so nothing will read
   or write through Supabase until someone is signed in. This wires a
   minimal email-link sign-in flow in the sidebar. It does not touch board
   storage yet -- backend stays "folder"/"app"/"memory" until that's next.
------------------------------------------------------------------------ */
let cloudConnectAttempted = false;   // guards against connecting twice per page load

export function updateCloudBar(){
  const bar = el("cloudBar");
  if(!bar) return;
  if(!state.supabaseClient){ bar.style.display = "none"; return; }
  bar.style.display = "";
  const label = el("cloudLabel"), sub = el("cloudSub"), actions = el("cloudActions");
  if(state.supabaseSession){
    bar.className = "storage-bar ok";
    label.textContent = "Signed in";
    sub.textContent = state.supabaseSession.user.email;
    actions.innerHTML = '<button id="cloudSignOutBtn">Sign out</button>';
    el("cloudSignOutBtn").addEventListener("click", async ()=>{ await state.supabaseClient.auth.signOut(); });
  } else {
    bar.className = "storage-bar warn";
    label.textContent = "Not signed in";
    sub.textContent = "Sign in for cloud sync";
    actions.innerHTML =
      '<input id="cloudEmailInput" type="email" placeholder="you@email.com" '+
      'style="flex:1;min-width:0;font-size:12px;padding:5px 7px;border:1px solid var(--line);border-radius:6px;font-family:var(--body);">'+
      '<button id="cloudSignInBtn">Send link</button>';
    el("cloudSignInBtn").addEventListener("click", sendMagicLink);
    el("cloudEmailInput").addEventListener("keydown",(e)=>{ if(e.key==="Enter") sendMagicLink(); });
  }
}

async function sendMagicLink(){
  const input = el("cloudEmailInput");
  const email = input ? input.value.trim() : "";
  if(!email || email.indexOf("@")===-1){ showToast("Enter a valid email"); return; }
  const btn = el("cloudSignInBtn");
  if(btn){ btn.disabled = true; btn.textContent = "Sending\u2026"; }
  const { error } = await state.supabaseClient.auth.signInWithOtp({
    email, options:{ emailRedirectTo: window.location.href }
  });
  if(error){
    showToast("Couldn't send link: "+error.message);
    if(btn){ btn.disabled = false; btn.textContent = "Send link"; }
    return;
  }
  showToast("Check your email for a sign-in link");
  if(btn) btn.textContent = "Link sent";
}

if(state.supabaseClient){
  updateCloudBar();
  state.supabaseClient.auth.getSession().then(({data})=>{
    state.supabaseSession = data.session;
    updateCloudBar();
    if(state.supabaseSession) connectCloud();
  });
  state.supabaseClient.auth.onAuthStateChange((event, session)=>{
    state.supabaseSession = session;
    updateCloudBar();
    if(event==="SIGNED_IN"){ showToast("Signed in as "+session.user.email); connectCloud(); }
    if(event==="SIGNED_OUT"){
      showToast("Signed out");
      cloudConnectAttempted = false;
      // stop trying to save to Supabase now that there's no session; local
      // edits still work, they just won't persist until signed in again
      if(state.backend==="cloud") state.backend = "memory";
      updateStorageBar();
    }
  });
}

/* ---------- Supabase cloud backend --------------------------------------
   Normalized tables (see mindmap-studio-schema.sql / -fix.sql), synced
   with the same "save the whole board on every debounced tick" model the
   folder/app backends already use: cloudPersistBoard() diffs the local
   nodes/connections against Supabase and upserts + deletes to match,
   rather than patching individual fields at every call site in the file.
   Wired into persistIndex/persistBoard/persistDeleteBoard/saveTypesNow
   below via a "cloud" branch, so every existing save call site works
   unchanged once backend==="cloud".
------------------------------------------------------------------------ */

function cloudUserId(){ return (state.supabaseSession && state.supabaseSession.user) ? state.supabaseSession.user.id : null; }

/* Pull everything the signed-in user can see out of Supabase and rebuild
   notebooks / boards / boardsData / customTypes in the shape the rest of
   the app already expects. Returns false (and touches nothing) if the
   account has no boards yet, so the caller knows to seed it instead. */
async function cloudReadAll(){
  const [{data:nbRows, error:nbErr}, {data:boardRows, error:bErr}, {data:typeRows, error:tErr}] = await Promise.all([
    state.supabaseClient.from("notebooks").select("*").order("created_at"),
    state.supabaseClient.from("boards").select("*"),
    state.supabaseClient.from("block_types").select("*")
  ]);
  if(nbErr || bErr || tErr){ console.error("[mindmap] cloud read failed", nbErr||bErr||tErr); return false; }
  if(!boardRows.length) return false;

  state.notebooks = nbRows.map(r=>({ id:r.id, name:r.name, collapsed:!!r.collapsed }));
  state.boards = boardRows.map(r=>({
    id:r.id, name:r.name, description:r.description||"", notebookId:r.notebook_id,
    order:r.sort_order, pinned:!!r.pinned
  }));
  state.customTypes = {};
  (typeRows||[]).forEach(r=>{
    state.customTypes[r.id] = { id:r.id, name:r.name, accent:r.accent, width:r.width, fields:r.fields||[], builtin:!!r.builtin };
  });

  state.boardsData = {};
  for(const b of state.boards){
    const [{data:nodeRows, error:nErr}, {data:connRows, error:cErr}] = await Promise.all([
      state.supabaseClient.from("nodes").select("*").eq("board_id", b.id),
      state.supabaseClient.from("connections").select("*").eq("board_id", b.id)
    ]);
    if(nErr || cErr){ console.error("[mindmap] cloud board read failed", b.id, nErr||cErr); state.boardsData[b.id]={nodes:[],connections:[]}; continue; }
    state.boardsData[b.id] = {
      nodes: (nodeRows||[]).map(r=>migrateNode({
        id:r.id, type:r.type, x:r.x, y:r.y, w:r.w, h:r.h, title:r.title||"",
        body:r.body||"", bodyHtml:r.body_html||"", color:r.color||"#ffffff",
        fields:r.fields||{}, collapsed:!!r.collapsed
      })),
      connections: (connRows||[]).map(r=>({
        id:r.id, from:r.from_node, fromItem:r.from_item, to:r.to_node, toItem:r.to_item, label:r.label
      }))
    };
  }
  ensureNotebookStructure();
  return true;
}

export async function cloudPersistIndex(){
  const uid = cloudUserId();
  if(!uid) return;
  // NOTE: once board sharing has an invite UI, this needs to stop writing
  // owner_id for boards the signed-in user doesn't own. Harmless for now
  // since there's no way yet for a board to belong to anyone else.
  if(state.notebooks.length){
    const rows = state.notebooks.map(nb=>({ id:nb.id, owner_id:uid, name:nb.name, collapsed:!!nb.collapsed }));
    const { error } = await state.supabaseClient.from("notebooks").upsert(rows);
    if(error) throw error;
  }
  if(state.boards.length){
    const rows = state.boards.map(b=>({
      id:b.id, owner_id:uid, notebook_id:b.notebookId||null, name:b.name,
      description:b.description||"", sort_order:b.order||0, pinned:!!b.pinned
    }));
    const { error } = await state.supabaseClient.from("boards").upsert(rows);
    if(error) throw error;
  }
}

export async function cloudPersistBoard(id){
  const data = state.boardsData[id] || {nodes:[],connections:[]};
  const localNodeIds = new Set(data.nodes.map(n=>n.id));
  const localConnIds = new Set(data.connections.map(c=>c.id));

  const [{data:existingNodes}, {data:existingConns}] = await Promise.all([
    state.supabaseClient.from("nodes").select("id").eq("board_id", id),
    state.supabaseClient.from("connections").select("id").eq("board_id", id)
  ]);
  const staleConnIds = (existingConns||[]).map(r=>r.id).filter(cid=>!localConnIds.has(cid));
  const staleNodeIds = (existingNodes||[]).map(r=>r.id).filter(nid=>!localNodeIds.has(nid));

  // connections reference nodes, so remove stale connections before stale nodes,
  // and upsert nodes before connections that might point at brand-new ones
  if(staleConnIds.length) await state.supabaseClient.from("connections").delete().in("id", staleConnIds);
  if(staleNodeIds.length) await state.supabaseClient.from("nodes").delete().in("id", staleNodeIds);

  if(data.nodes.length){
    const rows = data.nodes.map(n=>({
      id:n.id, board_id:id, type:n.type, x:n.x||0, y:n.y||0, w:n.w||null, h:n.h||null,
      title:n.title||"", body:n.body||"", body_html:n.bodyHtml||"", color:n.color||"#ffffff",
      fields:n.fields||{}, collapsed:!!n.collapsed, updated_by:cloudUserId()
    }));
    const { error } = await state.supabaseClient.from("nodes").upsert(rows);
    if(error) throw error;
  }
  if(data.connections.length){
    const rows = data.connections.map(c=>({
      id:c.id, board_id:id, from_node:c.from, from_item:c.fromItem||null,
      to_node:c.to, to_item:c.toItem||null, label:c.label||null
    }));
    const { error } = await state.supabaseClient.from("connections").upsert(rows);
    if(error) throw error;
  }
}

export async function cloudPersistDeleteBoard(id){
  // ON DELETE CASCADE on nodes/connections/board_members handles the rest
  try{ await state.supabaseClient.from("boards").delete().eq("id", id); }catch(err){}
}

export async function cloudSaveTypes(){
  const uid = cloudUserId();
  if(!uid || !Object.keys(state.customTypes).length) return;
  const rows = Object.keys(state.customTypes).map(tid=>{
    const t = state.customTypes[tid];
    return { id:tid, owner_id:uid, name:t.name||"Custom", accent:t.accent||"#ffffff",
             width:t.width||220, fields:t.fields||[], builtin:!!t.builtin };
  });
  const { error } = await state.supabaseClient.from("block_types").upsert(rows);
  if(error) console.error("[mindmap] cloud types save failed", error);
}

/* Runs once per page load, right after a session appears. Mirrors
   connectFolder()'s "read what's there, or seed it from what I have"
   shape. If a folder is already connected, that stays authoritative --
   signing in doesn't redirect saves away from an explicit local choice. */
export async function connectCloud(){
  if(cloudConnectAttempted || !state.supabaseClient || !state.supabaseSession) return;
  cloudConnectAttempted = true;
  if(state.backend==="folder"){
    showToast("Signed in \u2014 still saving to your folder");
    return;
  }
  try{
    const found = await cloudReadAll();
    if(found){
      state.backend = "cloud";
      state.currentBoardId = state.boards[0].id;
      showToast("Loaded from cloud");
    } else {
      await cloudPersistIndex();
      await cloudSaveTypes();
      for(const b of state.boards){ await cloudPersistBoard(b.id); }
      state.backend = "cloud";
      showToast("Cloud connected \u2014 synced your current boards");
    }
    renderBoardList(); renderBoardHeader(); centerView(); renderBoard();
    renderTypeToolbar(); historyReset(state.currentBoardId); updateStorageBar();
  }catch(err){
    console.error("[mindmap] cloud connect failed", err);
    showToast("Couldn't connect to cloud \u2014 see console");
    cloudConnectAttempted = false;   // allow a retry on next sign-in event
  }
}
