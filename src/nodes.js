import { state } from "./state.js";
import { DEFAULT_SIZE } from "./constants.js";
import { uid, currentWeekLabel, plainToHtml } from "./util.js";
import { canvasInner, imgFileInput } from "./dom.js";
import { getData, findNode } from "./boards.js";
import { isCustomType } from "./blockTypes.js";
import { renderBoard } from "./app.js";
import { queueBoardSave } from "./storage.js";

/* Creating, copying and deleting blocks, and the per-type shape of a new one.
   migrateNode brings a stored block up to the current shape on load, which is
   what lets old saved pages keep working as block types gain fields. */

export function blankTicket(){ return {no:"", link:"", assigned:"", customer:"", note:""}; }

export function ticketSummary(t){
  const parts = [];
  if(t.no) parts.push(t.no);
  if(t.assigned) parts.push("Assigned: "+t.assigned);
  if(t.customer) parts.push("Customer: "+t.customer);
  if(t.link) parts.push(t.link);
  let out = parts.join("  |  ");
  if(t.note) out += (out?"\n":"")+t.note;
  return out;
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

/* ---------- nodes ---------- */
export function createNode(type, cx, cy, opts){
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

export function focusNodeTitle(id){
  const t = canvasInner.querySelector('.node[data-id="'+id+'"] .node-title');
  if(t){ t.focus(); if(t.select) t.select(); }
}

export function spawnAtCursor(type){
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

export function processImageFile(file, cb){
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

export function deleteNode(id){
  const data = getData();
  data.nodes = data.nodes.filter(n=>n.id!==id);
  data.connections = data.connections.filter(c=>c.from!==id && c.to!==id);
  state.selection.delete(id);
  renderBoard(); queueBoardSave(state.currentBoardId);
}

export function deleteSelectedNodes(){
  const ids = new Set(state.selection);
  if(!ids.size) return;
  const data = getData();
  data.nodes = data.nodes.filter(n=>!ids.has(n.id));
  data.connections = data.connections.filter(c=>!ids.has(c.from) && !ids.has(c.to));
  state.selection.clear();
  renderBoard(); queueBoardSave(state.currentBoardId);
}

export function duplicateNode(id){
  const n = findNode(id);
  if(!n) return;
  const copy = JSON.parse(JSON.stringify(n));
  copy.id = uid(); copy.x = n.x+24; copy.y = n.y+24;
  getData().nodes.push(copy);
  renderBoard(); queueBoardSave(state.currentBoardId);
}
