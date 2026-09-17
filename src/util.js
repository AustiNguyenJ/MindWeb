import { RICH_OK_TAGS, RICH_DROP_TAGS } from "./constants.js";

/* Small, dependency-free helpers: ids, HTML escaping and sanitising, rich-text
   coercion, URL handling, and a couple of DOM predicates. Nothing here reads
   application state. */

export function uid(){ return Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4); }
export function sanitizeHtml(html){
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
export function plainToHtml(txt){
  if(!txt) return "";
  return txt.split("\n").map(l=>escapeHtml(l)).join("<br>");
}
export function richToText(html){
  const d = document.createElement("div");
  d.innerHTML = html || "";
  return (d.textContent||"").replace(/\s+/g," ").trim();
}
/* Coerce a stored field value into safe rich HTML. Values written by the old
   plain-text 'longtext' field have no markup, so we convert their newlines to
   <br>; values already containing HTML are just sanitized. */
export function richValue(val){
  if(!val) return "";
  const looksHtml = /<[a-z][\s\S]*>/i.test(val);
  return looksHtml ? sanitizeHtml(val) : plainToHtml(val);
}
export function normalizeUrl(u){
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
export function openLinkBackground(url){
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
export function currentWeekLabel(){
  const d = new Date();
  const day = (d.getDay()+6)%7;              // Monday = 0
  const mon = new Date(d); mon.setDate(d.getDate()-day);
  const sun = new Date(mon); sun.setDate(mon.getDate()+6);
  const f = (x)=>x.toLocaleDateString(undefined,{month:"short",day:"numeric"});
  return "Week of "+f(mon)+" \u2013 "+f(sun);
}

export function escapeHtml(s){ return (s||"").replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
export function escapeAttr(s){ return escapeHtml(s); }

export function looksRich(v){ return typeof v==="string" && /<[a-z][\s\S]*>/i.test(v); }

/* True when focus is anywhere the user is typing, so canvas shortcuts stay
   out of the way. Checks the property, the attribute, and any editable
   ancestor, since not every environment exposes all three. */
export function isTextEntry(node){
  if(!node) return false;
  const tag = node.tagName;
  if(tag==="INPUT" || tag==="TEXTAREA" || tag==="SELECT") return true;
  if(node.isContentEditable === true) return true;
  const attr = node.getAttribute && node.getAttribute("contenteditable");
  if(attr === "" || attr === "true") return true;
  if(node.closest && node.closest('[contenteditable="true"]')) return true;
  return false;
}
