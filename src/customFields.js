import { state } from "./state.js";
import { COPY_ICON } from "./constants.js";
import {
  escapeHtml,
  escapeAttr,
  richValue,
  richToText,
  sanitizeHtml,
  openLinkBackground,
} from "./util.js";
import { copyText, copyBtnHtml } from "./clipboard.js";
import { fieldVal, setFieldVal } from "./blockTypes.js";
import {
  groupKey,
  groupRowHasConnection,
  addGroupRow,
  removeGroupRow,
} from "./rows.js";
import { selectNode } from "./selection.js";
import { updateConnectionsTouching } from "./connections.js";
import { queueBoardSave } from "./storage.js";
import { measureListOffsets } from "./render.js";
import { startConnectDrag } from "./canvas.js";

/* Rendering and wiring for schema-driven blocks.
 *
 * One renderer serves every type defined by a schema -- the editable
 * built-ins (note, question, ticket) and every user-defined ct_* type -- so
 * a field kind only has to be implemented once. Values are read and written
 * through fieldVal / setFieldVal, because built-in types keep theirs in
 * top-level node properties rather than in node.fields.
 */

export function subfieldInputHtml(sf, val, gkey, rowIdx){
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

export function groupFieldHtml(node, f){
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

export function customBodyHtml(node){
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

export function groupSummary(node, fieldKey){
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

export function customSummary(node){
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

export function wireCustomFields(div, node){
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
