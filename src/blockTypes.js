import { state } from "./state.js";
import { uid, looksRich } from "./util.js";
import { EDITABLE_BUILTINS, TYPES_KEY, BUILTIN_KEYS } from "./constants.js";
import { showToast } from "./toast.js";
import { queueTypesSave } from "./storage.js";

/* The block-type library.
 *
 * A block type is a schema: an ordered list of fields plus a default width
 * and accent. User-defined types (ct_*) and the editable built-ins (note,
 * question, ticket) share the same shape, which is why one renderer serves
 * both. The remaining built-ins -- list, week, header, image -- have special
 * behaviour and stay hardcoded.
 *
 * Built-in types keep their values in top-level node properties rather than
 * in node.fields; fieldVal / setFieldVal hide that difference. Anything that
 * reads block content must go through them, or it silently misses every
 * built-in field.
 */

export function blankField(){
  return { key:uid().slice(0,6), label:"Field", kind:"text", placeholder:"", options:"", subfields:[], layout:"rows" };
}

export function blankSubfield(){
  return { key:uid().slice(0,6), label:"Step", kind:"text", placeholder:"" };
}

export function blankGroupRow(subfields){
  const row = {};
  (subfields||[]).forEach(sf=>{ row[sf.key] = ""; });
  return row;
}

export function isCustomType(t){ return !!state.customTypes[t]; }

export function seedBuiltinTypes(){
  Object.keys(EDITABLE_BUILTINS).forEach(id=>{
    if(!state.customTypes[id]){
      state.customTypes[id] = JSON.parse(JSON.stringify(EDITABLE_BUILTINS[id]));
    } else {
      state.customTypes[id].builtin = true;   // keep the flag even if loaded from storage
    }
  });
}

export function reconstructMissingTypes(){
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
export function spawnableTypes(){
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

/* Built-in editable types keep their data in top-level node props; custom
   fields live in node.fields. These accessors hide that difference so one
   render engine serves both. */
export function fieldVal(node, key){
  if(BUILTIN_KEYS[key] && node[key]!==undefined) return node[key];
  return node.fields ? node.fields[key] : undefined;
}

export function setFieldVal(node, key, val){
  if(BUILTIN_KEYS[key]){ node[key] = val; }
  else { node.fields = node.fields || {}; node.fields[key] = val; }
}

export function fieldKindLabel(k){
  return {text:"Short text", longtext:"Rich text", richtext:"Rich text",
    link:"Link / URL", number:"Number", date:"Date", select:"Dropdown", checkbox:"Checkbox",
    group:"Repeating rows"}[k] || k;
}

export async function loadCustomTypes(){
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
export function migrateLongtextKinds(){
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
