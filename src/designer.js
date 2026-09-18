import { el } from "./dom.js";
import { state } from "./state.js";
import { escapeHtml, escapeAttr, uid } from "./util.js";
import { showToast } from "./toast.js";
import { TYPE_ACCENTS, FIELD_KINDS, SUBFIELD_KINDS, PROTECTED_BUILTINS } from "./constants.js";
import { getData } from "./boards.js";
import { blankField, blankGroupRow, fieldKindLabel } from "./blockTypes.js";
import { customBodyHtml } from "./customFields.js";
import { createNode } from "./nodes.js";
import { viewportCenterCanvasCoords } from "./view.js";
import { renderBoard } from "./render.js";
import { queueTypesSave } from "./storage.js";
import { confirmModal } from "./confirmModal.js";

/* The Block Designer: define a block type as a list of fields, with a live
   preview. The editable built-ins appear here alongside user-defined types,
   since they share the same schema shape; list, week, header and image have
   special behaviour and are shown locked. */

/* ---------- block designer ---------- */
export let bdEditingId = null;

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

export function openDesigner(){
  el("bdOverlay").classList.add("open");
  renderTypeList();
  const ids = Object.keys(state.customTypes);
  if(ids.length) editType(ids[0]); else { bdEditingId=null; renderEditor(); }
}

export function closeDesigner(){
  el("bdOverlay").classList.remove("open");
  renderTypeToolbar();
  renderBoard();
}

export function renderTypeList(){
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

export function typeBtnHtml(id){
  const t = state.customTypes[id];
  const canDelete = !t.builtin;
  return '<button class="bd-typebtn '+(id===bdEditingId?"active":"")+'" data-id="'+id+'">' +
    '<span class="sw" style="background:'+(t.accent||"#ddd")+'"></span>' +
    '<span>'+escapeHtml(t.name||"Untitled")+'</span>' +
    (canDelete ? '<span class="del" data-del="'+id+'" title="Delete type">&times;</span>' : '<span style="font-size:10px;color:var(--muted-2)">built-in</span>') +
    '</button>';
}

export function newType(){
  const id = "ct_"+uid().slice(0,8);
  state.customTypes[id] = { id, name:"New block", accent:"#bfdbfe", width:240,
    fields:[ {key:uid().slice(0,6), label:"Detail", kind:"text", placeholder:"", options:""} ] };
  bdEditingId = id;
  queueTypesSave();
  renderTypeList();
  renderEditor();
}

export async function deleteType(id){
  if(state.customTypes[id] && state.customTypes[id].builtin){ showToast("Built-in blocks can't be deleted"); return; }
  const inUse = getData().nodes.some(n=>n.type===id) ||
    state.boards.some(b=>(state.boardsData[b.id]||{nodes:[]}).nodes.some(n=>n.type===id));
  const msg = inUse
    ? "Blocks already placed with it will keep their data but show as plain. This can't be undone."
    : "This can't be undone.";
  const ok = await confirmModal({ title:"Delete this block type?", message:msg });
  if(!ok) return;
  delete state.customTypes[id];
  if(bdEditingId===id) bdEditingId = Object.keys(state.customTypes)[0] || null;
  queueTypesSave();
  renderTypeList();
  renderEditor();
}

export function duplicateType(){
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

export function editType(id){ bdEditingId = id; renderTypeList(); renderEditor(); }

export function renderEditor(){
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

export function renderFields(){
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

export function renderPreview(){
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

/* Wire the designer's toolbar button and modal chrome. */
export function initDesigner(){
  el("designBlocksBtn").addEventListener("click", openDesigner);
  el("bdClose").addEventListener("click", closeDesigner);
  el("bdDone").addEventListener("click", closeDesigner);
  el("bdNewType").addEventListener("click", newType);
  el("bdDuplicate").addEventListener("click", duplicateType);
  el("bdOverlay").addEventListener("click",(e)=>{ if(e.target===el("bdOverlay")) closeDesigner(); });
}
