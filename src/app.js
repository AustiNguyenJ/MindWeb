import {
  IDX_KEY, TYPES_KEY, COLORS, DEFAULT_SIZE, HOTKEYS, FIELD_KINDS, SUBFIELD_KINDS,
  RICH_OK_TAGS, RICH_DROP_TAGS, COPY_ICON, APP_KEY_LIMIT, BUILTIN_KEYS,
  HISTORY_LIMIT, TYPE_ACCENTS, EDITABLE_BUILTINS, PROTECTED_BUILTINS,
} from "./constants.js";
import {
  uid, escapeHtml, escapeAttr, sanitizeHtml, plainToHtml, richToText, richValue,
  normalizeUrl, openLinkBackground, currentWeekLabel, isTextEntry, looksRich,
} from "./util.js";
import { state } from "./state.js";
import {
  getBoard, getData, findNode, ensureNotebookStructure,
  boardsInNotebook, renumberNotebook,
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
import { el, viewport, canvasInner, connSvg, toastEl, imgFileInput } from "./dom.js";
import { showToast } from "./toast.js";
import { copyText, copyBtnHtml } from "./clipboard.js";
import {
  updateCloudBar, connectCloud, cloudPersistIndex, cloudPersistBoard,
  cloudPersistDeleteBoard, cloudSaveTypes,
} from "./cloud.js";


/* Custom block types the user defines in the Block Designer. Each is a
   schema: a list of fields, plus a default width. Stored per-file so a
   board carries its own block library. Persisted under mindmap:types. */

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
function isCustomType(t){ return !!state.customTypes[t]; }

function seedBuiltinTypes(){
  Object.keys(EDITABLE_BUILTINS).forEach(id=>{
    if(!state.customTypes[id]){
      state.customTypes[id] = JSON.parse(JSON.stringify(EDITABLE_BUILTINS[id]));
    } else {
      state.customTypes[id].builtin = true;   // keep the flag even if loaded from storage
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

function reconstructMissingTypes(){
  const missing = {};   // typeId -> {fieldKey -> inferred field}
  Object.keys(state.boardsData).forEach(bid=>{
    (state.boardsData[bid].nodes||[]).forEach(n=>{
      if(typeof n.type!=="string" || n.type.indexOf("ct_")!==0) return;
      if(state.customTypes[n.type]) return;                 // definition present, nothing to do
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
    state.customTypes[typeId] = {
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
  Object.keys(state.customTypes).forEach(id=>{
    const t = state.customTypes[id];
    if(!t.builtin) push(id, t.name || "Custom", t.accent || "#ffffff");
  });
  return list;
}

let searchScope = { mode:"all", id:null };   // all | notebook | page

let marqueeEl = null;
let linkTipEl = null;


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


/* ---------- export / import ---------- */
function exportAll(){
  const payload = {
    version:2, exported:new Date().toISOString(),
    blockTypes: state.customTypes,
    notebooks: state.notebooks,
    boards: state.boards.map(b=>({
      id:b.id, name:b.name, description:b.description||"", notebookId:b.notebookId||null, order:b.order, pinned:!!b.pinned,
      nodes:(state.boardsData[b.id]||{}).nodes||[],
      connections:(state.boardsData[b.id]||{}).connections||[]
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
        if(!state.customTypes[id]){ state.customTypes[id] = payload.blockTypes[id]; added++; }
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
        state.notebooks.push({ id:nid, name:onb.name||"Imported notebook", collapsed:false });
      });
    } else {
      importNbId = "nb_"+uid().slice(0,8);
      state.notebooks.push({ id:importNbId, name:"Imported", collapsed:false });
    }
    incoming.forEach(b=>{
      const id = uid();
      const nbId = (b.notebookId && nbMap[b.notebookId]) ? nbMap[b.notebookId] : (importNbId || state.notebooks[state.notebooks.length-1].id);
      state.boards.push({id, name:(b.name||"Imported page"), description:b.description||"", notebookId:nbId, order:(typeof b.order==="number"?b.order:state.boards.length), pinned:!!b.pinned});
      state.boardsData[id] = { nodes:(b.nodes||[]).map(migrateNode), connections:b.connections||[] };
    });
    ensureNotebookStructure();
    renderBoardList();
    await persistIndex();
    for(const b of state.boards){ await persistBoard(b.id); }
    showToast("Imported");
  };
  reader.readAsText(file);
}

function blankTicket(){ return {no:"", link:"", assigned:"", customer:"", note:""}; }

/* ---------- custom block types ---------- */
/* Built-in editable types keep their data in top-level node props; custom
   fields live in node.fields. These accessors hide that difference so one
   render engine serves both. */
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
  const def = state.customTypes[node.type];
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
  const def = state.customTypes[node.type];
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
  const def = state.customTypes[node.type];
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
  const def = state.customTypes[node.type];
  if(!def) return;
  node.fields = node.fields || {};
  div.querySelectorAll("[data-fk]").forEach(fld=>{
    const key = fld.dataset.fk;
    fld.addEventListener("pointerdown", e=>e.stopPropagation());
    fld.addEventListener("focus", ()=>selectNode(node.id));
    if(fld.classList.contains("cf-rich")){
      fld.addEventListener("input", ()=>{ setFieldVal(node, key, fld.innerHTML); queueBoardSave(state.currentBoardId); });
      fld.addEventListener("blur", ()=>{ const c=sanitizeHtml(fld.innerHTML); fld.innerHTML=c; setFieldVal(node, key, c); queueBoardSave(state.currentBoardId); });
      fld.addEventListener("paste",(e)=>{
        const txt = e.clipboardData ? e.clipboardData.getData("text/plain") : "";
        if(txt){ e.preventDefault(); e.stopPropagation(); document.execCommand("insertText", false, txt); }
      });
    } else if(fld.type==="checkbox"){
      fld.addEventListener("change", ()=>{ setFieldVal(node, key, fld.checked); queueBoardSave(state.currentBoardId); });
    } else if(fld.tagName==="TEXTAREA"){
      fld.addEventListener("input", ()=>{
        setFieldVal(node, key, fld.value);
        fld.style.height="auto"; fld.style.height=fld.scrollHeight+"px";
        measureListOffsets(); updateConnectionsTouching(node.id);
        queueBoardSave(state.currentBoardId);
      });
    } else {
      fld.addEventListener("input", ()=>{
        setFieldVal(node, key, fld.value);
        const openBtn = div.querySelector('[data-open="'+key+'"]');
        if(openBtn) openBtn.classList.toggle("off", !fld.value);
        queueBoardSave(state.currentBoardId);
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
      if(rows && rows[ri]){ rows[ri][sk] = value; queueBoardSave(state.currentBoardId); }
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

export function migrateNode(n){
  if(n.type==="list" && !Array.isArray(n.items)){
    const lines = (n.body||"").split("\n").map(s=>s.trim()).filter(Boolean);
    n.items = lines.length ? lines : [""];
  }
  if(n.type==="list" && !n.items.length) n.items=[""];
  if(typeof n.collapsed !== "boolean") n.collapsed = false;
  if(n.bodyHtml === undefined) n.bodyHtml = plainToHtml(n.body||"");
  if(isCustomType(n.type) && !n.fields) n.fields = {};
  if(isCustomType(n.type)){
    const def = state.customTypes[n.type];
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
    if(state.backend==="folder"){
      const txt = await fsRead("block-types.json");
      if(txt) state.customTypes = JSON.parse(txt);
    } else if(state.backend==="app" && typeof window.storage!=="undefined" && window.storage){
      const res = await window.storage.get(TYPES_KEY, false);
      if(res && res.value) state.customTypes = JSON.parse(res.value);
    }
  }catch(err){ state.customTypes = state.customTypes || {}; }
  migrateLongtextKinds();
}

/* longtext and richtext were merged; normalize any stored 'longtext' kind to
   'richtext' so the designer dropdowns and renderers only deal with one kind.
   Values are compatible (richValue coerces old plain text into HTML). */
function migrateLongtextKinds(){
  let changed = false;
  Object.keys(state.customTypes).forEach(id=>{
    const t = state.customTypes[id];
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

/* ---------- view ---------- */
function applyTransform(){
  canvasInner.style.transform = "translate("+state.view.x+"px,"+state.view.y+"px) scale("+state.view.scale+")";
  el("zoomPct").textContent = Math.round(state.view.scale*100)+"%";
}
export function centerView(){
  const rect = viewport.getBoundingClientRect();
  state.view.scale = 1; state.view.x = rect.width/2-2100; state.view.y = rect.height/2-1500;
  applyTransform();
}
function zoomAt(clientX, clientY, factor){
  const rect = viewport.getBoundingClientRect();
  const mx=clientX-rect.left, my=clientY-rect.top;
  const cx=(mx-state.view.x)/state.view.scale, cy=(my-state.view.y)/state.view.scale;
  const ns = Math.min(2.2, Math.max(0.35, state.view.scale*factor));
  state.view.x = mx-cx*ns; state.view.y = my-cy*ns; state.view.scale = ns;
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
  return { x:(clientX-rect.left-state.view.x)/state.view.scale, y:(clientY-rect.top-state.view.y)/state.view.scale };
}
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

function startConnectDrag(fromId, fromItem, startX, startY){
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

/* ---------- nodes ---------- */
function createNode(type, cx, cy, opts){
  opts = opts || {};
  const def = state.customTypes[type];
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
  queueBoardSave(state.currentBoardId);
  if(!opts.silent) focusNodeTitle(node.id);
  return node;
}

function focusNodeTitle(id){
  const t = canvasInner.querySelector('.node[data-id="'+id+'"] .node-title');
  if(t){ t.focus(); if(t.select) t.select(); }
}

function spawnAtCursor(type){
  if(type==="image"){
    const c = {x:state.cursorCanvas.x, y:state.cursorCanvas.y};
    imgFileInput.onchange = (e)=>{
      const file = e.target.files[0];
      if(file) processImageFile(file,(dataUrl,w,h)=>{
        const node = createNode("image", c.x, c.y, {silent:true});
        node.image = dataUrl; node.w = Math.min(320,w); node.h = node.w*(h/w);
        renderBoard(); queueBoardSave(state.currentBoardId);
      });
      imgFileInput.value=""; imgFileInput.onchange=null;
    };
    imgFileInput.click();
    return null;
  }
  return createNode(type, state.cursorCanvas.x, state.cursorCanvas.y);
}

document.querySelectorAll(".add-btn[data-type]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const c = viewportCenterCanvasCoords();
    createNode(btn.dataset.type, c.x+(Math.random()*60-30), c.y+(Math.random()*60-30));
  });
});

function viewportCenterCanvasCoords(){
  const rect = viewport.getBoundingClientRect();
  return { x:(rect.width/2-state.view.x)/state.view.scale, y:(rect.height/2-state.view.y)/state.view.scale };
}

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
  state.selection.delete(id);
  renderBoard(); queueBoardSave(state.currentBoardId);
}
function deleteSelectedNodes(){
  const ids = new Set(state.selection);
  if(!ids.size) return;
  const data = getData();
  data.nodes = data.nodes.filter(n=>!ids.has(n.id));
  data.connections = data.connections.filter(c=>!ids.has(c.from) && !ids.has(c.to));
  state.selection.clear();
  renderBoard(); queueBoardSave(state.currentBoardId);
}
function duplicateNode(id){
  const n = findNode(id);
  if(!n) return;
  const copy = JSON.parse(JSON.stringify(n));
  copy.id = uid(); copy.x = n.x+24; copy.y = n.y+24;
  getData().nodes.push(copy);
  renderBoard(); queueBoardSave(state.currentBoardId);
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
    descendantsOf(id).forEach(d=>state.selection.delete(d));
  }
  renderBoard();
  queueBoardSave(state.currentBoardId);
}

/* ---------- undo / redo ----------
   Snapshot-based, one history per page. Changes made within ~450ms of each
   other collapse into a single step, so typing a word is one undo, not ten. */
let undoStacks = {}, redoStacks = {}, lastSnapshots = {};
let historyTimer = null;

function snapshot(){
  const d = getData();
  return JSON.stringify({nodes:d.nodes, connections:d.connections});
}
export function historyReset(boardId){
  undoStacks[boardId] = [];
  redoStacks[boardId] = [];
  lastSnapshots[boardId] = snapshot();
}
export function recordChange(){
  const boardId = state.currentBoardId;
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
  state.selection.clear();
  state.selectedConnId = null;
  renderBoard();
  persistBoard(state.currentBoardId);
}
function undo(){
  clearTimeout(historyTimer);
  const boardId = state.currentBoardId;
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
  const boardId = state.currentBoardId;
  const stack = redoStacks[boardId] || [];
  if(!stack.length){ showToast("Nothing to redo"); return; }
  (undoStacks[boardId] || (undoStacks[boardId]=[])).push(snapshot());
  const next = stack.pop();
  lastSnapshots[boardId] = next;
  restoreSnapshot(next);
  showToast("Redo");
}

function deselectAll(){
  state.selection.clear(); state.selectedConnId=null;
  canvasInner.querySelectorAll(".node.selected").forEach(n=>n.classList.remove("selected"));
  renderConnections();
}
function applySelectionClasses(){
  canvasInner.querySelectorAll(".node").forEach(n=>n.classList.toggle("selected", state.selection.has(n.dataset.id)));
}
function selectNode(id, additive){
  if(additive){
    if(state.selection.has(id)) state.selection.delete(id); else state.selection.add(id);
  } else {
    if(!state.selection.has(id)){ state.selection.clear(); state.selection.add(id); }
  }
  state.selectedConnId = null;
  applySelectionClasses();
  renderConnLabelsAndDelete();
}
function setSelection(ids){
  state.selection = new Set(ids);
  state.selectedConnId = null;
  applySelectionClasses();
  renderConnLabelsAndDelete();
}
function onlySelected(){
  return state.selection.size===1 ? findNode(state.selection.values().next().value) : null;
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
  const def = state.customTypes[node.type];
  const f = def ? def.fields.find(x=>x.key===fieldKey) : null;
  if(!f) return;
  if(!Array.isArray(node.fields[fieldKey])) node.fields[fieldKey] = [];
  const rows = node.fields[fieldKey];
  const at = (afterIdx===undefined||afterIdx===null) ? rows.length : afterIdx+1;
  shiftGroupConnections(node, fieldKey, at, +1);
  rows.splice(at, 0, blankGroupRow(f.subfields));
  renderBoard(); queueBoardSave(state.currentBoardId);
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
  renderBoard(); queueBoardSave(state.currentBoardId);
}
function addListItem(node, afterIdx){
  const at = (afterIdx===undefined || afterIdx===null) ? node.items.length : afterIdx+1;
  node.items.splice(at, 0, "");
  getData().connections.forEach(c=>{
    if(c.from===node.id && c.fromItem!==null && c.fromItem>=at) c.fromItem++;
    if(c.to===node.id && c.toItem!==null && c.toItem>=at) c.toItem++;
  });
  renderBoard(); queueBoardSave(state.currentBoardId);
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
  renderBoard(); queueBoardSave(state.currentBoardId);
  const f = canvasInner.querySelector('.node[data-id="'+node.id+'"] .ticket-row[data-idx="'+at+'"] .tr-no');
  if(f) f.focus();
}
function removeTicketRow(node, idx){
  if(node.tickets.length===1){ node.tickets[0]=blankTicket(); renderBoard(); queueBoardSave(state.currentBoardId); return; }
  node.tickets.splice(idx,1);
  const data = getData();
  data.connections = data.connections.filter(c=>
    !((c.from===node.id && c.fromItem===idx) || (c.to===node.id && c.toItem===idx)));
  data.connections.forEach(c=>{
    if(c.from===node.id && c.fromItem!==null && c.fromItem>idx) c.fromItem--;
    if(c.to===node.id && c.toItem!==null && c.toItem>idx) c.toItem--;
  });
  renderBoard(); queueBoardSave(state.currentBoardId);
}

function removeListItem(node, idx){
  if(node.items.length===1){ node.items[0]=""; renderBoard(); queueBoardSave(state.currentBoardId); return; }
  node.items.splice(idx,1);
  const data = getData();
  data.connections = data.connections.filter(c=>
    !((c.from===node.id && c.fromItem===idx) || (c.to===node.id && c.toItem===idx)));
  data.connections.forEach(c=>{
    if(c.from===node.id && c.fromItem!==null && c.fromItem>idx) c.fromItem--;
    if(c.to===node.id && c.toItem!==null && c.toItem>idx) c.toItem--;
  });
  renderBoard(); queueBoardSave(state.currentBoardId);
}

/* ---------- node element ---------- */
function nodeElement(node){
  const div = document.createElement("div");
  div.className = "node type-"+node.type + (state.selection.has(node.id)?" selected":"");
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

  const defForBar = state.customTypes[node.type];
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
    const ids = state.selection.has(node.id) && state.selection.size>1 ? [...state.selection] : [node.id];
    const moving = [];
    ids.forEach(id=>{
      const n = findNode(id);
      const nel = canvasInner.querySelector('.node[data-id="'+id+'"]');
      if(n && nel) moving.push({node:n, el:nel, ox:n.x, oy:n.y});
    });
    state.dragState = { mode:"drag", moving, startX:e.clientX, startY:e.clientY };
    div.setPointerCapture(e.pointerId);
    e.stopPropagation();
  });

  const titleInput = div.querySelector(".node-title");
  titleInput.addEventListener("pointerdown", e=>e.stopPropagation());
  titleInput.addEventListener("input", e=>{ node.title=e.target.value; queueBoardSave(state.currentBoardId); });
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
      queueBoardSave(state.currentBoardId);
    });
    rich.addEventListener("blur", ()=>{
      const clean = sanitizeHtml(rich.innerHTML);
      if(clean !== rich.innerHTML) rich.innerHTML = clean;
      node.bodyHtml = clean;
      node.body = richToText(clean);
      queueBoardSave(state.currentBoardId);
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
              const n = createNode("image", state.cursorCanvas.x, state.cursorCanvas.y, {silent:true});
              n.image = dataUrl; n.w = Math.min(320,w); n.h = n.w*(h/w);
              renderBoard(); queueBoardSave(state.currentBoardId);
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
      queueBoardSave(state.currentBoardId);
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
        queueBoardSave(state.currentBoardId);
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
      queueBoardSave(state.currentBoardId);
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
    wkLabel.addEventListener("input", e=>{ node.weekLabel = e.target.value; queueBoardSave(state.currentBoardId); });
  }

  // list rows
  div.querySelectorAll(".list-input").forEach(input=>{
    input.addEventListener("pointerdown", e=>e.stopPropagation());
    input.addEventListener("focus", ()=>selectNode(node.id));
    input.addEventListener("input",(e)=>{
      node.items[parseInt(e.target.dataset.idx,10)] = e.target.value;
      queueBoardSave(state.currentBoardId);
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
      const offs = state.itemOffsets[node.id] || [];
      const oy = offs[idx]!=null ? offs[idx] : node.h/2;
      startConnectDrag(node.id, idx, node.x+node.w, node.y+oy);
    });
  });

  div.querySelectorAll(".swatch").forEach(sw=>{
    sw.addEventListener("pointerdown", e=>e.stopPropagation());
    sw.addEventListener("click",()=>{
      const color = sw.dataset.color;
      const targets = state.selection.has(node.id) && state.selection.size>1 ? [...state.selection] : [node.id];
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
      queueBoardSave(state.currentBoardId);
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
          queueBoardSave(state.currentBoardId);
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
      state.dragState = { mode:"resize", node, el:div, startX:e.clientX, startY:e.clientY, ow:node.w, oh:node.h };
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
    const go = state.groupOffsets[node.id] || {};
    oy = go[itemIndex]!=null ? go[itemIndex] : node.h/2;
  } else {
    const offs = state.itemOffsets[node.id] || [];
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
  renderBoard(); queueBoardSave(state.currentBoardId);
}
function deleteConnection(id){
  getData().connections = getData().connections.filter(c=>c.id!==id);
  state.selectedConnId = null;
  renderBoard(); queueBoardSave(state.currentBoardId);
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
    vis.setAttribute("class","visible"+(state.selectedConnId===conn.id?" selected":""));
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
      state.selectedConnId = conn.id; state.selection.clear();
      canvasInner.querySelectorAll(".node.selected").forEach(n=>n.classList.remove("selected"));
      renderConnections();
    });
    hit.addEventListener("dblclick",(e)=>{
      e.stopPropagation();
      const label = prompt("Label for this connection:", conn.label||"");
      if(label!==null){ conn.label = label.trim(); renderConnections(); queueBoardSave(state.currentBoardId); }
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
    if(state.selectedConnId===conn.id){
      const b = document.createElement("button");
      b.className="conn-del"; b.style.left=mx+"px"; b.style.top=(my-18)+"px"; b.textContent="\u00d7";
      b.addEventListener("click",()=>deleteConnection(conn.id));
      canvasInner.appendChild(b);
    }
  });
}

/* ---------- render ---------- */
function measureListOffsets(){
  state.itemOffsets = {};
  state.groupOffsets = {};
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
        state.itemOffsets[node.id] = offs;
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
        state.groupOffsets[node.id] = go;
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

export function renderBoard(){
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


function fieldKindLabel(k){
  return {text:"Short text", longtext:"Rich text", richtext:"Rich text",
    link:"Link / URL", number:"Number", date:"Date", select:"Dropdown", checkbox:"Checkbox",
    group:"Repeating rows"}[k] || k;
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

