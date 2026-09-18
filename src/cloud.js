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

/* Built-in node properties that live at the top level (not in node.fields --
   see CLAUDE.md's BUILTIN_KEYS trap) but have no dedicated Supabase column.
   The nodes table only has columns for the fields every node shares
   (title/body_html/color/...); anything type-specific beyond that would
   otherwise need a schema migration every time a built-in type gains a new
   property. Instead these ride inside the same `fields` jsonb column custom
   block types already use, namespaced under __builtin so a Designer-defined
   custom field can never collide with one of these names. */
const CLOUD_BUILTIN_EXTRAS = ["ticketNo", "link", "assigned", "customer", "items", "tickets", "weekLabel", "image"];

export function withBuiltinExtras(fields, node){
  const extras = {};
  let has = false;
  CLOUD_BUILTIN_EXTRAS.forEach(key=>{
    if(node[key]!==undefined){ extras[key] = node[key]; has = true; }
  });
  return has ? { ...fields, __builtin: extras } : fields;
}

export function splitBuiltinExtras(fields){
  const { __builtin, ...rest } = fields || {};
  return { fields: rest, extras: __builtin || {} };
}

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

/* Where email links (verification, password reset) send the browser back
   to. Deliberately just origin+path, not the full href: Supabase appends
   its own hash or query params on top of this, and a Supabase project's
   allowed Redirect URLs are normally registered as exactly this shape. */
function authRedirectURL(){
  return window.location.origin + window.location.pathname;
}

/* Supabase reports an expired or already-used link as error/error_description
   params on the redirect, not as an auth event -- GoTrueClient's own URL
   parsing swallows them internally (see _initialize() in the SDK) without
   telling any onAuthStateChange listener. Read them ourselves, synchronously,
   before that internal parsing has a chance to run (it's async, gated behind
   the client's first await), then scrub the address bar either way so a
   used-up recovery link can't be replayed by refreshing the page. */
function readAuthUrlError(){
  const raw = (window.location.hash || window.location.search || "").replace(/^[#?]/, "");
  const desc = new URLSearchParams(raw).get("error_description");
  return desc ? desc.replace(/\+/g, " ") : null;
}
function clearAuthUrlParams(){
  // best-effort: a file:// origin (this app's other distribution shape) can
  // refuse replaceState entirely, and losing the tidy-up is harmless next to
  // letting that exception abort the rest of boot
  try{
    const url = new URL(window.location.href);
    url.hash = "";
    ["error", "error_code", "error_description", "access_token", "refresh_token",
     "expires_in", "expires_at", "token_type", "type", "code"].forEach((k)=>url.searchParams.delete(k));
    window.history.replaceState(window.history.state, "", url.toString());
  }catch(err){ console.warn("[mindmap] couldn't clean up the auth redirect URL", err); }
}
let authUrlError = state.supabaseClient ? readAuthUrlError() : null;
if(authUrlError) clearAuthUrlParams();

/* ---------- Supabase auth gate (password, email-verified at sign-up) ---
   Every RLS policy in the schema checks auth.uid(), so nothing will read
   or write through Supabase until someone is signed in. When Supabase is
   configured, a full-screen gate (#authGate) blocks the rest of the app
   from booting until requireCloudAuth()'s promise resolves -- see its call
   in main.js. The gate cycles through four forms (sign in, create account,
   forgot password, reset password); "Confirm email" in the project's Auth
   settings is what makes sign-up a one-time email-verification step rather
   than an instant login.

   The sidebar's cloudBar, once signed in, only shows status plus a way
   into the account settings modal (change password / sign out) -- it no
   longer hosts a form of its own. */
let cloudConnectAttempted = false;   // guards against connecting twice per page load
let authMode = "signin";             // signin | signup | forgot | sent | reset
let authSentMessage = "";            // shown in "sent" mode
let authGateResolve = null;
let authGatePromise = null;

/* Resolves once someone is signed in (immediately, if Supabase isn't
   configured or a session already exists). main.js awaits this before
   loading board data, so nothing renders behind an unauthenticated gate. */
export function requireCloudAuth(){
  if(!state.supabaseClient || state.supabaseSession) return Promise.resolve();
  if(!authGatePromise){
    authGatePromise = new Promise((resolve)=>{ authGateResolve = resolve; });
    showAuthGate();
  }
  return authGatePromise;
}

function resolveAuthGate(){
  hideAuthGate();
  if(authGateResolve){ authGateResolve(); authGateResolve = null; }
}

function showAuthGate(){
  const gate = el("authGate");
  if(!gate) return;
  gate.classList.add("open");
  renderAuthGate();
}
function hideAuthGate(){
  const gate = el("authGate");
  if(gate) gate.classList.remove("open");
}

function setAuthBusy(busy, label){
  const btn = el("authSubmitBtn");
  if(!btn) return;
  btn.disabled = busy;
  if(label) btn.textContent = label;
}

function renderAuthGate(){
  const subtitle = el("authSubtitle"), fields = el("authFields"), links = el("authLinks"), submitBtn = el("authSubmitBtn");
  el("authError").textContent = "";
  submitBtn.style.display = "";
  submitBtn.disabled = false;

  if(authMode==="signup"){
    subtitle.textContent = "Create an account to continue";
    fields.innerHTML =
      '<label>Email<input id="authEmailInput" type="email" autocomplete="email" required></label>'+
      '<label>Password<input id="authPasswordInput" type="password" autocomplete="new-password" required></label>';
    submitBtn.textContent = "Create account";
    links.innerHTML = '<button type="button" class="auth-link" id="authToggleBtn">Already have an account? Sign in</button>';
    el("authToggleBtn").addEventListener("click", ()=>{ authMode="signin"; renderAuthGate(); });
  } else if(authMode==="forgot"){
    subtitle.textContent = "Enter your email and we\u2019ll send a reset link";
    fields.innerHTML = '<label>Email<input id="authEmailInput" type="email" autocomplete="email" required></label>';
    submitBtn.textContent = "Send reset link";
    links.innerHTML = '<button type="button" class="auth-link" id="authToggleBtn">Back to sign in</button>';
    el("authToggleBtn").addEventListener("click", ()=>{ authMode="signin"; renderAuthGate(); });
  } else if(authMode==="sent"){
    subtitle.textContent = authSentMessage;
    fields.innerHTML = "";
    submitBtn.style.display = "none";
    links.innerHTML = '<button type="button" class="auth-link" id="authToggleBtn">Back to sign in</button>';
    el("authToggleBtn").addEventListener("click", ()=>{ authMode="signin"; renderAuthGate(); });
  } else if(authMode==="reset"){
    subtitle.textContent = "Choose a new password for your account";
    fields.innerHTML =
      '<label>New password<input id="authPasswordInput" type="password" autocomplete="new-password" required></label>'+
      '<label>Confirm new password<input id="authPassword2Input" type="password" autocomplete="new-password" required></label>';
    submitBtn.textContent = "Set new password";
    links.innerHTML = "";
  } else {
    authMode = "signin";
    subtitle.textContent = "Sign in to continue";
    fields.innerHTML =
      '<label>Email<input id="authEmailInput" type="email" autocomplete="email" required></label>'+
      '<label>Password<input id="authPasswordInput" type="password" autocomplete="current-password" required></label>';
    submitBtn.textContent = "Sign in";
    links.innerHTML =
      '<button type="button" class="auth-link" id="authForgotBtn">Forgot password?</button>'+
      '<button type="button" class="auth-link" id="authToggleBtn">New here? Create an account</button>';
    el("authForgotBtn").addEventListener("click", ()=>{ authMode="forgot"; renderAuthGate(); });
    el("authToggleBtn").addEventListener("click", ()=>{ authMode="signup"; renderAuthGate(); });
    if(authUrlError){
      el("authError").textContent = authUrlError+" Request a new link below.";
      authUrlError = null;
    }
  }
}

async function onAuthSubmit(e){
  e.preventDefault();
  const emailInput = el("authEmailInput");
  const email = emailInput ? emailInput.value.trim() : "";
  if(authMode==="signin") return doSignIn(email, el("authPasswordInput").value);
  if(authMode==="signup") return doSignUp(email, el("authPasswordInput").value);
  if(authMode==="forgot") return doForgotPassword(email);
  if(authMode==="reset") return doResetPassword(el("authPasswordInput").value, el("authPassword2Input").value);
}

async function doSignIn(email, password){
  const err = el("authError");
  if(!email || email.indexOf("@")===-1){ err.textContent = "Enter a valid email"; return; }
  if(!password){ err.textContent = "Enter your password"; return; }
  setAuthBusy(true, "Signing in\u2026");
  const { error } = await state.supabaseClient.auth.signInWithPassword({ email, password });
  if(error){
    err.textContent = error.message==="Email not confirmed"
      ? "Check your email to verify your account first" : error.message;
    setAuthBusy(false, "Sign in");
    return;
  }
  // onAuthStateChange (SIGNED_IN) closes the gate from here
}

async function doSignUp(email, password){
  const err = el("authError");
  if(!email || email.indexOf("@")===-1){ err.textContent = "Enter a valid email"; return; }
  if(password.length < 6){ err.textContent = "Password must be at least 6 characters"; return; }
  setAuthBusy(true, "Creating account\u2026");
  const { data, error } = await state.supabaseClient.auth.signUp({
    email, password, options:{ emailRedirectTo: authRedirectURL() }
  });
  if(error){ err.textContent = error.message; setAuthBusy(false, "Create account"); return; }
  if(!data.session){
    // "Confirm email" is on for this project: signInWithPassword will
    // refuse until the link in that email is clicked
    authSentMessage = "Check "+email+" for a verification link, then sign in.";
    authMode = "sent";
    renderAuthGate();
  }
  // if a session came back, confirmation is off and SIGNED_IN closes the
  // gate on its own
}

async function doForgotPassword(email){
  const err = el("authError");
  if(!email || email.indexOf("@")===-1){ err.textContent = "Enter a valid email"; return; }
  setAuthBusy(true, "Sending\u2026");
  const { error } = await state.supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: authRedirectURL() });
  setAuthBusy(false, "Send reset link");
  if(error){ err.textContent = error.message; return; }
  authSentMessage = "Check "+email+" for a link to reset your password.";
  authMode = "sent";
  renderAuthGate();
}

async function doResetPassword(password, password2){
  const err = el("authError");
  if(password.length < 6){ err.textContent = "Password must be at least 6 characters"; return; }
  if(password !== password2){ err.textContent = "Passwords don\u2019t match"; return; }
  setAuthBusy(true, "Saving\u2026");
  const { error } = await state.supabaseClient.auth.updateUser({ password });
  setAuthBusy(false, "Set new password");
  if(error){ err.textContent = error.message; return; }
  showToast("Password updated");
  authMode = "signin";
  // the recovery link already carries a live session, so the normal
  // SIGNED_IN handling never fires for it -- resolve the gate directly
  resolveAuthGate();
}

/* ---------- Account settings modal (change password / sign out) -------- */
export function initAuthGate(){
  const form = el("authForm");
  if(form) form.addEventListener("submit", onAuthSubmit);

  const acctBtn = el("cloudAccountBtn");
  if(acctBtn) acctBtn.addEventListener("click", openAccountModal);
  const acctClose = el("acctClose");
  if(acctClose) acctClose.addEventListener("click", closeAccountModal);
  const acctOverlay = el("acctOverlay");
  if(acctOverlay) acctOverlay.addEventListener("click", (e)=>{ if(e.target===acctOverlay) closeAccountModal(); });
  const acctSave = el("acctSaveBtn");
  if(acctSave) acctSave.addEventListener("click", saveAccountPassword);
  const acctSignOut = el("acctSignOutBtn");
  if(acctSignOut) acctSignOut.addEventListener("click", async ()=>{ await state.supabaseClient.auth.signOut(); });
}

function openAccountModal(){
  const overlay = el("acctOverlay");
  if(!overlay) return;
  el("acctEmail").value = (state.supabaseSession && state.supabaseSession.user) ? state.supabaseSession.user.email : "";
  el("acctNewPassword").value = "";
  el("acctConfirmPassword").value = "";
  el("acctError").textContent = "";
  overlay.classList.add("open");
}
function closeAccountModal(){
  const overlay = el("acctOverlay");
  if(overlay) overlay.classList.remove("open");
}

async function saveAccountPassword(){
  const p1 = el("acctNewPassword").value, p2 = el("acctConfirmPassword").value;
  const err = el("acctError");
  err.textContent = "";
  if(!p1 && !p2){ err.textContent = "Enter a new password"; return; }
  if(p1.length < 6){ err.textContent = "Password must be at least 6 characters"; return; }
  if(p1 !== p2){ err.textContent = "Passwords don\u2019t match"; return; }
  const btn = el("acctSaveBtn");
  btn.disabled = true; btn.textContent = "Saving\u2026";
  const { error } = await state.supabaseClient.auth.updateUser({ password: p1 });
  btn.disabled = false; btn.textContent = "Update password";
  if(error){ err.textContent = error.message; return; }
  showToast("Password updated");
  closeAccountModal();
}

export function updateCloudBar(){
  const bar = el("cloudBar");
  if(!bar) return;
  if(!state.supabaseClient || !state.supabaseSession){ bar.style.display = "none"; return; }
  bar.style.display = "";
  bar.className = "storage-bar ok";
  el("cloudLabel").textContent = "Signed in";
  el("cloudSub").textContent = state.supabaseSession.user.email;
}

if(state.supabaseClient){
  updateCloudBar();
  state.supabaseClient.auth.getSession().then(({data})=>{
    state.supabaseSession = data.session;
    updateCloudBar();
    if(state.supabaseSession){
      resolveAuthGate();
      connectCloud();
      // an expired/used link's error can't reach the gate if a session from
      // elsewhere already got us past it -- say so some other way
      if(authUrlError){ showToast(authUrlError); authUrlError = null; }
    }
  });
  state.supabaseClient.auth.onAuthStateChange((event, session)=>{
    state.supabaseSession = session;
    updateCloudBar();
    if(event==="PASSWORD_RECOVERY"){
      // the recovery link signs the visitor in on the spot -- force the
      // reset-password form instead of treating this as a normal sign-in
      authMode = "reset";
      showAuthGate();
      return;
    }
    if(event==="SIGNED_IN" && session){
      showToast("Signed in as "+session.user.email);
      resolveAuthGate();
      connectCloud();
    }
    if(event==="SIGNED_OUT"){
      // reload rather than unwind in-memory board/notebook state by hand --
      // the next load starts clean and the gate reappears on its own
      window.location.reload();
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
      nodes: (nodeRows||[]).map(r=>{
        const { fields, extras } = splitBuiltinExtras(r.fields);
        return migrateNode({
          id:r.id, type:r.type, x:r.x, y:r.y, w:r.w, h:r.h, title:r.title||"",
          body:r.body||"", bodyHtml:r.body_html||"", color:r.color||"#ffffff",
          fields, collapsed:!!r.collapsed, ...extras
        });
      }),
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
      fields:withBuiltinExtras(n.fields||{}, n), collapsed:!!n.collapsed, updated_by:cloudUserId()
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
  const { error } = await state.supabaseClient.from("boards").delete().eq("id", id);
  if(error) throw error;
}

/* cloudPersistIndex() only ever upserts the notebooks currently in
   state.notebooks, so a notebook removed locally never gets removed from
   Supabase on its own -- it just comes back on the next cloudReadAll().
   Deleting a notebook needs this explicit row delete alongside it. */
export async function cloudPersistDeleteNotebook(id){
  const { error } = await state.supabaseClient.from("notebooks").delete().eq("id", id);
  if(error) throw error;
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
