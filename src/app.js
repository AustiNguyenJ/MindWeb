(function(){
  "use strict";

  const IDX_KEY = "mindmap:index";
  const COLORS = ["#ffffff","#fde68a","#bfdbfe","#bbf7d0","#fecaca","#e9d5ff"];
  const DEFAULT_SIZE = { header:[220,50], note:[220,140], list:[230,150], question:[220,140],
                         image:[240,190], ticket:[262,190], week:[330,260] };
  const HOTKEYS = { h:"header", n:"note", l:"list", q:"question", g:"image", t:"ticket", w:"week" };

  /* Custom block types the user defines in the Block Designer. Each is a
     schema: a list of fields, plus a default width. Stored per-file so a
     board carries its own block library. Persisted under mindmap:types. */
  const TYPES_KEY = "mindmap:types";
  let customTypes = {};   // typeId -> {id,name,accent,width,fields:[...]}

  const FIELD_KINDS = ["text","richtext","link","number","date","select","checkbox","group"];
  function blankField(){
    return { key:uid().slice(0,6), label:"Field", kind:"text", placeholder:"", options:"", subfields:[], layout:"rows" };
  }
  function blankSubfield(){
    return { key:uid().slice(0,6), label:"Step", kind:"text", placeholder:"" };
  }
  function blankGroupRow(subfields){
    const row = {};
    (subfields||[]).forEach(sf=>{ row[sf.key] = ""; });
    return row;
  }
  function isCustomType(t){ return !!customTypes[t]; }

  /* Built-in types that CAN be edited in the designer are expressed as the same
     schema format and seeded into customTypes on first run. Their ids match the
     original type names so existing nodes keep working. The repeating-row types
     (list, week) and the structural ones (header, image) stay hardcoded and are
     shown in the designer as read-only. */
  const EDITABLE_BUILTINS = {
    note: { id:"note", name:"Note", accent:"#ffffff", width:220, builtin:true,
      fields:[ {key:"bodyHtml", label:"Notes", kind:"richtext", placeholder:"Notes...", options:""} ] },
    question: { id:"question", name:"Question", accent:"#ffffff", width:220, builtin:true,
      fields:[ {key:"bodyHtml", label:"Question", kind:"richtext", placeholder:"What are we not sure about?", options:""} ] },
    ticket: { id:"ticket", name:"Ticket", accent:"#ffffff", width:262, builtin:true,
      fields:[
        {key:"ticketNo", label:"No.", kind:"text", placeholder:"INC-0000", options:""},
        {key:"link", label:"Link", kind:"link", placeholder:"Paste URL", options:""},
        {key:"assigned", label:"Assigned", kind:"text", placeholder:"Assigned to", options:""},
        {key:"customer", label:"Customer", kind:"text", placeholder:"Customer", options:""},
        {key:"bodyHtml", label:"Notes", kind:"richtext", placeholder:"Notes...", options:""}
      ] }
  };
  const PROTECTED_BUILTINS = {
    list: { name:"List", accent:"#ffffff", note:"Repeating lines, each with its own branch point." },
    week: { name:"Week", accent:"#ffffff", note:"Repeating ticket rows plus a shared notes area." },
    header: { name:"Header", accent:"#4757d1", note:"A plain title divider." },
    image: { name:"Image", accent:"#bfdbfe", note:"A single pasted or uploaded image." }
  };

  function seedBuiltinTypes(){
    Object.keys(EDITABLE_BUILTINS).forEach(id=>{
      if(!customTypes[id]){
        customTypes[id] = JSON.parse(JSON.stringify(EDITABLE_BUILTINS[id]));
      } else {
        customTypes[id].builtin = true;   // keep the flag even if loaded from storage
      }
    });
  }

  /* Recover custom block types whose definition file was lost but whose blocks
     still carry data. We scan every board for nodes of a ct_* type that isn't
     in customTypes, and rebuild a working schema by inspecting the field data:
       - a value that's an array of row objects  -> a "group" field, with
         subfields inferred from the row keys (HTML-looking values = richtext)
       - a string value                          -> a richtext field
     This makes orphaned blocks display and stay editable again. Reconstructed
     types are marked so we can tell the user and let them relabel in the designer. */
  function looksRich(v){ return typeof v==="string" && /<[a-z][\s\S]*>/i.test(v); }

  function reconstructMissingTypes(){
    const missing = {};   // typeId -> {fieldKey -> inferred field}
    Object.keys(boardsData).forEach(bid=>{
      (boardsData[bid].nodes||[]).forEach(n=>{
        if(typeof n.type!=="string" || n.type.indexOf("ct_")!==0) return;
        if(customTypes[n.type]) return;                 // definition present, nothing to do
        if(!n.fields || typeof n.fields!=="object") return;
        const acc = missing[n.type] || (missing[n.type] = {});
        Object.keys(n.fields).forEach(fk=>{
          if(fk==="undefined") return;                  // stray key from an old bug, skip
          const v = n.fields[fk];
          if(Array.isArray(v)){
            // group field: infer subfields from the union of row keys
            const sub = acc[fk] && acc[fk].kind==="group" ? acc[fk] : {key:fk, label:"Rows", kind:"group", subfields:[], addLabel:"row", layout:"rows"};
            const seen = new Set(sub.subfields.map(s=>s.key));
            v.forEach(row=>{
              if(row && typeof row==="object") Object.keys(row).forEach(sk=>{
                if(!seen.has(sk)){
                  seen.add(sk);
                  const rich = looksRich(row[sk]);
                  sub.subfields.push({ key:sk, label:"", kind: rich?"richtext":"text", placeholder:"" });
                }
              });
            });
            // label the columns: rich columns -> "Details", the rest -> "Title"
            // (only one plain + one rich is the common step/description shape)
            sub.subfields.forEach((s,i)=>{
              if(s.label) return;
              if(s.kind==="richtext") s.label = "Details";
              else s.label = sub.subfields.length>1 ? "Title" : "Item";
            });
            acc[fk] = sub;
          } else if(!acc[fk]){
            const rich = looksRich(v);
            acc[fk] = { key:fk, label: rich?"Notes":"Heading", kind: rich?"richtext":"text", placeholder:"", options:"" };
          }
        });
      });
    });

    let recovered = 0;
    Object.keys(missing).forEach(typeId=>{
      const fields = Object.keys(missing[typeId]).map(k=>missing[typeId][k]);
      if(!fields.length) return;
      // put group fields last so simple fields (like a heading) read first
      fields.sort((a,b)=> (a.kind==="group"?1:0) - (b.kind==="group"?1:0));
      customTypes[typeId] = {
        id: typeId,
        name: "Recovered block",
        accent: "#ffffff",
        width: 300,
        fields: fields,
        recovered: true
      };
      recovered++;
    });
    if(recovered){
      queueTypesSave();
      setTimeout(()=>showToast(recovered+" block type"+(recovered>1?"s":"")+" recovered from page data \u2014 relabel in Design blocks"), 500);
    }
    return recovered;
  }

  /* Every block type the user can create, for the connection-drop picker.
     Order: common built-ins first, then structural ones, then custom types. */
  function spawnableTypes(){
    const list = [];
    const seen = new Set();
    const push = (type, name, accent)=>{ if(!seen.has(type)){ seen.add(type); list.push({type, name, accent}); } };
    // preferred built-in order
    push("note", "Note", "#ffffff");
    push("question", "Question", "#ffffff");
    push("list", "List", "#ffffff");
    push("ticket", "Ticket", "#ffffff");
    push("week", "Week", "#ffffff");
    push("header", "Header", "#4757d1");
    push("image", "Image", "#bfdbfe");
    // any custom (non-builtin) types
    Object.keys(customTypes).forEach(id=>{
      const t = customTypes[id];
      if(!t.builtin) push(id, t.name || "Custom", t.accent || "#ffffff");
    });
    return list;
  }

  let boards = [], boardsData = {}, currentBoardId = null;
  let notebooks = [];            // [{id, name, collapsed}]
  let searchScope = { mode:"all", id:null };   // all | notebook | page
  let selection = new Set();   // ids of selected boxes
  let selectedConnId = null;

  let marqueeEl = null;
  let clipboardNode = null, dragState = null;
  let saveTimers = {}, toastTimer = null;
  let itemOffsets = {};              // nodeId -> [y offset of each list/week row]
  let groupOffsets = {};             // nodeId -> { "g:field:idx": yOffset }
  let cursorCanvas = { x:2100, y:1500 };
  let linkTipEl = null;

  const el = (id)=>document.getElementById(id);
  const viewport = el("viewport");
  const canvasInner = el("canvasInner");
  const connSvg = el("connSvg");
  const toastEl = el("toast");
  const imgFileInput = el("imgFileInput");

  let view = { x:0, y:0, scale:1 };

  function uid(){ return Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4); }
  const RICH_OK_TAGS = ["B","STRONG","I","EM","U","A","UL","OL","LI","BR","DIV","P","SPAN","CODE"];
  const RICH_DROP_TAGS = ["SCRIPT","STYLE","IFRAME","OBJECT","EMBED","NOSCRIPT","TEMPLATE","SVG","MATH"];
  function sanitizeHtml(html){
    const tpl = document.createElement("template");
    tpl.innerHTML = html || "";
    tpl.content.querySelectorAll("*").forEach(node=>{
      if(!node.isConnected && !tpl.content.contains(node)) return;
      if(RICH_DROP_TAGS.indexOf(node.tagName)!==-1){ node.remove(); return; }
      if(RICH_OK_TAGS.indexOf(node.tagName)===-1){
        const parent = node.parentNode;
        while(node.firstChild) parent.insertBefore(node.firstChild, node);
        node.remove();
        return;
      }
      [...node.attributes].forEach(attr=>{
        const n = attr.name.toLowerCase();
        const v = (attr.value||"").trim().toLowerCase();
        const allowed = (n==="href" || n==="title" || n==="target" || n==="rel");
        const badProto = v.indexOf("javascript:")===0 || v.indexOf("data:text/html")===0;
        if(!allowed || badProto) node.removeAttribute(attr.name);
      });
      if(node.tagName==="A"){
        node.setAttribute("target","_blank");
        node.setAttribute("rel","noopener noreferrer");
      }
    });
    return tpl.innerHTML;
  }
  function plainToHtml(txt){
    if(!txt) return "";
    return txt.split("\n").map(l=>escapeHtml(l)).join("<br>");
  }
  function richToText(html){
    const d = document.createElement("div");
    d.innerHTML = html || "";
    return (d.textContent||"").replace(/\s+/g," ").trim();
  }
  /* Coerce a stored field value into safe rich HTML. Values written by the old
     plain-text 'longtext' field have no markup, so we convert their newlines to
     <br>; values already containing HTML are just sanitized. */
  function richValue(val){
    if(!val) return "";
    const looksHtml = /<[a-z][\s\S]*>/i.test(val);
    return looksHtml ? sanitizeHtml(val) : plainToHtml(val);
  }
  function normalizeUrl(u){
    u = (u||"").trim();
    if(!u) return "";
    if(/^https?:\/\//i.test(u)) return u;
    if(/^[\w.-]+\.[a-z]{2,}/i.test(u)) return "https://"+u;
    return u;
  }

  /* Open a link in a BACKGROUND tab, like middle-clicking on the web. Browsers
     only keep a new tab in the background when the navigation comes from a real
     anchor activated with a middle-click or ctrl/cmd+click; window.open always
     steals focus. So we build a throwaway <a target="_blank"> and dispatch a
     ctrl/cmd+click on it, then remove it. Falls back to window.open if blocked. */
  function openLinkBackground(url){
    const u = normalizeUrl(url);
    if(!u) return;
    try{
      const a = document.createElement("a");
      a.href = u;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.style.display = "none";
      document.body.appendChild(a);
      const onMac = /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent);
      const ev = new MouseEvent("click", {
        bubbles:true, cancelable:true, view:window,
        button:0, ctrlKey:!onMac, metaKey:onMac
      });
      a.dispatchEvent(ev);
      document.body.removeChild(a);
    }catch(err){
      window.open(u, "_blank", "noopener");
    }
  }
  function currentWeekLabel(){
    const d = new Date();
    const day = (d.getDay()+6)%7;              // Monday = 0
    const mon = new Date(d); mon.setDate(d.getDate()-day);
    const sun = new Date(mon); sun.setDate(mon.getDate()+6);
    const f = (x)=>x.toLocaleDateString(undefined,{month:"short",day:"numeric"});
    return "Week of "+f(mon)+" \u2013 "+f(sun);
  }

  function escapeHtml(s){ return (s||"").replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function escapeAttr(s){ return escapeHtml(s); }

  function showToast(msg){
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>toastEl.classList.remove("show"), 1300);
  }

  function fallbackCopy(txt, done){
    const ta = document.createElement("textarea");
    ta.value = txt;
    ta.style.position="fixed"; ta.style.top="-2000px"; ta.style.opacity="0";
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    let ok=false;
    try{ ok = document.execCommand("copy"); }catch(e){ ok=false; }
    ta.remove();
    if(ok) done(); else showToast("Copy failed");
  }
  function copyText(txt, btn){
    txt = (txt===undefined || txt===null) ? "" : String(txt);
    if(!txt.trim()){ showToast("Nothing to copy"); return; }
    const done = ()=>{
      if(btn){
        const prev = btn.textContent;
        btn.textContent = "\u2713";
        btn.classList.add("copied");
        setTimeout(()=>{ btn.textContent = prev; btn.classList.remove("copied"); }, 900);
      }
      showToast("Copied");
    };
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(txt).then(done).catch(()=>fallbackCopy(txt, done));
    } else {
      fallbackCopy(txt, done);
    }
  }
  const COPY_ICON = "\u29C9";
  function copyBtnHtml(extraClass, title){
    return '<button class="copy-btn '+(extraClass||"")+'" title="'+(title||"Copy")+'">'+COPY_ICON+'</button>';
  }
  function ticketSummary(t){
    const parts = [];
    if(t.no) parts.push(t.no);
    if(t.assigned) parts.push("Assigned: "+t.assigned);
    if(t.customer) parts.push("Customer: "+t.customer);
    if(t.link) parts.push(t.link);
    let out = parts.join("  |  ");
    if(t.note) out += (out?"\n":"")+t.note;
    return out;
  }

  /* True when focus is anywhere the user is typing, so canvas shortcuts stay
     out of the way. Checks the property, the attribute, and any editable
     ancestor, since not every environment exposes all three. */
  function isTextEntry(node){
    if(!node) return false;
    const tag = node.tagName;
    if(tag==="INPUT" || tag==="TEXTAREA" || tag==="SELECT") return true;
    if(node.isContentEditable === true) return true;
    const attr = node.getAttribute && node.getAttribute("contenteditable");
    if(attr === "" || attr === "true") return true;
    if(node.closest && node.closest('[contenteditable="true"]')) return true;
    return false;
  }

  function getBoard(){ return boards.find(b=>b.id===currentBoardId); }
  function getData(){ return boardsData[currentBoardId] || {nodes:[],connections:[]}; }
  function findNode(id){ return getData().nodes.find(n=>n.id===id); }

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
  let backend = "memory";
  let rootHandle = null;   // folder the user picked
  let dirHandle = null;    // <root>/saved-boards

  const FS_SUPPORTED = (typeof window.showDirectoryPicker === "function");

  /* ---------- Supabase client (cloud backend, work in progress) ---------
     Fill in your project's URL and PUBLISHABLE key below.
     Find them in the Supabase dashboard: Project Settings -> API Keys.
     The publishable key is safe to ship in this file -- it's gated by the
     RLS policies from mindmap-studio-schema.sql, same as the old "anon" key.
     Never put the secret key (sb_secret_...) here.
     This block only creates the client and logs whether it connected; the
     save/load functions below don't use it yet -- that wiring is next.
  ------------------------------------------------------------------------ */
  const SUPABASE_URL = "https://tdkxovjkhenlqiylouge.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_tFhuv4zG8OENtcq9WYYSqA_2aFLbRdn";

  let supabaseClient = null;
  if(SUPABASE_URL.indexOf("YOUR-PROJECT-REF")===-1 && typeof window.supabase!=="undefined"){
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    console.log("[mindmap] Supabase client created for", SUPABASE_URL);
  } else if(typeof window.supabase==="undefined"){
    console.warn("[mindmap] supabase-js didn't load -- check the <script src> tag and your internet connection.");
  } else {
    console.warn("[mindmap] Supabase not configured yet -- fill in SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY near the top of the script.");
  }

  /* ---------- Supabase auth (email magic link) ---------------------------
     Every RLS policy in the schema checks auth.uid(), so nothing will read
     or write through Supabase until someone is signed in. This wires a
     minimal email-link sign-in flow in the sidebar. It does not touch board
     storage yet -- backend stays "folder"/"app"/"memory" until that's next.
  ------------------------------------------------------------------------ */
  let supabaseSession = null;
  let cloudConnectAttempted = false;   // guards against connecting twice per page load

  function updateCloudBar(){
    const bar = el("cloudBar");
    if(!bar) return;
    if(!supabaseClient){ bar.style.display = "none"; return; }
    bar.style.display = "";
    const label = el("cloudLabel"), sub = el("cloudSub"), actions = el("cloudActions");
    if(supabaseSession){
      bar.className = "storage-bar ok";
      label.textContent = "Signed in";
      sub.textContent = supabaseSession.user.email;
      actions.innerHTML = '<button id="cloudSignOutBtn">Sign out</button>';
      el("cloudSignOutBtn").addEventListener("click", async ()=>{ await supabaseClient.auth.signOut(); });
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
    const { error } = await supabaseClient.auth.signInWithOtp({
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

  if(supabaseClient){
    updateCloudBar();
    supabaseClient.auth.getSession().then(({data})=>{
      supabaseSession = data.session;
      updateCloudBar();
      if(supabaseSession) connectCloud();
    });
    supabaseClient.auth.onAuthStateChange((event, session)=>{
      supabaseSession = session;
      updateCloudBar();
      if(event==="SIGNED_IN"){ showToast("Signed in as "+session.user.email); connectCloud(); }
      if(event==="SIGNED_OUT"){
        showToast("Signed out");
        cloudConnectAttempted = false;
        // stop trying to save to Supabase now that there's no session; local
        // edits still work, they just won't persist until signed in again
        if(backend==="cloud") backend = "memory";
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

  function cloudUserId(){ return (supabaseSession && supabaseSession.user) ? supabaseSession.user.id : null; }

  /* Pull everything the signed-in user can see out of Supabase and rebuild
     notebooks / boards / boardsData / customTypes in the shape the rest of
     the app already expects. Returns false (and touches nothing) if the
     account has no boards yet, so the caller knows to seed it instead. */
  async function cloudReadAll(){
    const [{data:nbRows, error:nbErr}, {data:boardRows, error:bErr}, {data:typeRows, error:tErr}] = await Promise.all([
      supabaseClient.from("notebooks").select("*").order("created_at"),
      supabaseClient.from("boards").select("*"),
      supabaseClient.from("block_types").select("*")
    ]);
    if(nbErr || bErr || tErr){ console.error("[mindmap] cloud read failed", nbErr||bErr||tErr); return false; }
    if(!boardRows.length) return false;

    notebooks = nbRows.map(r=>({ id:r.id, name:r.name, collapsed:!!r.collapsed }));
    boards = boardRows.map(r=>({
      id:r.id, name:r.name, description:r.description||"", notebookId:r.notebook_id,
      order:r.sort_order, pinned:!!r.pinned
    }));
    customTypes = {};
    (typeRows||[]).forEach(r=>{
      customTypes[r.id] = { id:r.id, name:r.name, accent:r.accent, width:r.width, fields:r.fields||[], builtin:!!r.builtin };
    });

    boardsData = {};
    for(const b of boards){
      const [{data:nodeRows, error:nErr}, {data:connRows, error:cErr}] = await Promise.all([
        supabaseClient.from("nodes").select("*").eq("board_id", b.id),
        supabaseClient.from("connections").select("*").eq("board_id", b.id)
      ]);
      if(nErr || cErr){ console.error("[mindmap] cloud board read failed", b.id, nErr||cErr); boardsData[b.id]={nodes:[],connections:[]}; continue; }
      boardsData[b.id] = {
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

  async function cloudPersistIndex(){
    const uid = cloudUserId();
    if(!uid) return;
    // NOTE: once board sharing has an invite UI, this needs to stop writing
    // owner_id for boards the signed-in user doesn't own. Harmless for now
    // since there's no way yet for a board to belong to anyone else.
    if(notebooks.length){
      const rows = notebooks.map(nb=>({ id:nb.id, owner_id:uid, name:nb.name, collapsed:!!nb.collapsed }));
      const { error } = await supabaseClient.from("notebooks").upsert(rows);
      if(error) throw error;
    }
    if(boards.length){
      const rows = boards.map(b=>({
        id:b.id, owner_id:uid, notebook_id:b.notebookId||null, name:b.name,
        description:b.description||"", sort_order:b.order||0, pinned:!!b.pinned
      }));
      const { error } = await supabaseClient.from("boards").upsert(rows);
      if(error) throw error;
    }
  }

  async function cloudPersistBoard(id){
    const data = boardsData[id] || {nodes:[],connections:[]};
    const localNodeIds = new Set(data.nodes.map(n=>n.id));
    const localConnIds = new Set(data.connections.map(c=>c.id));

    const [{data:existingNodes}, {data:existingConns}] = await Promise.all([
      supabaseClient.from("nodes").select("id").eq("board_id", id),
      supabaseClient.from("connections").select("id").eq("board_id", id)
    ]);
    const staleConnIds = (existingConns||[]).map(r=>r.id).filter(cid=>!localConnIds.has(cid));
    const staleNodeIds = (existingNodes||[]).map(r=>r.id).filter(nid=>!localNodeIds.has(nid));

    // connections reference nodes, so remove stale connections before stale nodes,
    // and upsert nodes before connections that might point at brand-new ones
    if(staleConnIds.length) await supabaseClient.from("connections").delete().in("id", staleConnIds);
    if(staleNodeIds.length) await supabaseClient.from("nodes").delete().in("id", staleNodeIds);

    if(data.nodes.length){
      const rows = data.nodes.map(n=>({
        id:n.id, board_id:id, type:n.type, x:n.x||0, y:n.y||0, w:n.w||null, h:n.h||null,
        title:n.title||"", body:n.body||"", body_html:n.bodyHtml||"", color:n.color||"#ffffff",
        fields:n.fields||{}, collapsed:!!n.collapsed, updated_by:cloudUserId()
      }));
      const { error } = await supabaseClient.from("nodes").upsert(rows);
      if(error) throw error;
    }
    if(data.connections.length){
      const rows = data.connections.map(c=>({
        id:c.id, board_id:id, from_node:c.from, from_item:c.fromItem||null,
        to_node:c.to, to_item:c.toItem||null, label:c.label||null
      }));
      const { error } = await supabaseClient.from("connections").upsert(rows);
      if(error) throw error;
    }
  }

  async function cloudPersistDeleteBoard(id){
    // ON DELETE CASCADE on nodes/connections/board_members handles the rest
    try{ await supabaseClient.from("boards").delete().eq("id", id); }catch(err){}
  }

  async function cloudSaveTypes(){
    const uid = cloudUserId();
    if(!uid || !Object.keys(customTypes).length) return;
    const rows = Object.keys(customTypes).map(tid=>{
      const t = customTypes[tid];
      return { id:tid, owner_id:uid, name:t.name||"Custom", accent:t.accent||"#ffffff",
               width:t.width||220, fields:t.fields||[], builtin:!!t.builtin };
    });
    const { error } = await supabaseClient.from("block_types").upsert(rows);
    if(error) console.error("[mindmap] cloud types save failed", error);
  }

  /* Runs once per page load, right after a session appears. Mirrors
     connectFolder()'s "read what's there, or seed it from what I have"
     shape. If a folder is already connected, that stays authoritative --
     signing in doesn't redirect saves away from an explicit local choice. */
  async function connectCloud(){
    if(cloudConnectAttempted || !supabaseClient || !supabaseSession) return;
    cloudConnectAttempted = true;
    if(backend==="folder"){
      showToast("Signed in \u2014 still saving to your folder");
      return;
    }
    try{
      const found = await cloudReadAll();
      if(found){
        backend = "cloud";
        currentBoardId = boards[0].id;
        showToast("Loaded from cloud");
      } else {
        await cloudPersistIndex();
        await cloudSaveTypes();
        for(const b of boards){ await cloudPersistBoard(b.id); }
        backend = "cloud";
        showToast("Cloud connected \u2014 synced your current boards");
      }
      renderBoardList(); renderBoardHeader(); centerView(); renderBoard();
      renderTypeToolbar(); historyReset(currentBoardId); updateStorageBar();
    }catch(err){
      console.error("[mindmap] cloud connect failed", err);
      showToast("Couldn't connect to cloud \u2014 see console");
      cloudConnectAttempted = false;   // allow a retry on next sign-in event
    }
  }

  /* tiny IndexedDB helper, only used to remember the folder handle */
  function idb(mode, key, val){
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
  const writeChains = {};
  function serializeWrite(name, fn){
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
  async function fsWrite(name, text){
    return serializeWrite(name, async ()=>{
      for(let attempt=0; attempt<2; attempt++){
        try{
          const fh = await dirHandle.getFileHandle(name, {create:true});
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

  async function fsRead(name){
    try{
      const fh = await dirHandle.getFileHandle(name, {create:false});
      const file = await fh.getFile();
      return await file.text();
    }catch(e){ return null; }
  }
  async function fsDelete(name){
    return serializeWrite(name, async ()=>{
      try{ await dirHandle.removeEntry(name); }catch(e){}
    });
  }

  function boardFileName(id){ return "board-"+id+".json"; }

  /* Track boards whose file existed but failed to parse, so we don't overwrite
     the (possibly recoverable) file with an empty one on the next autosave. */
  const corruptBoards = new Set();
  const corruptPrompted = new Set();

  /* Parse a stored board payload defensively. Returns {ok, data}. A file that
     exists but doesn't parse, or parses to something without a nodes array, is
     treated as corrupt (ok:false) rather than being silently read as empty. */
  function parseBoardText(txt){
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

  function ensureNotebookStructure(){
    if(!Array.isArray(notebooks)) notebooks = [];
    if(!notebooks.length){
      notebooks = [{ id:"nb_"+uid().slice(0,8), name:"My Notebook", collapsed:false }];
    }
    const validIds = new Set(notebooks.map(n=>n.id));
    const fallback = notebooks[0].id;
    boards.forEach(b=>{ if(!b.notebookId || !validIds.has(b.notebookId)) b.notebookId = fallback; });
    notebooks.forEach(n=>{ if(typeof n.collapsed!=="boolean") n.collapsed=false; });
    // seed pin flag and an explicit order for any page missing them.
    // order is seeded from current array position so nothing reshuffles.
    boards.forEach((b,i)=>{
      if(typeof b.pinned!=="boolean") b.pinned=false;
      if(typeof b.order!=="number") b.order = i;
    });
  }

  function parseIndex(raw){
    // accepts either the old bare-array form or the new {notebooks, boards} object
    let parsed;
    try{ parsed = JSON.parse(raw); }catch(e){ return; }
    if(Array.isArray(parsed)){
      boards = parsed.map(b=>({id:b.id, name:b.name, description:b.description||"", notebookId:b.notebookId||null, order:b.order, pinned:!!b.pinned}));
      notebooks = [];
    } else if(parsed && Array.isArray(parsed.boards)){
      boards = parsed.boards.map(b=>({id:b.id, name:b.name, description:b.description||"", notebookId:b.notebookId||null, order:b.order, pinned:!!b.pinned}));
      notebooks = Array.isArray(parsed.notebooks) ? parsed.notebooks.slice() : [];
    }
  }

  /* Pages within a notebook, ordered: pinned first, then by their order value.
     Ties fall back to array position so the sort is always stable. */
  function boardsInNotebook(nbId){
    return boards
      .map((b,i)=>({b, i}))
      .filter(x=>x.b.notebookId===nbId)
      .sort((A,B)=>{
        if(!!A.b.pinned !== !!B.b.pinned) return A.b.pinned ? -1 : 1;
        const oa = (typeof A.b.order==="number")?A.b.order:A.i;
        const ob = (typeof B.b.order==="number")?B.b.order:B.i;
        if(oa!==ob) return oa-ob;
        return A.i-B.i;
      })
      .map(x=>x.b);
  }

  /* Renumber a notebook's pages 0..n so order values stay compact after a move. */
  function renumberNotebook(nbId){
    boardsInNotebook(nbId).forEach((b,i)=>{ b.order = i; });
  }
  function boardPayload(id){
    const b = boards.find(x=>x.id===id) || {};
    const d = boardsData[id] || {nodes:[],connections:[]};
    return JSON.stringify({
      id, name:b.name||"", description:b.description||"",
      updated: new Date().toISOString(),
      nodes: d.nodes, connections: d.connections
    }, null, 2);
  }
  function indexPayload(){
    return JSON.stringify({
      version: 2,
      updated: new Date().toISOString(),
      notebooks: notebooks,
      boards: boards.map(b=>({id:b.id, name:b.name, description:b.description, notebookId:b.notebookId||null, order:(typeof b.order==="number"?b.order:0), pinned:!!b.pinned, file:boardFileName(b.id)}))
    }, null, 2);
  }

  /* window.storage caps each key near 5MB. A board with many images can exceed
     that; the write then fails and the old value stays, which shows as blank or
     stale containers. Warn loudly so the user can move to folder storage. */
  const APP_KEY_LIMIT = 5 * 1024 * 1024;
  let sizeWarned = false;
  function checkAppSize(payload){
    const bytes = (typeof Blob!=="undefined") ? new Blob([payload]).size : payload.length;
    if(bytes > APP_KEY_LIMIT * 0.9 && !sizeWarned){
      sizeWarned = true;
      showToast("This page is large \u2014 connect a folder to avoid save limits");
    }
    if(bytes > APP_KEY_LIMIT){
      throw new Error("Board exceeds app storage limit ("+Math.round(bytes/1048576)+"MB). Connect a folder to save it.");
    }
  }

  let corruptNotified = false;
  function notifyCorrupt(){
    if(corruptNotified) return;
    corruptNotified = true;
    const n = corruptBoards.size;
    setTimeout(()=>{
      showToast(n+" page"+(n>1?"s":"")+" couldn't be read \u2014 protected from overwrite");
      console.warn("Corrupt/unreadable board ids (their files are left untouched so you can recover them):", [...corruptBoards]);
    }, 400);
  }

  async function persistIndex(){
    try{
      if(backend==="folder"){ await fsWrite("index.json", indexPayload()); showToast("Saved to folder"); }
      else if(backend==="cloud"){ await cloudPersistIndex(); showToast("Saved to cloud"); }
      else if(backend==="app"){ await window.storage.set(IDX_KEY, indexPayload(), false); showToast("Saved"); }
      else { showToast("Not saving \u2014 connect a folder"); }
    }catch(err){ console.error("index save", err); showToast("Save failed"); }
  }
  async function persistBoard(id){
    // never overwrite a file we couldn't read — the data on disk may be
    // recoverable and clobbering it with the in-memory (empty) version loses it
    if(corruptBoards.has(id)){
      showToast("Not saving this page \u2014 its file couldn't be read (protected)");
      return;
    }
    try{
      if(backend==="folder"){ await fsWrite(boardFileName(id), boardPayload(id)); await fsWrite("index.json", indexPayload()); showToast("Saved to folder"); }
      else if(backend==="cloud"){ await cloudPersistBoard(id); await cloudPersistIndex(); showToast("Saved to cloud"); }
      else if(backend==="app"){
        const payload = JSON.stringify(boardsData[id]);
        checkAppSize(payload);
        await window.storage.set("mindmap:board:"+id, payload, false); showToast("Saved");
      }
      else { showToast("Not saving \u2014 connect a folder"); }
    }catch(err){ console.error("board save", err); showToast("Save failed \u2014 see console"); }
  }
  async function persistDeleteBoard(id){
    try{
      if(backend==="folder"){ await fsDelete(boardFileName(id)); await fsWrite("index.json", indexPayload()); }
      else if(backend==="cloud"){ await cloudPersistDeleteBoard(id); }
      else if(backend==="app"){ await window.storage.delete("mindmap:board:"+id, false); }
    }catch(err){}
  }

  /* names kept from before so the rest of the app is unchanged */
  async function saveIndexNow(){ await persistIndex(); }
  async function saveBoardNow(id){ await persistBoard(id); }
  async function saveTypesNow(){
    try{
      if(backend==="folder"){ await fsWrite("block-types.json", JSON.stringify(customTypes,null,2)); }
      else if(backend==="cloud"){ await cloudSaveTypes(); }
      else if(backend==="app"){ await window.storage.set(TYPES_KEY, JSON.stringify(customTypes), false); }
    }catch(err){ console.error("types save", err); }
  }
  function queueTypesSave(){ clearTimeout(saveTimers.__types); saveTimers.__types = setTimeout(saveTypesNow, 400); }
  function queueIndexSave(){ clearTimeout(saveTimers.__index); saveTimers.__index = setTimeout(saveIndexNow, 500); }
  function queueBoardSave(id){
    if(id===currentBoardId && typeof recordChange==="function") recordChange();
    // If the user is actively editing a board whose file we refused to overwrite,
    // ask once whether to release the protection (they accept losing the old file)
    // so their new edits can start saving again.
    if(corruptBoards.has(id) && !corruptPrompted.has(id)){
      corruptPrompted.add(id);
      const ok = confirm(
        "This page's saved file couldn't be read, so saving has been paused to protect it.\n\n"+
        "Its file is still on disk (or in storage) exactly as it was, so you can back it up manually.\n\n"+
        "Start saving again from here? (Your current on-screen version will overwrite the unreadable file.)"
      );
      if(ok){ corruptBoards.delete(id); }
      else { return; }
    }
    clearTimeout(saveTimers[id]);
    saveTimers[id] = setTimeout(()=>saveBoardNow(id), 500);
  }

  async function openSavedBoardsDir(handle){
    rootHandle = handle;
    dirHandle = await handle.getDirectoryHandle("saved-boards", {create:true});
    backend = "folder";
  }

  /* returns true if boards were loaded out of the folder */
  async function readFromFolder(){
    const idxText = await fsRead("index.json");
    if(!idxText) return false;
    let idx;
    try{ idx = JSON.parse(idxText); }catch(e){ return false; }
    if(!idx || !Array.isArray(idx.boards) || !idx.boards.length) return false;
    boards = idx.boards.map(b=>({id:b.id, name:b.name, description:b.description||"", notebookId:b.notebookId||null, order:b.order, pinned:!!b.pinned}));
    notebooks = Array.isArray(idx.notebooks) ? idx.notebooks.slice() : [];
    ensureNotebookStructure();
    boardsData = {};
    for(const b of boards){
      const txt = await fsRead(boardFileName(b.id));
      const res = parseBoardText(txt);
      if(!res.ok){ corruptBoards.add(b.id); console.warn("Board file unreadable, protecting it from overwrite:", boardFileName(b.id)); }
      const d = res.data;
      d.nodes = (d.nodes||[]).map(migrateNode);
      d.connections = d.connections||[];
      boardsData[b.id] = d;
    }
    currentBoardId = boards[0].id;
    if(corruptBoards.size) notifyCorrupt();
    return true;
  }

  async function writeAllToFolder(){
    await fsWrite("index.json", indexPayload());
    for(const b of boards){ await fsWrite(boardFileName(b.id), boardPayload(b.id)); }
  }

  async function connectFolder(){
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

  async function restoreFolderHandle(){
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

  function updateStorageBar(){
    const bar = el("storageBar");
    if(!bar) return;
    let cls, label, sub;
    if(backend==="folder"){
      cls="ok"; label="Saving to folder";
      sub=(rootHandle && rootHandle.name ? rootHandle.name+"/" : "")+"saved-boards/";
    } else if(backend==="cloud"){
      cls="ok"; label="Saving to cloud";
      sub=(supabaseSession && supabaseSession.user) ? supabaseSession.user.email : "Supabase";
    } else if(backend==="app"){
      cls="ok"; label="Saving in this browser";
      sub="Connect a folder to save real files";
    } else {
      cls="warn"; label="Not saving yet";
      sub="Connect a folder to keep your work";
    }
    bar.className = "storage-bar "+cls;
    bar.querySelector(".sb-label").textContent = label;
    bar.querySelector(".sb-sub").textContent = sub;
    el("connectFolderBtn").textContent = backend==="folder" ? "Change folder" : "Connect folder";
  }

  /* ---------- export / import ---------- */
  function exportAll(){
    const payload = {
      version:2, exported:new Date().toISOString(),
      blockTypes: customTypes,
      notebooks: notebooks,
      boards: boards.map(b=>({
        id:b.id, name:b.name, description:b.description||"", notebookId:b.notebookId||null, order:b.order, pinned:!!b.pinned,
        nodes:(boardsData[b.id]||{}).nodes||[],
        connections:(boardsData[b.id]||{}).connections||[]
      }))
    };
    const blob = new Blob([JSON.stringify(payload,null,2)], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "mindmaps-"+new Date().toISOString().slice(0,10)+".json";
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
    showToast("Exported");
  }

  function importAll(file){
    const reader = new FileReader();
    reader.onload = async (e)=>{
      let payload;
      try{ payload = JSON.parse(e.target.result); }
      catch(err){ alert("That file isn't valid JSON."); return; }
      const incoming = payload.boards || [];
      if(!incoming.length){ alert("No pages found in that file."); return; }
      if(!confirm("Import "+incoming.length+" page(s)? They'll be added alongside your current pages.")) return;
      // merge any custom block types the file carries (keep existing on id clash)
      if(payload.blockTypes){
        let added = 0;
        Object.keys(payload.blockTypes).forEach(id=>{
          if(!customTypes[id]){ customTypes[id] = payload.blockTypes[id]; added++; }
        });
        if(added){ queueTypesSave(); renderTypeToolbar(); }
        migrateLongtextKinds();
      }
      // recreate the imported notebooks under fresh ids, mapping old->new
      const nbMap = {};
      let importNbId = null;
      if(Array.isArray(payload.notebooks) && payload.notebooks.length){
        payload.notebooks.forEach(onb=>{
          const nid = "nb_"+uid().slice(0,8);
          nbMap[onb.id] = nid;
          notebooks.push({ id:nid, name:onb.name||"Imported notebook", collapsed:false });
        });
      } else {
        importNbId = "nb_"+uid().slice(0,8);
        notebooks.push({ id:importNbId, name:"Imported", collapsed:false });
      }
      incoming.forEach(b=>{
        const id = uid();
        const nbId = (b.notebookId && nbMap[b.notebookId]) ? nbMap[b.notebookId] : (importNbId || notebooks[notebooks.length-1].id);
        boards.push({id, name:(b.name||"Imported page"), description:b.description||"", notebookId:nbId, order:(typeof b.order==="number"?b.order:boards.length), pinned:!!b.pinned});
        boardsData[id] = { nodes:(b.nodes||[]).map(migrateNode), connections:b.connections||[] };
      });
      ensureNotebookStructure();
      renderBoardList();
      await persistIndex();
      for(const b of boards){ await persistBoard(b.id); }
      showToast("Imported");
    };
    reader.readAsText(file);
  }

  function blankTicket(){ return {no:"", link:"", assigned:"", customer:"", note:""}; }

  /* ---------- custom block types ---------- */
  /* Built-in editable types keep their data in top-level node props; custom
     fields live in node.fields. These accessors hide that difference so one
     render engine serves both. */
  const BUILTIN_KEYS = { bodyHtml:1, ticketNo:1, link:1, assigned:1, customer:1 };
  function fieldVal(node, key){
    if(BUILTIN_KEYS[key] && node[key]!==undefined) return node[key];
    return node.fields ? node.fields[key] : undefined;
  }
  function setFieldVal(node, key, val){
    if(BUILTIN_KEYS[key]){ node[key] = val; }
    else { node.fields = node.fields || {}; node.fields[key] = val; }
  }

  function subfieldInputHtml(sf, val, gkey, rowIdx){
    const ph = escapeAttr(sf.placeholder||"");
    const base = 'data-gk="'+gkey+'" data-ri="'+rowIdx+'" data-sk="'+sf.key+'"';
    if(sf.kind==="richtext" || sf.kind==="longtext"){
      return '<div class="cf-rich gsub grich" contenteditable="true" '+base+' data-ph="'+ph+'">'+richValue(val)+'</div>';
    }
    if(sf.kind==="link"){
      return '<span class="cf-linkrow" style="flex:1"><input class="cf-input gsub" '+base+' value="'+escapeAttr(val||"")+'" placeholder="'+(ph||"https://")+'">'+
        '<button class="tk-open'+(val?"":" off")+'" data-gopen="1" '+base+' title="Open link">\u2197</button></span>';
    }
    if(sf.kind==="checkbox"){
      return '<label class="cf-check" style="flex:1"><input type="checkbox" class="gsub" '+base+' '+(val?"checked":"")+'>'+escapeHtml(sf.label||"")+'</label>';
    }
    const t = sf.kind==="number" ? "number" : (sf.kind==="date" ? "date" : "text");
    return '<input type="'+t+'" class="cf-input gsub" '+base+' value="'+escapeAttr(val||"")+'" placeholder="'+ph+'">';
  }

  function groupFieldHtml(node, f){
    const rows = Array.isArray(node.fields[f.key]) ? node.fields[f.key] : [];
    const subs = f.subfields || [];
    const layout = f.layout==="columns" ? "columns" : "rows";
    const rowsHtml = rows.map((row,ri)=>{
      const cells = subs.map(sf=>{
        const showLabel = subs.length>1 && sf.kind!=="checkbox";
        return '<div class="grow-cell">' +
          (showLabel?'<span class="grow-sublabel">'+escapeHtml(sf.label||"")+'</span>':'') +
          subfieldInputHtml(sf, row[sf.key], f.key, ri) +
        '</div>';
      }).join('');
      return '<div class="group-row" data-gk="'+f.key+'" data-ri="'+ri+'">' +
        '<span class="grow-num">'+(ri+1)+'</span>' +
        '<div class="grow-cells layout-'+layout+'">'+cells+'</div>' +
        '<button class="grow-del" data-gk="'+f.key+'" data-ri="'+ri+'" title="Remove">&times;</button>' +
        '<span class="row-conn '+(groupRowHasConnection(node.id,f.key,ri)?"has-link":"")+'" data-grow="'+f.key+'" data-ri="'+ri+'" title="Drag to branch from this row"></span>' +
      '</div>';
    }).join('');
    return '<div class="group-field" data-gk="'+f.key+'">' +
      '<div class="grow-head"><span class="cf-label">'+escapeHtml(f.label||"")+'</span>' +
        '<button class="copy-btn cf-copygroup" data-gk="'+f.key+'" title="Copy all rows">'+COPY_ICON+'</button></div>' +
      '<div class="group-rows">'+rowsHtml+'</div>' +
      '<button class="grow-add" data-gk="'+f.key+'">+ '+escapeHtml(f.addLabel||"add")+'</button>' +
    '</div>';
  }

  function customBodyHtml(node){
    const def = customTypes[node.type];
    if(!def) return '<div class="node-body"><div style="color:var(--muted-2);font-size:12px;padding:6px">Unknown block type</div></div>';
    node.fields = node.fields || {};
    let html = '<div class="cf-wrap">';
    def.fields.forEach(f=>{
      const val = fieldVal(node, f.key);
      const ph = escapeAttr(f.placeholder||"");
      // longtext is now just richtext; treat any legacy longtext field as rich
      const isRich = (f.kind==="richtext" || f.kind==="longtext");
      const soloRich = (def.fields.length===1 && isRich);
      if(f.kind==="group"){
        // ensure the row array exists
        if(!Array.isArray(node.fields[f.key])) node.fields[f.key] = [];
        html += groupFieldHtml(node, f);
      } else if(f.kind==="checkbox"){
        html += '<label class="cf-check"><input type="checkbox" data-fk="'+f.key+'" '+(val?"checked":"")+'>'+escapeHtml(f.label||"")+'</label>';
      } else if(isRich){
        const rv = richValue(val);
        html += soloRich
          ? '<div class="cf-row"><div class="cf-rich" contenteditable="true" data-fk="'+f.key+'" data-ph="'+ph+'">'+rv+'</div></div>'
          : '<div class="cf-row"><span class="cf-label">'+escapeHtml(f.label||"")+'</span>'+
            '<div class="cf-rich" contenteditable="true" data-fk="'+f.key+'" data-ph="'+ph+'">'+rv+'</div></div>';
      } else if(f.kind==="link"){
        html += '<div class="cf-row"><span class="cf-label">'+escapeHtml(f.label||"")+'</span>'+
          '<div class="cf-linkrow"><input class="cf-input" data-fk="'+f.key+'" value="'+escapeAttr(val||"")+'" placeholder="'+(ph||"https://")+'">'+
          copyBtnHtml("cf-copy","Copy")+'<button class="tk-open'+(val?"":" off")+'" data-open="'+f.key+'" title="Open link">\u2197</button></div></div>';
      } else if(f.kind==="select"){
        const opts = (f.options||"").split(",").map(o=>o.trim()).filter(Boolean);
        html += '<div class="cf-row inline"><span class="cf-label">'+escapeHtml(f.label||"")+'</span>'+
          '<select class="cf-input" data-fk="'+f.key+'"><option value="">\u2014</option>'+
          opts.map(o=>'<option '+(val===o?"selected":"")+'>'+escapeHtml(o)+'</option>').join('')+'</select></div>';
      } else {
        const t = f.kind==="number" ? "number" : (f.kind==="date" ? "date" : "text");
        html += '<div class="cf-row inline"><span class="cf-label">'+escapeHtml(f.label||"")+'</span>'+
          '<input type="'+t+'" class="cf-input" data-fk="'+f.key+'" value="'+escapeAttr(val||"")+'" placeholder="'+ph+'"></div>';
      }
    });
    html += '</div>';
    if(def.fields.length>1){
      html += '<div class="cf-row inline" style="padding:0 8px 4px"><button class="copy-btn cf-copyall" style="flex:1" title="Copy all fields">'+COPY_ICON+' Copy all</button></div>';
    }
    return html;
  }

  function groupSummary(node, fieldKey){
    const def = customTypes[node.type];
    const f = def ? def.fields.find(x=>x.key===fieldKey) : null;
    if(!f) return "";
    const rows = Array.isArray(node.fields[fieldKey]) ? node.fields[fieldKey] : [];
    const subs = f.subfields || [];
    return rows.map((row,ri)=>{
      const parts = subs.map(sf=>{
        let v = row[sf.key];
        if(sf.kind==="checkbox") v = v ? "yes" : "";
        else if(sf.kind==="richtext" || sf.kind==="longtext") v = richToText(richValue(v));
        return (v!==undefined && v!==null && String(v).trim()!=="") ? (subs.length>1 ? sf.label+": "+v : v) : "";
      }).filter(Boolean);
      return parts.length ? (ri+1)+". "+parts.join("  |  ") : "";
    }).filter(Boolean).join("\n");
  }

  function customSummary(node){
    const def = customTypes[node.type];
    if(!def) return "";
    const lines = [];
    def.fields.forEach(f=>{
      if(f.kind==="group"){
        const gs = groupSummary(node, f.key);
        if(gs) lines.push(f.label+":\n"+gs);
        return;
      }
      let v = fieldVal(node, f.key);
      if(f.kind==="richtext" || f.kind==="longtext") v = richToText(richValue(v));
      if(f.kind==="checkbox") v = v ? "yes" : "";
      if(v!==undefined && v!==null && String(v).trim()!=="") lines.push(f.label+": "+v);
    });
    return lines.join("\n");
  }

  function wireCustomFields(div, node){
    const def = customTypes[node.type];
    if(!def) return;
    node.fields = node.fields || {};
    div.querySelectorAll("[data-fk]").forEach(fld=>{
      const key = fld.dataset.fk;
      fld.addEventListener("pointerdown", e=>e.stopPropagation());
      fld.addEventListener("focus", ()=>selectNode(node.id));
      if(fld.classList.contains("cf-rich")){
        fld.addEventListener("input", ()=>{ setFieldVal(node, key, fld.innerHTML); queueBoardSave(currentBoardId); });
        fld.addEventListener("blur", ()=>{ const c=sanitizeHtml(fld.innerHTML); fld.innerHTML=c; setFieldVal(node, key, c); queueBoardSave(currentBoardId); });
        fld.addEventListener("paste",(e)=>{
          const txt = e.clipboardData ? e.clipboardData.getData("text/plain") : "";
          if(txt){ e.preventDefault(); e.stopPropagation(); document.execCommand("insertText", false, txt); }
        });
      } else if(fld.type==="checkbox"){
        fld.addEventListener("change", ()=>{ setFieldVal(node, key, fld.checked); queueBoardSave(currentBoardId); });
      } else if(fld.tagName==="TEXTAREA"){
        fld.addEventListener("input", ()=>{
          setFieldVal(node, key, fld.value);
          fld.style.height="auto"; fld.style.height=fld.scrollHeight+"px";
          measureListOffsets(); updateConnectionsTouching(node.id);
          queueBoardSave(currentBoardId);
        });
      } else {
        fld.addEventListener("input", ()=>{
          setFieldVal(node, key, fld.value);
          const openBtn = div.querySelector('[data-open="'+key+'"]');
          if(openBtn) openBtn.classList.toggle("off", !fld.value);
          queueBoardSave(currentBoardId);
        });
      }
    });
    div.querySelectorAll("[data-open]").forEach(btn=>{
      btn.addEventListener("pointerdown", e=>e.stopPropagation());
      btn.addEventListener("click",(e)=>{
        e.stopPropagation();
        openLinkBackground(fieldVal(node, btn.dataset.open));
      });
    });
    div.querySelectorAll(".cf-linkrow .cf-copy").forEach(btn=>{
      btn.addEventListener("pointerdown", e=>e.stopPropagation());
      btn.addEventListener("click",(e)=>{
        e.stopPropagation();
        const input = btn.parentNode.querySelector(".cf-input");
        copyText(input ? input.value : "", btn);
      });
    });
    const copyAll = div.querySelector(".cf-copyall");
    if(copyAll){
      copyAll.addEventListener("pointerdown", e=>e.stopPropagation());
      copyAll.addEventListener("click",(e)=>{ e.stopPropagation(); copyText(customSummary(node), copyAll); });
    }

    /* group (repeating) fields */
    div.querySelectorAll(".gsub").forEach(fld=>{
      const gk = fld.dataset.gk, ri = parseInt(fld.dataset.ri,10), sk = fld.dataset.sk;
      fld.addEventListener("pointerdown", e=>e.stopPropagation());
      fld.addEventListener("focus", ()=>selectNode(node.id));
      const commit = (value)=>{
        const rows = node.fields[gk];
        if(rows && rows[ri]){ rows[ri][sk] = value; queueBoardSave(currentBoardId); }
      };
      if(fld.classList.contains("grich")){
        fld.addEventListener("input", ()=>{
          commit(fld.innerHTML);
          measureListOffsets(); updateConnectionsTouching(node.id);
        });
        fld.addEventListener("blur", ()=>{ const c=sanitizeHtml(fld.innerHTML); fld.innerHTML=c; commit(c); });
        fld.addEventListener("paste",(e)=>{
          const txt = e.clipboardData ? e.clipboardData.getData("text/plain") : "";
          if(txt){ e.preventDefault(); e.stopPropagation(); document.execCommand("insertText", false, txt); }
        });
      } else if(fld.type==="checkbox"){
        fld.addEventListener("change", ()=>commit(fld.checked));
      } else if(fld.tagName==="TEXTAREA"){
        fld.addEventListener("input", ()=>{
          commit(fld.value);
          fld.style.height="auto"; fld.style.height=fld.scrollHeight+"px";
          measureListOffsets(); updateConnectionsTouching(node.id);
        });
      } else {
        fld.addEventListener("input", ()=>{
          commit(fld.value);
          const openBtn = fld.parentNode.querySelector('[data-gopen]');
          if(openBtn) openBtn.classList.toggle("off", !fld.value);
        });
        fld.addEventListener("keydown",(e)=>{
          if(e.key==="Enter"){ e.preventDefault(); addGroupRow(node, gk, ri); }
        });
      }
    });
    div.querySelectorAll("[data-gopen]").forEach(btn=>{
      btn.addEventListener("pointerdown", e=>e.stopPropagation());
      btn.addEventListener("click",(e)=>{
        e.stopPropagation();
        const rows = node.fields[btn.dataset.gk];
        const row = rows && rows[parseInt(btn.dataset.ri,10)];
        if(row) openLinkBackground(row[btn.dataset.sk]);
      });
    });
    div.querySelectorAll(".grow-add").forEach(btn=>{
      btn.addEventListener("pointerdown", e=>e.stopPropagation());
      btn.addEventListener("click",(e)=>{ e.stopPropagation(); addGroupRow(node, btn.dataset.gk); });
    });
    div.querySelectorAll(".grow-del").forEach(btn=>{
      btn.addEventListener("pointerdown", e=>e.stopPropagation());
      btn.addEventListener("click",(e)=>{ e.stopPropagation(); removeGroupRow(node, btn.dataset.gk, parseInt(btn.dataset.ri,10)); });
    });
    div.querySelectorAll(".cf-copygroup").forEach(btn=>{
      btn.addEventListener("pointerdown", e=>e.stopPropagation());
      btn.addEventListener("click",(e)=>{ e.stopPropagation(); copyText(groupSummary(node, btn.dataset.gk), btn); });
    });
    div.querySelectorAll(".row-conn[data-grow]").forEach(dot=>{
      dot.addEventListener("pointerdown",(e)=>{
        e.stopPropagation();
        const gk = dot.dataset.grow, ri = parseInt(dot.dataset.ri,10);
        const rowEl = dot.closest(".group-row");
        const oy = rowEl ? (rowEl.offsetTop + rowEl.offsetHeight/2) : node.h/2;
        startConnectDrag(node.id, groupKey(gk, ri), node.x+node.w, node.y+oy);
      });
    });
  }

  function migrateNode(n){
    if(n.type==="list" && !Array.isArray(n.items)){
      const lines = (n.body||"").split("\n").map(s=>s.trim()).filter(Boolean);
      n.items = lines.length ? lines : [""];
    }
    if(n.type==="list" && !n.items.length) n.items=[""];
    if(typeof n.collapsed !== "boolean") n.collapsed = false;
    if(n.bodyHtml === undefined) n.bodyHtml = plainToHtml(n.body||"");
    if(isCustomType(n.type) && !n.fields) n.fields = {};
    if(isCustomType(n.type)){
      const def = customTypes[n.type];
      if(def) def.fields.forEach(f=>{
        if(f.kind==="group" && !Array.isArray(n.fields[f.key])) n.fields[f.key] = [];
      });
    }
    if(n.type==="week" && !Array.isArray(n.tickets)) n.tickets = [blankTicket()];
    if(n.type==="week" && !n.tickets.length) n.tickets = [blankTicket()];
    if(n.type==="week") n.tickets.forEach(t=>{
      if(t.assigned===undefined) t.assigned = "";
      if(t.customer===undefined) t.customer = "";
      if(t.note===undefined) t.note = "";
    });
    if(n.type==="week" && !n.weekLabel) n.weekLabel = currentWeekLabel();
    if(n.type==="ticket"){
      if(n.ticketNo===undefined) n.ticketNo = "";
      if(n.link===undefined) n.link = "";
      if(n.assigned===undefined) n.assigned = "";
      if(n.customer===undefined) n.customer = "";
    }
    return n;
  }

  async function loadCustomTypes(){
    try{
      if(backend==="folder"){
        const txt = await fsRead("block-types.json");
        if(txt) customTypes = JSON.parse(txt);
      } else if(backend==="app" && typeof window.storage!=="undefined" && window.storage){
        const res = await window.storage.get(TYPES_KEY, false);
        if(res && res.value) customTypes = JSON.parse(res.value);
      }
    }catch(err){ customTypes = customTypes || {}; }
    migrateLongtextKinds();
  }

  /* longtext and richtext were merged; normalize any stored 'longtext' kind to
     'richtext' so the designer dropdowns and renderers only deal with one kind.
     Values are compatible (richValue coerces old plain text into HTML). */
  function migrateLongtextKinds(){
    let changed = false;
    Object.keys(customTypes).forEach(id=>{
      const t = customTypes[id];
      (t.fields||[]).forEach(f=>{
        if(f.kind==="longtext"){ f.kind="richtext"; changed=true; }
        if(f.kind==="group"){
          (f.subfields||[]).forEach(sf=>{ if(sf.kind==="longtext"){ sf.kind="richtext"; changed=true; } });
        }
      });
    });
    if(changed) queueTypesSave();
  }

  async function loadAll(){
    // 1. try a previously connected folder
    const gotFolder = await restoreFolderHandle();
    if(gotFolder){
      const loaded = await readFromFolder();
      if(loaded) return;
    }

    // 2. fall back to Claude's storage if this page is running inside Claude
    if(backend!=="folder"){
      if(typeof window.storage !== "undefined" && window.storage){
        backend = "app";
        try{
          const res = await window.storage.get(IDX_KEY, false);
          if(res && res.value) parseIndex(res.value);
        }catch(err){ boards = []; }
      } else {
        backend = "memory";
      }
    }

    if(!boards.length){
      ensureNotebookStructure();
      const id = uid();
      boards = [{id, name:"My first mind map", description:"Sketch out how the pieces fit together.", notebookId:notebooks[0].id}];
      boardsData[id] = { nodes:[{id:uid(), type:"header", x:1980, y:1420, w:260, h:56, title:"Central topic", body:"", color:"#ffffff"}], connections:[] };
      currentBoardId = id;
      await saveIndexNow(); await saveBoardNow(id);
      return;
    }
    ensureNotebookStructure();
    for(const b of boards){
      let d = {nodes:[],connections:[]};
      try{
        if(backend==="folder"){
          const txt = await fsRead(boardFileName(b.id));
          const res = parseBoardText(txt);
          if(!res.ok) corruptBoards.add(b.id);
          d = res.data;
        } else if(backend==="app"){
          const res = await window.storage.get("mindmap:board:"+b.id, false);
          const parsed = parseBoardText(res && res.value);
          if(!parsed.ok) corruptBoards.add(b.id);
          d = parsed.data;
        }
      }catch(err){ corruptBoards.add(b.id); d = {nodes:[],connections:[]}; }
      d.nodes = (d.nodes||[]).map(migrateNode);
      d.connections = d.connections||[];
      boardsData[b.id] = d;
    }
    currentBoardId = boards[0].id;
    if(corruptBoards.size) notifyCorrupt();
  }

  /* ---------- sidebar ---------- */
  const treeEl = () => el("notebookTree");
  let favCollapsed = false;

  /* Favorites = every pinned page, across all notebooks. Auto-hidden when none
     are pinned so the section never takes space until it's useful. */
  function renderFavorites(){
    const wrap = el("favWrap");
    if(!wrap) return;
    const favs = boards.filter(b=>b.pinned);
    if(!favs.length){ wrap.style.display = "none"; return; }
    wrap.style.display = "";
    wrap.classList.toggle("collapsed", favCollapsed);
    el("favCount").textContent = favs.length;

    // order favorites the way they appear in their notebooks (pinned order)
    const ordered = [];
    notebooks.forEach(nb=>{
      boardsInNotebook(nb.id).forEach(b=>{ if(b.pinned) ordered.push({b, nb}); });
    });
    // include any pinned page whose notebook somehow isn't listed
    favs.forEach(b=>{ if(!ordered.some(o=>o.b.id===b.id)) ordered.push({b, nb:notebooks.find(n=>n.id===b.notebookId)}); });

    el("favList").innerHTML = ordered.map(({b, nb})=>
      '<div class="fav-item '+(b.id===currentBoardId?"active":"")+'" data-id="'+b.id+'">' +
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

  function renderBoardList(){
    renderFavorites();
    const host = treeEl();
    if(!host) return;
    host.innerHTML = notebooks.map(nb=>{
      const pages = boardsInNotebook(nb.id);
      const pagesHtml = pages.length
        ? pages.map(b=>
            '<div class="board-item '+(b.id===currentBoardId?'active':'')+(b.pinned?' pinned':'')+'" draggable="true" data-id="'+b.id+'">' +
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
        const nb = notebooks.find(n=>n.id===head.dataset.nb);
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
        const b = boards.find(x=>x.id===pageId);
        if(b && nbId && b.notebookId!==nbId){
          b.notebookId = nbId;
          b.order = boardsInNotebook(nbId).length;   // drop at the end of the target notebook
          renumberNotebook(nbId);
          const nb = notebooks.find(n=>n.id===nbId);
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
    const b = boards.find(x=>x.id===pageId);
    const t = boards.find(x=>x.id===targetId);
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
    const b = boards.find(x=>x.id===pageId);
    if(!b) return;
    b.pinned = !b.pinned;
    renumberNotebook(b.notebookId);
    renderBoardList(); queueIndexSave();
    showToast(b.pinned ? "Pinned to top" : "Unpinned");
  }

  function startRenameNotebook(id){
    const nb = notebooks.find(n=>n.id===id);
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
    notebooks.push(nb);
    renderBoardList(); queueIndexSave();
    startRenameNotebook(nb.id);
  }

  function deleteNotebook(id){
    if(notebooks.length===1){ showToast("Keep at least one notebook"); return; }
    const pages = boardsInNotebook(id);
    const nb = notebooks.find(n=>n.id===id);
    let msg = 'Delete notebook "'+(nb?nb.name:"")+'"?';
    if(pages.length){
      const other = notebooks.find(n=>n.id!==id);
      msg += "\n\nIts "+pages.length+" page(s) will move to \""+other.name+"\". (To delete the pages too, remove them first.)";
    }
    if(!confirm(msg)) return;
    const fallback = notebooks.find(n=>n.id!==id).id;
    pages.forEach(b=>b.notebookId=fallback);
    notebooks = notebooks.filter(n=>n.id!==id);
    renderBoardList(); queueIndexSave();
  }

  function startRenameBoard(id, itemEl){
    const b = boards.find(x=>x.id===id);
    itemEl.innerHTML = '<input value="'+escapeAttr(b.name||"")+'">';
    const input = itemEl.querySelector("input");
    input.focus(); input.select();
    function commit(){
      b.name = input.value.trim() || "Untitled";
      renderBoardList();
      if(id===currentBoardId) el("boardTitle").value = b.name;
      queueIndexSave();
    }
    input.addEventListener("blur", commit);
    input.addEventListener("keydown",(e)=>{ if(e.key==="Enter") input.blur(); });
    input.addEventListener("click",e=>e.stopPropagation());
  }

  function switchBoard(id){
    if(id===currentBoardId) return;
    currentBoardId = id; selection.clear(); selectedConnId=null;
    renderBoardList(); renderBoardHeader(); centerView(); renderBoard();
    historyReset(id);
  }
  function newBoard(nbId){
    if(!nbId || !notebooks.some(n=>n.id===nbId)){
      const cur = getBoard();
      nbId = (cur && cur.notebookId) || notebooks[0].id;
    }
    const id = uid();
    boards.push({id, name:"Untitled page", description:"", notebookId:nbId, order:boardsInNotebook(nbId).length, pinned:false});
    boardsData[id] = {nodes:[],connections:[]};
    const nb = notebooks.find(n=>n.id===nbId); if(nb) nb.collapsed=false;
    currentBoardId = id;
    renderBoardList(); renderBoardHeader(); centerView(); renderBoard(); queueIndexSave();
    historyReset(id);
    el("boardTitle").focus();
  }
  function deleteBoard(id){
    if(boards.length===1){ showToast("Can't delete your only page"); return; }
    if(!confirm("Delete this page and everything on it? This can't be undone.")) return;
    const nbId = (boards.find(b=>b.id===id)||{}).notebookId;
    boards = boards.filter(b=>b.id!==id);
    delete boardsData[id];
    persistDeleteBoard(id);
    if(nbId) renumberNotebook(nbId);
    if(currentBoardId===id) currentBoardId = boards[0].id;
    renderBoardList(); renderBoardHeader(); centerView(); renderBoard(); queueIndexSave();
  }

  /* Deep-copy a whole page (all blocks + connections) into the same notebook,
     placed right after the original. Node ids are regenerated and connections
     rewired to the new ids so nothing points back at the source page. */
  function duplicatePage(id){
    const src = boards.find(b=>b.id===id);
    if(!src) return;
    const data = boardsData[id] || {nodes:[], connections:[]};
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
    boards.push({ id:newId, name:(src.name||"Untitled")+" copy", description:src.description||"",
      notebookId:src.notebookId, order:(src.order||0)+0.5, pinned:false });
    boardsData[newId] = { nodes:newNodes, connections:newConns };
    renumberNotebook(src.notebookId);
    currentBoardId = newId;
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
    const b = boards.find(p=>p.id===pageId);
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

  function renderBoardHeader(){
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
    const curNb = cur ? notebooks.find(n=>n.id===cur.notebookId) : null;
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
      const b = boards.find(x=>x.id===searchScope.id) || getBoard();
      return b ? [b] : [];
    }
    if(searchScope.mode==="notebook"){
      return boards.filter(b=>b.notebookId===searchScope.id);
    }
    return boards;
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
      const nb = notebooks.find(n=>n.id===b.notebookId);
      const data = boardsData[b.id] || {nodes:[]};
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
    if(boardId!==currentBoardId){
      currentBoardId = boardId; selection.clear(); selectedConnId=null;
      renderBoardList(); renderBoardHeader(); renderBoard();
      historyReset(boardId);
    }
    const node = findNode(nodeId);
    if(!node) return;
    const rect = viewport.getBoundingClientRect();
    view.scale = 1;
    view.x = rect.width/2 - (node.x+node.w/2);
    view.y = rect.height/2 - (node.y+node.h/2);
    applyTransform();
    const nodeEl = canvasInner.querySelector('.node[data-id="'+nodeId+'"]');
    if(nodeEl){
      nodeEl.classList.add("search-hit","flash");
      setTimeout(()=>nodeEl.classList.remove("flash"), 2300);
      setTimeout(()=>nodeEl.classList.remove("search-hit"), 2600);
    }
  }

  /* ---------- view ---------- */
  function applyTransform(){
    canvasInner.style.transform = "translate("+view.x+"px,"+view.y+"px) scale("+view.scale+")";
    el("zoomPct").textContent = Math.round(view.scale*100)+"%";
  }
  function centerView(){
    const rect = viewport.getBoundingClientRect();
    view.scale = 1; view.x = rect.width/2-2100; view.y = rect.height/2-1500;
    applyTransform();
  }
  function zoomAt(clientX, clientY, factor){
    const rect = viewport.getBoundingClientRect();
    const mx=clientX-rect.left, my=clientY-rect.top;
    const cx=(mx-view.x)/view.scale, cy=(my-view.y)/view.scale;
    const ns = Math.min(2.2, Math.max(0.35, view.scale*factor));
    view.x = mx-cx*ns; view.y = my-cy*ns; view.scale = ns;
    applyTransform();
  }
  el("zoomIn").addEventListener("click",()=>{const r=viewport.getBoundingClientRect();zoomAt(r.left+r.width/2,r.top+r.height/2,1.2);});
  el("zoomOut").addEventListener("click",()=>{const r=viewport.getBoundingClientRect();zoomAt(r.left+r.width/2,r.top+r.height/2,0.83);});
  el("zoomReset").addEventListener("click", centerView);

  viewport.addEventListener("wheel",(e)=>{
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY<0 ? 1.09 : 0.915);
  },{passive:false});

  function clientToCanvas(clientX, clientY){
    const rect = viewport.getBoundingClientRect();
    return { x:(clientX-rect.left-view.x)/view.scale, y:(clientY-rect.top-view.y)/view.scale };
  }
  viewport.addEventListener("pointermove",(e)=>{ cursorCanvas = clientToCanvas(e.clientX,e.clientY); });

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
    dragState = { mode:"marquee", startCx:c.x, startCy:c.y,
      additive:(e.ctrlKey||e.metaKey||e.shiftKey), base:new Set(selection) };
    viewport.setPointerCapture(e.pointerId);
  }, true);

  /* left button on empty canvas = pan */
  viewport.addEventListener("pointerdown",(e)=>{
    if(e.button!==0 && e.button!==1) return;
    if(e.target!==viewport && e.target!==canvasInner && e.target.id!=="connSvg" && e.target.tagName!=="svg") return;
    deselectAll();
    viewport.classList.add("panning");
    dragState = { mode:"pan", startX:e.clientX, startY:e.clientY, ox:view.x, oy:view.y };
    viewport.setPointerCapture(e.pointerId);
  });

  document.addEventListener("pointermove",(e)=>{
    if(!dragState) return;
    if(dragState.mode==="pan"){
      view.x = dragState.ox+(e.clientX-dragState.startX);
      view.y = dragState.oy+(e.clientY-dragState.startY);
      applyTransform();
    } else if(dragState.mode==="marquee"){
      const c = clientToCanvas(e.clientX, e.clientY);
      const x = Math.min(c.x, dragState.startCx), y = Math.min(c.y, dragState.startCy);
      const w = Math.abs(c.x-dragState.startCx), h = Math.abs(c.y-dragState.startCy);
      marqueeEl.style.left=x+"px"; marqueeEl.style.top=y+"px";
      marqueeEl.style.width=w+"px"; marqueeEl.style.height=h+"px";
      const hiddenNow = hiddenNodeIds();
      const hits = getData().nodes.filter(n=>
        !hiddenNow.has(n.id) &&
        n.x < x+w && n.x+n.w > x && n.y < y+h && n.y+n.h > y).map(n=>n.id);
      const next = dragState.additive ? new Set([...dragState.base, ...hits]) : new Set(hits);
      selection = next;
      applySelectionClasses();
    } else if(dragState.mode==="drag"){
      const dx=(e.clientX-dragState.startX)/view.scale, dy=(e.clientY-dragState.startY)/view.scale;
      dragState.moving.forEach(m=>{
        m.node.x = m.ox+dx; m.node.y = m.oy+dy;
        m.el.style.left = m.node.x+"px";
        m.el.style.top = m.node.y+"px";
        updateConnectionsTouching(m.node.id);
      });
      fitCanvasBounds();
    } else if(dragState.mode==="resize"){
      const dx=(e.clientX-dragState.startX)/view.scale, dy=(e.clientY-dragState.startY)/view.scale;
      dragState.node.w = Math.max(150, dragState.ow+dx);
      dragState.el.style.width = dragState.node.w+"px";
      const autoH = (dragState.node.type==="list" || dragState.node.type==="ticket" || dragState.node.type==="week" || isCustomType(dragState.node.type));
      if(!autoH){
        dragState.node.h = Math.max(50, dragState.oh+dy);
        dragState.el.style.height = dragState.node.h+"px";
      } else {
        dragState.node.h = dragState.el.offsetHeight;
      }
      updateConnectionsTouching(dragState.node.id);
    } else if(dragState.mode==="connect"){
      const c = clientToCanvas(e.clientX,e.clientY);
      cursorCanvas = c;
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
    if(nodeEl && nodeEl.dataset.id !== dragState.fromId) nodeEl.classList.add("drop-target");
  }

  document.addEventListener("pointerup",(e)=>{
    if(!dragState) return;
    if(dragState.mode==="pan") viewport.classList.remove("panning");
    if(dragState.mode==="marquee"){
      if(marqueeEl){ marqueeEl.remove(); marqueeEl=null; }
      applySelectionClasses();
      renderConnLabelsAndDelete();
      dragState = null;
      return;
    }
    if(dragState.mode==="drag"){
      measureListOffsets();
      dragState.moving.forEach(m=>updateConnectionsTouching(m.node.id));
      queueBoardSave(currentBoardId);
    }
    if(dragState.mode==="resize"){
      measureListOffsets();
      updateConnectionsTouching(dragState.node.id);
      queueBoardSave(currentBoardId);
    }
    if(dragState.mode==="connect"){
      endConnectDrag(e.clientX, e.clientY);
      return;
    }
    dragState = null;
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
      const def = customTypes[n.type];
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
    const from = dragState;
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
      dragState = null;
    } else if(!nodeEl){
      // dropped on empty canvas: open a searchable picker to choose the block type
      dragState = null;
      openNodePicker(from, clientX, clientY);
    } else {
      dragState = null;
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
        (customTypes[t.type] && !customTypes[t.type].builtin ? '<span class="pk-tag">custom</span>' : '') +
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

  function startConnectDrag(fromId, fromItem, startX, startY){
    dragState = { mode:"connect", fromId, fromItem };
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

  /* ---------- nodes ---------- */
  function createNode(type, cx, cy, opts){
    opts = opts || {};
    const def = customTypes[type];
    const size = def ? [def.width||240, 120] : (DEFAULT_SIZE[type] || [220,140]);
    const node = {
      id: uid(), type,
      x: Math.round(cx-size[0]/2), y: Math.round(cy-size[1]/2),
      w: size[0], h: size[1],
      title: type==="header" ? "New topic" : (def ? "" : ""),
      body: "",
      items: type==="list" ? [""] : undefined,
      bodyHtml: "",
      fields: def ? {} : undefined,
      ticketNo: type==="ticket" ? "" : undefined,
      link: type==="ticket" ? "" : undefined,
      assigned: type==="ticket" ? "" : undefined,
      customer: type==="ticket" ? "" : undefined,
      weekLabel: type==="week" ? currentWeekLabel() : undefined,
      tickets: type==="week" ? [blankTicket()] : undefined,
      color: def ? (def.accent||"#ffffff") : "#ffffff",
      collapsed: false,
      image: null
    };
    getData().nodes.push(node);
    renderBoard();
    queueBoardSave(currentBoardId);
    if(!opts.silent) focusNodeTitle(node.id);
    return node;
  }

  function focusNodeTitle(id){
    const t = canvasInner.querySelector('.node[data-id="'+id+'"] .node-title');
    if(t){ t.focus(); if(t.select) t.select(); }
  }

  function spawnAtCursor(type){
    if(type==="image"){
      const c = {x:cursorCanvas.x, y:cursorCanvas.y};
      imgFileInput.onchange = (e)=>{
        const file = e.target.files[0];
        if(file) processImageFile(file,(dataUrl,w,h)=>{
          const node = createNode("image", c.x, c.y, {silent:true});
          node.image = dataUrl; node.w = Math.min(320,w); node.h = node.w*(h/w);
          renderBoard(); queueBoardSave(currentBoardId);
        });
        imgFileInput.value=""; imgFileInput.onchange=null;
      };
      imgFileInput.click();
      return null;
    }
    return createNode(type, cursorCanvas.x, cursorCanvas.y);
  }

  document.querySelectorAll(".add-btn[data-type]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const c = viewportCenterCanvasCoords();
      createNode(btn.dataset.type, c.x+(Math.random()*60-30), c.y+(Math.random()*60-30));
    });
  });

  function viewportCenterCanvasCoords(){
    const rect = viewport.getBoundingClientRect();
    return { x:(rect.width/2-view.x)/view.scale, y:(rect.height/2-view.y)/view.scale };
  }

  el("addImageBtn").addEventListener("click", ()=>{
    imgFileInput.onchange = (e)=>{
      const file = e.target.files[0];
      if(file) processImageFile(file,(dataUrl,w,h)=>{
        const c = viewportCenterCanvasCoords();
        const node = createNode("image", c.x, c.y, {silent:true});
        node.image = dataUrl; node.w = Math.min(320,w); node.h = node.w*(h/w);
        renderBoard(); queueBoardSave(currentBoardId);
      });
      imgFileInput.value=""; imgFileInput.onchange=null;
    };
    imgFileInput.click();
  });

  function processImageFile(file, cb){
    const reader = new FileReader();
    reader.onload = (e)=>{
      const img = new Image();
      img.onload = ()=>{
        const maxDim=900; let w=img.width, h=img.height;
        if(w>maxDim||h>maxDim){ const r=Math.min(maxDim/w,maxDim/h); w=Math.round(w*r); h=Math.round(h*r); }
        const c=document.createElement("canvas"); c.width=w; c.height=h;
        c.getContext("2d").drawImage(img,0,0,w,h);
        cb(c.toDataURL("image/jpeg",0.85), w, h);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function deleteNode(id){
    const data = getData();
    data.nodes = data.nodes.filter(n=>n.id!==id);
    data.connections = data.connections.filter(c=>c.from!==id && c.to!==id);
    selection.delete(id);
    renderBoard(); queueBoardSave(currentBoardId);
  }
  function deleteSelectedNodes(){
    const ids = new Set(selection);
    if(!ids.size) return;
    const data = getData();
    data.nodes = data.nodes.filter(n=>!ids.has(n.id));
    data.connections = data.connections.filter(c=>!ids.has(c.from) && !ids.has(c.to));
    selection.clear();
    renderBoard(); queueBoardSave(currentBoardId);
  }
  function duplicateNode(id){
    const n = findNode(id);
    if(!n) return;
    const copy = JSON.parse(JSON.stringify(n));
    copy.id = uid(); copy.x = n.x+24; copy.y = n.y+24;
    getData().nodes.push(copy);
    renderBoard(); queueBoardSave(currentBoardId);
  }
  /* ---------- collapse ----------
     A box with outgoing connections can be collapsed from its head. Everything
     downstream of it (following arrows outward, recursively) is hidden, along
     with any lines touching those boxes. The collapsed box shows a count. */
  function outgoingCount(id){ return getData().connections.filter(c=>c.from===id).length; }

  function descendantsOf(id){
    const data = getData();
    const out = new Set();
    const stack = data.connections.filter(c=>c.from===id).map(c=>c.to);
    while(stack.length){
      const cur = stack.pop();
      if(cur===id || out.has(cur)) continue;
      out.add(cur);
      data.connections.filter(c=>c.from===cur).forEach(c=>{ if(!out.has(c.to)) stack.push(c.to); });
    }
    return out;
  }

  function hiddenNodeIds(){
    const data = getData();
    const hidden = new Set();
    data.nodes.filter(n=>n.collapsed && outgoingCount(n.id)).forEach(root=>{
      descendantsOf(root.id).forEach(id=>hidden.add(id));
    });
    return hidden;
  }

  function toggleCollapse(id){
    const n = findNode(id);
    if(!n) return;
    n.collapsed = !n.collapsed;
    if(n.collapsed){
      descendantsOf(id).forEach(d=>selection.delete(d));
    }
    renderBoard();
    queueBoardSave(currentBoardId);
  }

  /* ---------- undo / redo ----------
     Snapshot-based, one history per page. Changes made within ~450ms of each
     other collapse into a single step, so typing a word is one undo, not ten. */
  const HISTORY_LIMIT = 60;
  let undoStacks = {}, redoStacks = {}, lastSnapshots = {};
  let historyTimer = null;

  function snapshot(){
    const d = getData();
    return JSON.stringify({nodes:d.nodes, connections:d.connections});
  }
  function historyReset(boardId){
    undoStacks[boardId] = [];
    redoStacks[boardId] = [];
    lastSnapshots[boardId] = snapshot();
  }
  function recordChange(){
    const boardId = currentBoardId;
    clearTimeout(historyTimer);
    historyTimer = setTimeout(()=>{
      const cur = snapshot();
      if(cur === lastSnapshots[boardId]) return;
      const stack = undoStacks[boardId] || (undoStacks[boardId] = []);
      if(lastSnapshots[boardId] !== undefined) stack.push(lastSnapshots[boardId]);
      if(stack.length > HISTORY_LIMIT) stack.shift();
      lastSnapshots[boardId] = cur;
      redoStacks[boardId] = [];
    }, 450);
  }
  function restoreSnapshot(json){
    const p = JSON.parse(json);
    const d = getData();
    d.nodes = p.nodes;
    d.connections = p.connections;
    selection.clear();
    selectedConnId = null;
    renderBoard();
    persistBoard(currentBoardId);
  }
  function undo(){
    clearTimeout(historyTimer);
    const boardId = currentBoardId;
    const stack = undoStacks[boardId] || [];
    // fold in any change that hasn't been committed to history yet
    const cur = snapshot();
    if(cur !== lastSnapshots[boardId]){
      stack.push(lastSnapshots[boardId]);
      lastSnapshots[boardId] = cur;
    }
    if(!stack.length){ showToast("Nothing to undo"); return; }
    (redoStacks[boardId] || (redoStacks[boardId]=[])).push(snapshot());
    const prev = stack.pop();
    lastSnapshots[boardId] = prev;
    restoreSnapshot(prev);
    showToast("Undo");
  }
  function redo(){
    clearTimeout(historyTimer);
    const boardId = currentBoardId;
    const stack = redoStacks[boardId] || [];
    if(!stack.length){ showToast("Nothing to redo"); return; }
    (undoStacks[boardId] || (undoStacks[boardId]=[])).push(snapshot());
    const next = stack.pop();
    lastSnapshots[boardId] = next;
    restoreSnapshot(next);
    showToast("Redo");
  }

  function deselectAll(){
    selection.clear(); selectedConnId=null;
    canvasInner.querySelectorAll(".node.selected").forEach(n=>n.classList.remove("selected"));
    renderConnections();
  }
  function applySelectionClasses(){
    canvasInner.querySelectorAll(".node").forEach(n=>n.classList.toggle("selected", selection.has(n.dataset.id)));
  }
  function selectNode(id, additive){
    if(additive){
      if(selection.has(id)) selection.delete(id); else selection.add(id);
    } else {
      if(!selection.has(id)){ selection.clear(); selection.add(id); }
    }
    selectedConnId = null;
    applySelectionClasses();
    renderConnLabelsAndDelete();
  }
  function setSelection(ids){
    selection = new Set(ids);
    selectedConnId = null;
    applySelectionClasses();
    renderConnLabelsAndDelete();
  }
  function onlySelected(){
    return selection.size===1 ? findNode(selection.values().next().value) : null;
  }

  /* ---------- list item helpers ---------- */
  function itemHasConnection(nodeId, idx){
    return getData().connections.some(c=>(c.from===nodeId && c.fromItem===idx) || (c.to===nodeId && c.toItem===idx));
  }

  /* Group rows use string item-keys "g:<fieldKey>:<rowIdx>" so they never clash
     with the numeric indices used by list/week rows. */
  function groupKey(fieldKey, rowIdx){ return "g:"+fieldKey+":"+rowIdx; }
  function groupRowHasConnection(nodeId, fieldKey, rowIdx){
    const k = groupKey(fieldKey, rowIdx);
    return getData().connections.some(c=>(c.from===nodeId && c.fromItem===k) || (c.to===nodeId && c.toItem===k));
  }
  function shiftGroupConnections(node, fieldKey, at, delta){
    // when a row is inserted/removed at index `at`, shift row-keys at or after it
    const prefix = "g:"+fieldKey+":";
    getData().connections.forEach(c=>{
      ["fromItem","toItem"].forEach(side=>{
        const v = c[side];
        if(typeof v==="string" && v.indexOf(prefix)===0){
          const ri = parseInt(v.slice(prefix.length),10);
          if(delta>0 && ri>=at) c[side] = groupKey(fieldKey, ri+1);
          else if(delta<0 && ri>at) c[side] = groupKey(fieldKey, ri-1);
        }
      });
    });
  }
  function addGroupRow(node, fieldKey, afterIdx){
    const def = customTypes[node.type];
    const f = def ? def.fields.find(x=>x.key===fieldKey) : null;
    if(!f) return;
    if(!Array.isArray(node.fields[fieldKey])) node.fields[fieldKey] = [];
    const rows = node.fields[fieldKey];
    const at = (afterIdx===undefined||afterIdx===null) ? rows.length : afterIdx+1;
    shiftGroupConnections(node, fieldKey, at, +1);
    rows.splice(at, 0, blankGroupRow(f.subfields));
    renderBoard(); queueBoardSave(currentBoardId);
    const cell = canvasInner.querySelector('.node[data-id="'+node.id+'"] .group-row[data-gk="'+fieldKey+'"][data-ri="'+at+'"] .gsub');
    if(cell) cell.focus();
  }
  function removeGroupRow(node, fieldKey, idx){
    const rows = node.fields[fieldKey];
    if(!Array.isArray(rows)) return;
    // drop connections attached to this row, then shift the rest down
    const k = groupKey(fieldKey, idx);
    const data = getData();
    data.connections = data.connections.filter(c=>!(
      (c.from===node.id && c.fromItem===k) || (c.to===node.id && c.toItem===k)));
    shiftGroupConnections(node, fieldKey, idx, -1);
    rows.splice(idx,1);
    renderBoard(); queueBoardSave(currentBoardId);
  }
  function addListItem(node, afterIdx){
    const at = (afterIdx===undefined || afterIdx===null) ? node.items.length : afterIdx+1;
    node.items.splice(at, 0, "");
    getData().connections.forEach(c=>{
      if(c.from===node.id && c.fromItem!==null && c.fromItem>=at) c.fromItem++;
      if(c.to===node.id && c.toItem!==null && c.toItem>=at) c.toItem++;
    });
    renderBoard(); queueBoardSave(currentBoardId);
    const input = canvasInner.querySelector('.node[data-id="'+node.id+'"] .list-row[data-idx="'+at+'"] .list-input');
    if(input) input.focus();
  }
  function addTicketRow(node, afterIdx){
    const at = (afterIdx===undefined||afterIdx===null) ? node.tickets.length : afterIdx+1;
    node.tickets.splice(at, 0, blankTicket());
    getData().connections.forEach(c=>{
      if(c.from===node.id && c.fromItem!==null && c.fromItem>=at) c.fromItem++;
      if(c.to===node.id && c.toItem!==null && c.toItem>=at) c.toItem++;
    });
    renderBoard(); queueBoardSave(currentBoardId);
    const f = canvasInner.querySelector('.node[data-id="'+node.id+'"] .ticket-row[data-idx="'+at+'"] .tr-no');
    if(f) f.focus();
  }
  function removeTicketRow(node, idx){
    if(node.tickets.length===1){ node.tickets[0]=blankTicket(); renderBoard(); queueBoardSave(currentBoardId); return; }
    node.tickets.splice(idx,1);
    const data = getData();
    data.connections = data.connections.filter(c=>
      !((c.from===node.id && c.fromItem===idx) || (c.to===node.id && c.toItem===idx)));
    data.connections.forEach(c=>{
      if(c.from===node.id && c.fromItem!==null && c.fromItem>idx) c.fromItem--;
      if(c.to===node.id && c.toItem!==null && c.toItem>idx) c.toItem--;
    });
    renderBoard(); queueBoardSave(currentBoardId);
  }

  function removeListItem(node, idx){
    if(node.items.length===1){ node.items[0]=""; renderBoard(); queueBoardSave(currentBoardId); return; }
    node.items.splice(idx,1);
    const data = getData();
    data.connections = data.connections.filter(c=>
      !((c.from===node.id && c.fromItem===idx) || (c.to===node.id && c.toItem===idx)));
    data.connections.forEach(c=>{
      if(c.from===node.id && c.fromItem!==null && c.fromItem>idx) c.fromItem--;
      if(c.to===node.id && c.toItem!==null && c.toItem>idx) c.toItem--;
    });
    renderBoard(); queueBoardSave(currentBoardId);
  }

  /* ---------- node element ---------- */
  function nodeElement(node){
    const div = document.createElement("div");
    div.className = "node type-"+node.type + (selection.has(node.id)?" selected":"");
    div.dataset.id = node.id;
    div.style.left = node.x+"px"; div.style.top = node.y+"px"; div.style.width = node.w+"px";
    if(node.type!=="list" && node.type!=="ticket" && node.type!=="week" && !isCustomType(node.type)) div.style.height = node.h+"px";
    if(node.type!=="header" && node.type!=="image") div.style.background = node.color || "#fff";

    let bodyHtml = "";
    if(node.type==="image"){
      bodyHtml = '<div class="node-body">'+(node.image?'<img src="'+node.image+'">':'<span style="color:var(--muted-2);font-size:12px;">No image yet</span>')+'</div>';
    } else if(node.type==="list"){
      bodyHtml = '<div class="list-rows">' + node.items.map((txt,i)=>
        '<div class="list-row" data-idx="'+i+'">' +
          '<span class="list-bullet"></span>' +
          '<input class="list-input" data-idx="'+i+'" value="'+escapeAttr(txt)+'" placeholder="List item...">' +
          '<button class="row-del" data-idx="'+i+'" title="Remove line">&times;</button>' +
          '<span class="row-conn '+(itemHasConnection(node.id,i)?'has-link':'')+'" data-idx="'+i+'" title="Drag to branch from this line"></span>' +
        '</div>').join('') + '</div>' +
        '<button class="add-item-btn">+ line</button>';
    } else if(node.type==="week"){
      const rows = node.tickets.map((t,i)=>
        '<div class="ticket-row" data-idx="'+i+'">' +
          '<div class="tr-top">' +
            '<input class="tr-no" data-idx="'+i+'" value="'+escapeAttr(t.no||"")+'" placeholder="INC-0000">' +
            '<button class="copy-btn cp-row-no" data-idx="'+i+'" title="Copy ticket number">'+COPY_ICON+'</button>' +
            '<input class="tr-link" data-idx="'+i+'" value="'+escapeAttr(t.link||"")+'" placeholder="link">' +
            '<button class="tk-open'+(t.link?"":" off")+'" data-idx="'+i+'" title="Open link">\u2197</button>' +
            '<button class="row-del" data-idx="'+i+'" title="Remove ticket">&times;</button>' +
          '</div>' +
          '<div class="tr-meta">' +
            '<input class="tr-assigned" data-idx="'+i+'" value="'+escapeAttr(t.assigned||"")+'" placeholder="assigned">' +
            '<span class="divider"></span>' +
            '<input class="tr-customer" data-idx="'+i+'" value="'+escapeAttr(t.customer||"")+'" placeholder="customer">' +
            '<button class="copy-btn cp-row-all" data-idx="'+i+'" title="Copy this ticket">'+COPY_ICON+'</button>' +
          '</div>' +
          '<textarea class="tr-note" data-idx="'+i+'" rows="1" placeholder="note...">'+escapeHtml(t.note||"")+'</textarea>' +
          '<span class="row-conn '+(itemHasConnection(node.id,i)?"has-link":"")+'" data-idx="'+i+'" title="Drag to branch from this ticket"></span>' +
        '</div>').join('');
      bodyHtml =
        '<div class="wk-head">' +
          '<input class="wk-label" value="'+escapeAttr(node.weekLabel||"")+'" placeholder="Week of...">' +
          '<span class="wk-count">'+node.tickets.length+'</span>' +
          '<button class="copy-btn cp-week" title="Copy every ticket in this week">'+COPY_ICON+'</button>' +
        '</div>' +
        '<div class="wk-rows">'+rows+'</div>' +
        '<button class="add-item-btn">+ ticket</button>' +
        '<div class="wk-notes-label">Notes</div>' +
        '<div class="node-body"><div class="node-rich" contenteditable="true" data-ph="Notes for the week...">'+sanitizeHtml(node.bodyHtml)+'</div></div>';
    } else if(isCustomType(node.type)){
      bodyHtml = customBodyHtml(node);
    } else if(node.type!=="header"){
      const ph = node.type==="question" ? "What are we not sure about?" : "Notes...";
      bodyHtml = '<div class="node-body"><div class="node-rich" contenteditable="true" data-ph="'+ph+'">'+sanitizeHtml(node.bodyHtml)+'</div></div>';
    }

    const colorRow = (node.type!=="image" && node.type!=="header")
      ? '<div class="color-row">'+COLORS.map(c=>'<button class="swatch '+(node.color===c?'active':'')+'" data-color="'+c+'" style="background:'+c+'"></button>').join('')+'</div>'
      : '';

    const defForBar = customTypes[node.type];
    const hasRich = (node.type==="week") ||
      (defForBar && defForBar.fields.some(f=>
        f.kind==="richtext" || f.kind==="longtext" ||
        (f.kind==="group" && (f.subfields||[]).some(sf=>sf.kind==="richtext" || sf.kind==="longtext"))));
    const fmtBar = hasRich
      ? '<div class="fmt-bar">' +
          '<button data-cmd="bold" title="Bold"><b>B</b></button>' +
          '<button data-cmd="italic" title="Italic"><i>I</i></button>' +
          '<span class="sep"></span>' +
          '<button data-cmd="insertUnorderedList" title="Bulleted list">\u2022 \u2013</button>' +
          '<button data-cmd="insertOrderedList" title="Numbered list">1.</button>' +
          '<span class="sep"></span>' +
          '<button data-cmd="createLink" title="Add link">Link</button>' +
          '<button data-cmd="unlink" title="Remove link">\u2717</button>' +
          '<span class="sep"></span>' +
          '<button data-cmd="copytext" title="Copy this text">'+COPY_ICON+'</button>' +
        '</div>'
      : '';

    const kids = outgoingCount(node.id);
    const hiddenCount = node.collapsed ? descendantsOf(node.id).size : 0;
    const collapseBtn = kids
      ? '<button class="collapse-btn'+(node.collapsed?" is-collapsed":"")+'" title="'+(node.collapsed?"Expand":"Collapse")+' what\'s connected below">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m6 9 6 6 6-6"/></svg>' +
        '</button>'
      : '';
    const countBadge = (node.collapsed && hiddenCount)
      ? '<span class="hidden-badge">'+hiddenCount+' hidden</span>' : '';

    div.innerHTML =
      '<div class="node-header">' +
        collapseBtn +
        '<span class="grip">&#10807;&#10241;</span>' +
        '<input class="node-title" value="'+escapeAttr(node.title)+'" placeholder="'+(node.type==='header'?'Topic title':'Title')+'">' +
        countBadge +
        '<div class="node-actions">' +
          (node.type==="image"?'<button class="icon-btn change-img" title="Replace image">&#8635;</button>':'') +
          '<button class="icon-btn dupe" title="Duplicate">&#10064;</button>' +
          '<button class="icon-btn del" title="Delete">&times;</button>' +
        '</div>' +
      '</div>' + bodyHtml + colorRow + fmtBar +
      (node.type!=="header" ? '<div class="resize-handle"></div>' : '') +
      '<div class="conn-handle" title="Drag to connect"></div>';

    const collapseEl = div.querySelector(".collapse-btn");
    if(collapseEl){
      collapseEl.addEventListener("pointerdown", e=>e.stopPropagation());
      collapseEl.addEventListener("click",(e)=>{ e.stopPropagation(); toggleCollapse(node.id); });
    }

    div.addEventListener("pointerdown",(e)=>{
      if(e.button!==0) return;
      if(e.target.closest("input,textarea,button,.resize-handle,.conn-handle,.row-conn")) return;
      selectNode(node.id, e.ctrlKey||e.metaKey||e.shiftKey);
      const ids = selection.has(node.id) && selection.size>1 ? [...selection] : [node.id];
      const moving = [];
      ids.forEach(id=>{
        const n = findNode(id);
        const nel = canvasInner.querySelector('.node[data-id="'+id+'"]');
        if(n && nel) moving.push({node:n, el:nel, ox:n.x, oy:n.y});
      });
      dragState = { mode:"drag", moving, startX:e.clientX, startY:e.clientY };
      div.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });

    const titleInput = div.querySelector(".node-title");
    titleInput.addEventListener("pointerdown", e=>e.stopPropagation());
    titleInput.addEventListener("input", e=>{ node.title=e.target.value; queueBoardSave(currentBoardId); });
    titleInput.addEventListener("focus", ()=>selectNode(node.id));

    /* custom-type fields */
    if(isCustomType(node.type)) wireCustomFields(div, node);

    /* rich text body */
    const rich = div.querySelector(".node-rich");
    if(rich){
      rich.addEventListener("pointerdown", e=>e.stopPropagation());
      rich.addEventListener("focus", ()=>selectNode(node.id));
      rich.addEventListener("input", ()=>{
        node.bodyHtml = rich.innerHTML;
        node.body = richToText(rich.innerHTML);
        queueBoardSave(currentBoardId);
      });
      rich.addEventListener("blur", ()=>{
        const clean = sanitizeHtml(rich.innerHTML);
        if(clean !== rich.innerHTML) rich.innerHTML = clean;
        node.bodyHtml = clean;
        node.body = richToText(clean);
        queueBoardSave(currentBoardId);
      });
      // paste as plain text so outside styling never leaks in
      rich.addEventListener("paste",(e)=>{
        const cd = e.clipboardData;
        if(!cd) return;
        // an image still becomes its own block on the canvas
        if(cd.items){
          for(const item of cd.items){
            if(item.type.indexOf("image")===0){
              e.preventDefault();
              e.stopPropagation();
              processImageFile(item.getAsFile(),(dataUrl,w,h)=>{
                const n = createNode("image", cursorCanvas.x, cursorCanvas.y, {silent:true});
                n.image = dataUrl; n.w = Math.min(320,w); n.h = n.w*(h/w);
                renderBoard(); queueBoardSave(currentBoardId);
              });
              return;
            }
          }
        }
        const txt = cd.getData("text/plain");
        if(txt){
          e.preventDefault();
          e.stopPropagation();
          const url = normalizeUrl(txt);
          if(/^https?:\/\//i.test(url) && txt.indexOf(" ")===-1){
            document.execCommand("insertHTML", false,
              '<a href="'+escapeAttr(url)+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(txt)+'</a>&nbsp;');
          } else {
            document.execCommand("insertText", false, txt);
          }
        }
      });
      // ctrl/cmd-click opens a link without disturbing the cursor
      rich.addEventListener("click",(e)=>{
        const a = e.target.closest("a");
        if(a && (e.ctrlKey||e.metaKey)){
          e.preventDefault();
          openLinkBackground(a.href);
        }
      });
    }

    /* format toolbar: acts on whichever rich area was last focused in this box */
    let lastRich = div.querySelector(".node-rich") || div.querySelector(".cf-rich");
    div.querySelectorAll(".node-rich, .cf-rich").forEach(r=>{
      r.addEventListener("focus", ()=>{ lastRich = r; });
    });
    div.querySelectorAll(".fmt-bar button").forEach(btn=>{
      btn.addEventListener("pointerdown",(e)=>{ e.preventDefault(); e.stopPropagation(); });
      btn.addEventListener("click",(e)=>{
        e.stopPropagation();
        const target = lastRich || div.querySelector(".node-rich") || div.querySelector(".cf-rich");
        if(!target) return;
        target.focus();
        const cmd = btn.dataset.cmd;
        if(cmd==="copytext"){ copyText(richToText(target.innerHTML), btn); return; }
        try{ document.execCommand("styleWithCSS", false, false); }catch(err){}
        if(cmd==="createLink"){
          const sel = window.getSelection();
          const hasSel = sel && sel.toString().trim().length;
          const url = normalizeUrl(prompt("Link URL:", "https://") || "");
          if(!url) return;
          if(hasSel){ document.execCommand("createLink", false, url); }
          else {
            document.execCommand("insertHTML", false,
              '<a href="'+escapeAttr(url)+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(url)+'</a>&nbsp;');
          }
        } else {
          document.execCommand(cmd, false, null);
        }
        const clean = sanitizeHtml(target.innerHTML);
        target.innerHTML = clean;
        // write back to the correct place: node-rich -> bodyHtml, cf-rich -> its field
        if(target.classList.contains("cf-rich")){
          setFieldVal(node, target.dataset.fk, clean);
        } else {
          node.bodyHtml = clean;
          node.body = richToText(clean);
        }
        queueBoardSave(currentBoardId);
      });
    });

    /* single ticket fields */
    [["tk-no","ticketNo"],["tk-link","link"],["tk-assigned","assigned"],["tk-customer","customer"]]
      .forEach(([cls, prop])=>{
        const f = div.querySelector("."+cls);
        if(!f) return;
        f.addEventListener("pointerdown", e=>e.stopPropagation());
        f.addEventListener("focus", ()=>selectNode(node.id));
        f.addEventListener("input", e=>{
          node[prop] = e.target.value;
          if(prop==="link"){
            const ob = div.querySelector(".tk-fields .tk-open");
            if(ob) ob.classList.toggle("off", !node.link);
          }
          queueBoardSave(currentBoardId);
        });
      });
    if(node.type==="ticket"){
      const openBtn = div.querySelector(".tk-fields .tk-open");
      if(openBtn){
        openBtn.addEventListener("pointerdown", e=>e.stopPropagation());
        openBtn.addEventListener("click",(e)=>{
          e.stopPropagation();
          openLinkBackground(node.link);
        });
      }
      [["cp-no", ()=>node.ticketNo],
       ["cp-link", ()=>node.link],
       ["cp-assigned", ()=>node.assigned],
       ["cp-customer", ()=>node.customer],
       ["cp-all", ()=>ticketSummary({no:node.ticketNo, link:node.link, assigned:node.assigned,
                                     customer:node.customer, note:richToText(node.bodyHtml)})]
      ].forEach(([cls, get])=>{
        const b = div.querySelector("."+cls);
        if(!b) return;
        b.addEventListener("pointerdown", e=>e.stopPropagation());
        b.addEventListener("click",(e)=>{ e.stopPropagation(); copyText(get(), b); });
      });
    }

    /* week container rows */
    div.querySelectorAll(".tr-no, .tr-link, .tr-note, .tr-assigned, .tr-customer").forEach(fld=>{
      fld.addEventListener("pointerdown", e=>e.stopPropagation());
      fld.addEventListener("focus", ()=>selectNode(node.id));
      fld.addEventListener("input",(e)=>{
        const i = parseInt(e.target.dataset.idx,10);
        const t = node.tickets[i];
        if(!t) return;
        if(e.target.classList.contains("tr-no")) t.no = e.target.value;
        else if(e.target.classList.contains("tr-assigned")) t.assigned = e.target.value;
        else if(e.target.classList.contains("tr-customer")) t.customer = e.target.value;
        else if(e.target.classList.contains("tr-link")){
          t.link = e.target.value;
          const btn = e.target.parentNode.querySelector(".tk-open");
          if(btn) btn.classList.toggle("off", !t.link);
        }
        else {
          t.note = e.target.value;
          e.target.style.height = "auto";
          e.target.style.height = e.target.scrollHeight+"px";
          measureListOffsets();
          updateConnectionsTouching(node.id);
        }
        queueBoardSave(currentBoardId);
      });
      fld.addEventListener("keydown",(e)=>{
        if(e.target.classList.contains("tr-note")) return;
        const i = parseInt(e.target.dataset.idx,10);
        if(e.key==="Enter"){ e.preventDefault(); addTicketRow(node, i); }
      });
    });
    div.querySelectorAll(".cp-row-no").forEach(btn=>{
      btn.addEventListener("pointerdown", e=>e.stopPropagation());
      btn.addEventListener("click",(e)=>{
        e.stopPropagation();
        const t = node.tickets[parseInt(btn.dataset.idx,10)];
        if(t) copyText(t.no, btn);
      });
    });
    div.querySelectorAll(".cp-row-all").forEach(btn=>{
      btn.addEventListener("pointerdown", e=>e.stopPropagation());
      btn.addEventListener("click",(e)=>{
        e.stopPropagation();
        const t = node.tickets[parseInt(btn.dataset.idx,10)];
        if(t) copyText(ticketSummary(t), btn);
      });
    });
    const cpWeek = div.querySelector(".cp-week");
    if(cpWeek){
      cpWeek.addEventListener("pointerdown", e=>e.stopPropagation());
      cpWeek.addEventListener("click",(e)=>{
        e.stopPropagation();
        const lines = node.tickets.map(t=>ticketSummary(t)).filter(Boolean);
        const head = (node.weekLabel||"").trim();
        copyText((head?head+"\n\n":"")+lines.join("\n\n"), cpWeek);
      });
    }
    div.querySelectorAll(".wk-rows .tk-open").forEach(btn=>{
      btn.addEventListener("pointerdown", e=>e.stopPropagation());
      btn.addEventListener("click",(e)=>{
        e.stopPropagation();
        const t = node.tickets[parseInt(btn.dataset.idx,10)];
        if(t) openLinkBackground(t.link);
      });
    });
    const wkLabel = div.querySelector(".wk-label");
    if(wkLabel){
      wkLabel.addEventListener("pointerdown", e=>e.stopPropagation());
      wkLabel.addEventListener("focus", ()=>selectNode(node.id));
      wkLabel.addEventListener("input", e=>{ node.weekLabel = e.target.value; queueBoardSave(currentBoardId); });
    }

    // list rows
    div.querySelectorAll(".list-input").forEach(input=>{
      input.addEventListener("pointerdown", e=>e.stopPropagation());
      input.addEventListener("focus", ()=>selectNode(node.id));
      input.addEventListener("input",(e)=>{
        node.items[parseInt(e.target.dataset.idx,10)] = e.target.value;
        queueBoardSave(currentBoardId);
      });
      input.addEventListener("keydown",(e)=>{
        const i = parseInt(e.target.dataset.idx,10);
        if(e.key==="Enter"){ e.preventDefault(); addListItem(node, i); }
        else if(e.key==="Backspace" && e.target.value===""){ e.preventDefault(); removeListItem(node, i); }
      });
    });
    div.querySelectorAll(".row-del").forEach(btn=>{
      btn.addEventListener("pointerdown", e=>e.stopPropagation());
      btn.addEventListener("click",()=>{
        const i = parseInt(btn.dataset.idx,10);
        if(node.type==="week") removeTicketRow(node, i); else removeListItem(node, i);
      });
    });
    const addItemBtn = div.querySelector(".add-item-btn");
    if(addItemBtn){
      addItemBtn.addEventListener("pointerdown", e=>e.stopPropagation());
      addItemBtn.addEventListener("click",()=>{
        if(node.type==="week") addTicketRow(node); else addListItem(node);
      });
    }
    div.querySelectorAll(".row-conn[data-idx]").forEach(dot=>{
      dot.addEventListener("pointerdown",(e)=>{
        e.stopPropagation();
        const idx = parseInt(dot.dataset.idx,10);
        const offs = itemOffsets[node.id] || [];
        const oy = offs[idx]!=null ? offs[idx] : node.h/2;
        startConnectDrag(node.id, idx, node.x+node.w, node.y+oy);
      });
    });

    div.querySelectorAll(".swatch").forEach(sw=>{
      sw.addEventListener("pointerdown", e=>e.stopPropagation());
      sw.addEventListener("click",()=>{
        const color = sw.dataset.color;
        const targets = selection.has(node.id) && selection.size>1 ? [...selection] : [node.id];
        targets.forEach(id=>{
          const n = findNode(id);
          if(!n) return;
          n.color = color;
          const nel = canvasInner.querySelector('.node[data-id="'+id+'"]');
          if(nel && n.type!=="header" && n.type!=="image"){
            nel.style.background = color;
            nel.querySelectorAll(".swatch").forEach(s=>s.classList.toggle("active", s.dataset.color===color));
          }
        });
        queueBoardSave(currentBoardId);
      });
    });

    const dupeBtn = div.querySelector(".dupe");
    if(dupeBtn){ dupeBtn.addEventListener("pointerdown", e=>e.stopPropagation()); dupeBtn.addEventListener("click",()=>duplicateNode(node.id)); }
    const delBtn = div.querySelector(".del");
    delBtn.addEventListener("pointerdown", e=>e.stopPropagation());
    delBtn.addEventListener("click",()=>deleteNode(node.id));

    const changeImgBtn = div.querySelector(".change-img");
    if(changeImgBtn){
      changeImgBtn.addEventListener("pointerdown", e=>e.stopPropagation());
      changeImgBtn.addEventListener("click",()=>{
        imgFileInput.onchange = (e)=>{
          const file = e.target.files[0];
          if(file) processImageFile(file,(dataUrl)=>{
            node.image = dataUrl;
            div.querySelector(".node-body").innerHTML = '<img src="'+dataUrl+'">';
            queueBoardSave(currentBoardId);
          });
          imgFileInput.value=""; imgFileInput.onchange=null;
        };
        imgFileInput.click();
      });
    }

    const resizeHandle = div.querySelector(".resize-handle");
    if(resizeHandle){
      resizeHandle.addEventListener("pointerdown",(e)=>{
        e.stopPropagation();
        dragState = { mode:"resize", node, el:div, startX:e.clientX, startY:e.clientY, ow:node.w, oh:node.h };
        div.setPointerCapture(e.pointerId);
      });
    }

    const connHandle = div.querySelector(".conn-handle");
    connHandle.addEventListener("pointerdown",(e)=>{
      e.stopPropagation();
      startConnectDrag(node.id, null, node.x+node.w, node.y+node.h/2);
    });

    return div;
  }

  /* ---------- connections ---------- */
  function edgePoint(node, dirX, dirY){
    const cx=node.x+node.w/2, cy=node.y+node.h/2, hw=node.w/2, hh=node.h/2;
    if(dirX===0 && dirY===0) return {x:cx,y:cy};
    const sx = dirX!==0 ? hw/Math.abs(dirX) : Infinity;
    const sy = dirY!==0 ? hh/Math.abs(dirY) : Infinity;
    const s = Math.min(sx,sy);
    return { x:cx+dirX*s, y:cy+dirY*s };
  }

  function anchorPoint(node, itemIndex, towardX, towardY){
    if(itemIndex===null || itemIndex===undefined){
      const cx=node.x+node.w/2, cy=node.y+node.h/2;
      return edgePoint(node, towardX-cx, towardY-cy);
    }
    const cx = node.x+node.w/2;
    let oy;
    if(typeof itemIndex==="string" && itemIndex.indexOf("g:")===0){
      const go = groupOffsets[node.id] || {};
      oy = go[itemIndex]!=null ? go[itemIndex] : node.h/2;
    } else {
      const offs = itemOffsets[node.id] || [];
      oy = offs[itemIndex]!=null ? offs[itemIndex] : node.h/2;
    }
    return { x: towardX>cx ? node.x+node.w : node.x, y: node.y+oy };
  }

  function connLine(conn){
    const a = findNode(conn.from), b = findNode(conn.to);
    if(!a||!b) return null;
    const bcx=b.x+b.w/2, bcy=b.y+b.h/2;
    const p1 = anchorPoint(a, conn.fromItem, bcx, bcy);
    const p2 = anchorPoint(b, conn.toItem, p1.x, p1.y);
    return { x1:p1.x, y1:p1.y, x2:p2.x, y2:p2.y };
  }

  function createConnection(fromId, fromItem, toId, toItem){
    getData().connections.push({
      id:uid(), from:fromId, to:toId,
      fromItem: (fromItem===undefined?null:fromItem),
      toItem: (toItem===undefined?null:toItem),
      label:""
    });
    renderBoard(); queueBoardSave(currentBoardId);
  }
  function deleteConnection(id){
    getData().connections = getData().connections.filter(c=>c.id!==id);
    selectedConnId = null;
    renderBoard(); queueBoardSave(currentBoardId);
  }

  function updateConnectionsTouching(nodeId){
    getData().connections.forEach(conn=>{
      if(conn.from!==nodeId && conn.to!==nodeId) return;
      const line = connLine(conn);
      if(!line) return;
      const vis = connSvg.querySelector('.visible[data-conn="'+conn.id+'"]');
      const hit = connSvg.querySelector('.hit[data-conn="'+conn.id+'"]');
      [vis,hit].forEach(l=>{ if(l){ l.setAttribute("x1",line.x1); l.setAttribute("y1",line.y1); l.setAttribute("x2",line.x2); l.setAttribute("y2",line.y2); } });
    });
    renderConnLabelsAndDelete();
  }

  function renderConnections(){
    connSvg.querySelectorAll("line:not(#tempConnLine)").forEach(n=>n.remove());
    const hidden = hiddenNodeIds();
    getData().connections.forEach(conn=>{
      if(hidden.has(conn.from) || hidden.has(conn.to)) return;
      const line = connLine(conn);
      if(!line) return;
      const vis = document.createElementNS("http://www.w3.org/2000/svg","line");
      vis.setAttribute("class","visible"+(selectedConnId===conn.id?" selected":""));
      vis.setAttribute("data-conn",conn.id);
      vis.setAttribute("x1",line.x1); vis.setAttribute("y1",line.y1);
      vis.setAttribute("x2",line.x2); vis.setAttribute("y2",line.y2);
      vis.setAttribute("stroke","#9aa1ab"); vis.setAttribute("stroke-width","2"); vis.setAttribute("marker-end","url(#arrowHead)");
      connSvg.appendChild(vis);

      const hit = document.createElementNS("http://www.w3.org/2000/svg","line");
      hit.setAttribute("class","hit"); hit.setAttribute("data-conn",conn.id);
      hit.setAttribute("x1",line.x1); hit.setAttribute("y1",line.y1);
      hit.setAttribute("x2",line.x2); hit.setAttribute("y2",line.y2);
      hit.setAttribute("stroke","transparent"); hit.setAttribute("stroke-width","14");
      hit.addEventListener("click",(e)=>{
        e.stopPropagation();
        selectedConnId = conn.id; selection.clear();
        canvasInner.querySelectorAll(".node.selected").forEach(n=>n.classList.remove("selected"));
        renderConnections();
      });
      hit.addEventListener("dblclick",(e)=>{
        e.stopPropagation();
        const label = prompt("Label for this connection:", conn.label||"");
        if(label!==null){ conn.label = label.trim(); renderConnections(); queueBoardSave(currentBoardId); }
      });
      connSvg.appendChild(hit);
    });
    renderConnLabelsAndDelete();
  }

  function renderConnLabelsAndDelete(){
    canvasInner.querySelectorAll(".conn-label, .conn-del").forEach(n=>n.remove());
    const hidden = hiddenNodeIds();
    getData().connections.forEach(conn=>{
      if(hidden.has(conn.from) || hidden.has(conn.to)) return;
      const line = connLine(conn);
      if(!line) return;
      const mx=(line.x1+line.x2)/2, my=(line.y1+line.y2)/2;
      if(conn.label){
        const lbl = document.createElement("div");
        lbl.className="conn-label"; lbl.style.left=mx+"px"; lbl.style.top=my+"px";
        lbl.textContent = conn.label;
        canvasInner.appendChild(lbl);
      }
      if(selectedConnId===conn.id){
        const b = document.createElement("button");
        b.className="conn-del"; b.style.left=mx+"px"; b.style.top=(my-18)+"px"; b.textContent="\u00d7";
        b.addEventListener("click",()=>deleteConnection(conn.id));
        canvasInner.appendChild(b);
      }
    });
  }

  /* ---------- render ---------- */
  function measureListOffsets(){
    itemOffsets = {};
    groupOffsets = {};
    // auto-height blocks: store the height the browser actually gave them
    getData().nodes.forEach(node=>{
      if(node.type!=="ticket" && !isCustomType(node.type)) return;
      const nel = canvasInner.querySelector('.node[data-id="'+node.id+'"]');
      if(nel) node.h = nel.offsetHeight;
    });
    getData().nodes.forEach(node=>{
      // list/week numeric row offsets
      if(node.type==="list" || node.type==="week"){
        const nodeEl = canvasInner.querySelector('.node[data-id="'+node.id+'"]');
        if(nodeEl){
          node.h = nodeEl.offsetHeight;
          const offs = [];
          nodeEl.querySelectorAll(".list-row, .ticket-row").forEach(row=>{
            offs.push(row.offsetTop + row.offsetHeight/2);
          });
          itemOffsets[node.id] = offs;
        }
      }
      // custom-block group row offsets (string-keyed)
      if(isCustomType(node.type)){
        const nodeEl = canvasInner.querySelector('.node[data-id="'+node.id+'"]');
        if(nodeEl){
          const go = {};
          nodeEl.querySelectorAll(".group-row").forEach(row=>{
            const gk = row.dataset.gk, ri = row.dataset.ri;
            go["g:"+gk+":"+ri] = row.offsetTop + row.offsetHeight/2;
          });
          groupOffsets[node.id] = go;
        }
      }
    });
  }

  function fitCanvasBounds(){
    const data = getData();
    let maxX = 4200, maxY = 3000;
    data.nodes.forEach(n=>{
      maxX = Math.max(maxX, n.x + (n.w||220) + 400);
      maxY = Math.max(maxY, n.y + (n.h||140) + 400);
    });
    canvasInner.style.width = maxX+"px";
    canvasInner.style.height = maxY+"px";
    connSvg.setAttribute("width", maxX);
    connSvg.setAttribute("height", maxY);
  }

  function renderBoard(){
    fitCanvasBounds();
    canvasInner.querySelectorAll(".node, .conn-label, .conn-del, .empty-hint").forEach(n=>n.remove());
    const data = getData();
    const hidden = hiddenNodeIds();
    data.nodes.forEach(node=>{ if(!hidden.has(node.id)) canvasInner.appendChild(nodeElement(node)); });
    if(!data.nodes.length){
      const hint = document.createElement("div");
      hint.className="empty-hint";
      hint.innerHTML = "Press <b>H N L Q</b> to drop a box at your cursor,<br>or paste an image straight onto the canvas.";
      canvasInner.appendChild(hint);
    }
    canvasInner.querySelectorAll(".tr-note").forEach(t=>{
      t.style.height = "auto";
      t.style.height = t.scrollHeight+"px";
    });
    measureListOffsets();
    renderConnections();
  }

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
    if(dragState && dragState.mode==="connect" && plain){
      const type = HOTKEYS[e.key.toLowerCase()];
      if(type && type!=="image"){
        e.preventDefault();
        const from = dragState;
        cleanupConnectVisuals();
        dragState = null;
        const node = createNode(type, cursorCanvas.x+90, cursorCanvas.y, {silent:true});
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
      if(selection.size){ e.preventDefault(); deleteSelectedNodes(); }
      else if(selectedConnId){ e.preventDefault(); deleteConnection(selectedConnId); }
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
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==="c" && !inField && selection.size){
      const nodes = [...selection].map(findNode).filter(Boolean);
      if(nodes.length){
        const ids = new Set(nodes.map(n=>n.id));
        // capture connections whose BOTH ends are in the selection, so a copied
        // cluster keeps its internal wiring when pasted (even on another page)
        const conns = getData().connections.filter(c=>ids.has(c.from) && ids.has(c.to));
        const payload = { nodes:JSON.parse(JSON.stringify(nodes)), connections:JSON.parse(JSON.stringify(conns)) };
        clipboardNode = payload;
        try{ navigator.clipboard.writeText("MINDMAP_NODE::"+JSON.stringify(payload)); }catch(err){}
        showToast(nodes.length>1 ? "Copied "+nodes.length+" boxes" : "Copied");
      }
    }
    if(e.key==="Escape"){
      if(el("pageMenu")){ closePageMenu(); return; }
      if(dragState && dragState.mode==="connect"){ cleanupConnectVisuals(); dragState=null; }
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
      copy.x = Math.round(cursorCanvas.x + (n.x-minX));
      copy.y = Math.round(cursorCanvas.y + (n.y-minY));
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
    renderBoard(); setSelection(newIds); queueBoardSave(currentBoardId);
    showToast(newIds.length>1 ? "Pasted "+newIds.length+" boxes" : "Pasted");
  }
  function createNoteNodeWithText(text){
    const node = createNode("note", cursorCanvas.x, cursorCanvas.y, {silent:true});
    node.body = text.slice(0,600);
    node.title = text.slice(0,40);
    renderBoard(); queueBoardSave(currentBoardId);
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
            const node = createNode("image", cursorCanvas.x, cursorCanvas.y, {silent:true});
            node.image = dataUrl; node.w = Math.min(320,w); node.h = node.w*(h/w);
            renderBoard(); queueBoardSave(currentBoardId);
          });
          return;
        }
      }
    }
    const text = cd ? cd.getData("text/plain") : "";
    if(text && text.indexOf("MINDMAP_NODE::")===0){
      e.preventDefault();
      try{ pasteNodeCopy(JSON.parse(text.slice(14))); }
      catch(err){ if(clipboardNode) pasteNodeCopy(clipboardNode); }
      return;
    }
    if(clipboardNode){ e.preventDefault(); pasteNodeCopy(clipboardNode); return; }
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
    if(backend==="memory" && getData().nodes.length){
      e.preventDefault();
      e.returnValue = "";
    }
  });

  /* ---------- block designer ---------- */
  const TYPE_ACCENTS = ["#ffffff","#fde68a","#bfdbfe","#bbf7d0","#fecaca","#e9d5ff","#fed7aa","#c7d2fe"];
  let bdEditingId = null;

  function renderTypeToolbar(){
    const wrap = el("customTypeBtns");
    if(!wrap) return;
    const ids = Object.keys(customTypes).filter(id=>!customTypes[id].builtin);
    wrap.innerHTML = ids.map(id=>{
      const t = customTypes[id];
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
    const ids = Object.keys(customTypes);
    if(ids.length) editType(ids[0]); else { bdEditingId=null; renderEditor(); }
  }
  function closeDesigner(){
    el("bdOverlay").classList.remove("open");
    renderTypeToolbar();
    renderBoard();
  }

  function renderTypeList(){
    const list = el("bdTypeList");
    const ids = Object.keys(customTypes);
    // built-in editable first, then user-created
    const builtinIds = ids.filter(id=>customTypes[id].builtin);
    const customIds = ids.filter(id=>!customTypes[id].builtin);

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
    const t = customTypes[id];
    const canDelete = !t.builtin;
    return '<button class="bd-typebtn '+(id===bdEditingId?"active":"")+'" data-id="'+id+'">' +
      '<span class="sw" style="background:'+(t.accent||"#ddd")+'"></span>' +
      '<span>'+escapeHtml(t.name||"Untitled")+'</span>' +
      (canDelete ? '<span class="del" data-del="'+id+'" title="Delete type">&times;</span>' : '<span style="font-size:10px;color:var(--muted-2)">built-in</span>') +
      '</button>';
  }

  function newType(){
    const id = "ct_"+uid().slice(0,8);
    customTypes[id] = { id, name:"New block", accent:"#bfdbfe", width:240,
      fields:[ {key:uid().slice(0,6), label:"Detail", kind:"text", placeholder:"", options:""} ] };
    bdEditingId = id;
    queueTypesSave();
    renderTypeList();
    renderEditor();
  }
  function deleteType(id){
    if(customTypes[id] && customTypes[id].builtin){ showToast("Built-in blocks can't be deleted"); return; }
    const inUse = getData().nodes.some(n=>n.type===id) ||
      boards.some(b=>(boardsData[b.id]||{nodes:[]}).nodes.some(n=>n.type===id));
    const msg = inUse
      ? "Delete this block type? Blocks already placed with it will keep their data but show as plain. This can't be undone."
      : "Delete this block type? This can't be undone.";
    if(!confirm(msg)) return;
    delete customTypes[id];
    if(bdEditingId===id) bdEditingId = Object.keys(customTypes)[0] || null;
    queueTypesSave();
    renderTypeList();
    renderEditor();
  }
  function duplicateType(){
    const src = customTypes[bdEditingId];
    if(!src) return;
    const id = "ct_"+uid().slice(0,8);
    customTypes[id] = JSON.parse(JSON.stringify(src));
    customTypes[id].id = id;
    customTypes[id].name = src.name+" copy";
    customTypes[id].fields.forEach(f=>{
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
    const t = customTypes[bdEditingId];
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
    const t = customTypes[bdEditingId];
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

  // subfields can't themselves be groups (no nesting)
  const SUBFIELD_KINDS = ["text","richtext","link","number","date","checkbox"];

  function fieldKindLabel(k){
    return {text:"Short text", longtext:"Rich text", richtext:"Rich text",
      link:"Link / URL", number:"Number", date:"Date", select:"Dropdown", checkbox:"Checkbox",
      group:"Repeating rows"}[k] || k;
  }

  function renderPreview(){
    const t = customTypes[bdEditingId];
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
    if(backend!=="folder" && typeof window.storage!=="undefined" && window.storage) backend="app";
    await loadCustomTypes();
    seedBuiltinTypes();
    await loadAll();
    reconstructMissingTypes();
    renderTypeToolbar();
    renderBoardList(); renderBoardHeader(); centerView(); renderBoard();
    historyReset(currentBoardId);
    updateStorageBar();
  })();

})();
