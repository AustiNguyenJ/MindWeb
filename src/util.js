import { RICH_OK_TAGS, RICH_DROP_TAGS, RICH_STYLE_PROPS, FONT_SIZES, HIGHLIGHT_COLOR, COLOR_DARK_MAP } from "./constants.js";

/* Small, dependency-free helpers: ids, HTML escaping and sanitising, rich-text
   coercion, URL handling, and a couple of DOM predicates. Nothing here reads
   application state. */

export function uid(){ return Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4); }

/* A node's fill colour is a stored light hex (or unset, meaning the default
   surface). Swap it for its dark-mode counterpart when the theme is dark, so
   node text -- which follows --ink -- stays readable against it. */
export function themedNodeColor(hex){
  if(!hex) return "var(--surface)";
  if(document.documentElement.getAttribute("data-theme")!=="dark") return hex;
  return COLOR_DARK_MAP[hex.toLowerCase()] || hex;
}
/* Keep only the declarations RICH_STYLE_PROPS allows (font size, highlight,
   text color), each matching its own value shape -- the mechanism that lets
   font-size/highlight-color buttons write a style attribute that survives
   sanitizing instead of being stripped like any other inline style. */
function sanitizeStyleAttr(value){
  return (value||"").split(";")
    .map(decl=>{
      const i = decl.indexOf(":");
      if(i===-1) return null;
      const prop = decl.slice(0,i).trim().toLowerCase();
      const val = decl.slice(i+1).trim().toLowerCase();
      const re = RICH_STYLE_PROPS[prop];
      return (re && re.test(val)) ? prop+":"+val : null;
    })
    .filter(Boolean).join(";");
}
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
      if(node.tagName==="SPAN" && n==="style"){
        const safe = sanitizeStyleAttr(attr.value);
        if(safe) node.setAttribute("style", safe); else node.removeAttribute("style");
        return;
      }
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
function stripStyleProp(root, prop){
  if(root.nodeType===1 && root.style && root.style.getPropertyValue(prop)){
    root.style.removeProperty(prop);
    if(!root.getAttribute("style")) root.removeAttribute("style");
  }
  root.childNodes.forEach(c=>stripStyleProp(c, prop));
}
/* Drop any <span> left with no attributes at all -- stripStyleProp()
   un-sets the one property it was carrying, which otherwise leaves a
   pointless empty wrapper behind every time a highlight or font size is
   cleared. */
function unwrapBareSpans(root){
  const spans = root.querySelectorAll ? [...root.querySelectorAll("span")] : [];
  if(root.nodeType===1 && root.tagName==="SPAN") spans.push(root);
  spans.forEach(span=>{
    if(span.attributes.length===0){
      const parent = span.parentNode;
      while(span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
    }
  });
}
function reselectNodes(sel, nodes){
  if(!nodes.length) return;
  const r = document.createRange();
  r.setStartBefore(nodes[0]);
  r.setEndAfter(nodes[nodes.length-1]);
  sel.removeAllRanges();
  sel.addRange(r);
}
/* Apply (or, when value is falsy, clear) one inline style property across the
   current selection inside `target`. This is how the font-size and highlight
   controls work -- execCommand has no reliable cross-browser command for
   either, so they wrap/unwrap a <span style="..."> by hand. Any pre-existing
   value for the same property is stripped from the selected content first,
   since a nested element's inline style would otherwise keep winning the CSS
   cascade over whatever we just wrapped it in. */
export function applyInlineStyleToSelection(target, prop, value){
  const sel = window.getSelection();
  if(!sel || sel.rangeCount===0 || sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  if(!target.contains(range.commonAncestorContainer)) return false;
  const frag = range.extractContents();
  stripStyleProp(frag, prop);
  unwrapBareSpans(frag);
  let inserted;
  if(value){
    const span = document.createElement("span");
    span.style.setProperty(prop, value);
    span.appendChild(frag);
    range.insertNode(span);
    inserted = [span];
  } else {
    inserted = [...frag.childNodes];
    range.insertNode(frag);
  }
  reselectNodes(sel, inserted);
  return true;
}
/* True if background-color is already set somewhere up the selection's
   ancestor chain -- used so a repeat Highlight press (or shortcut) turns the
   highlight back off instead of only ever adding more of it. A heuristic for
   a partially-highlighted selection, same tradeoff execCommand's own toggle
   commands make. */
function selectionHasProp(range, target, prop){
  let cur = range.commonAncestorContainer;
  if(cur.nodeType!==1) cur = cur.parentElement;
  while(cur && cur!==target.parentElement){
    if(cur.style && cur.style.getPropertyValue(prop)) return true;
    cur = cur.parentElement;
  }
  return false;
}
export function toggleHighlight(target, color){
  const sel = window.getSelection();
  if(!sel || sel.rangeCount===0 || sel.isCollapsed) return false;
  const on = selectionHasProp(sel.getRangeAt(0), target, "background-color");
  return applyInlineStyleToSelection(target, "background-color", on ? null : color);
}
/* Step the selection's font size up/down through FONT_SIZES. With nothing
   explicitly set yet, 13 (the app's base text size) is the implicit current
   step, so the first press moves to its neighbour rather than jumping from
   an unknown baseline. Landing back on 13 clears the override instead of
   writing a redundant "font-size:13px". */
export function stepFontSize(target, delta){
  const sel = window.getSelection();
  if(!sel || sel.rangeCount===0 || sel.isCollapsed) return false;
  let node = sel.anchorNode;
  let curPx = null;
  while(node && node!==target.parentElement){
    if(node.nodeType===1 && node.style && node.style.fontSize){ curPx = parseInt(node.style.fontSize,10); break; }
    node = node.parentNode;
  }
  const base = curPx==null ? 13 : curPx;
  let idx = FONT_SIZES.indexOf(base);
  if(idx===-1) idx = FONT_SIZES.reduce((best,px,i)=>Math.abs(px-base)<Math.abs(FONT_SIZES[best]-base)?i:best, 0);
  idx = Math.max(0, Math.min(FONT_SIZES.length-1, idx+delta));
  const next = FONT_SIZES[idx];
  return applyInlineStyleToSelection(target, "font-size", next===13 ? null : next+"px");
}
/* Keyboard shortcuts for rich-text formatting. Bold/italic/underline are
   handled explicitly here rather than left to the browser's own default
   action: that default isn't trustworthy across browsers (Firefox rebinds
   plain Ctrl/Cmd+B to toggling its Bookmarks sidebar at the chrome level
   instead of bolding text), so we preventDefault() and run execCommand
   ourselves, same as the no-native-binding shortcuts below. Pure key-combo
   matching, no DOM access, so it's cheap to call from every keydown handler
   regardless of which rich area is focused. */
export function richShortcutCommand(e){
  if(!(e.ctrlKey||e.metaKey)) return null;
  const k = e.key.toLowerCase();
  if(!e.shiftKey){
    if(k==="b") return "bold";
    if(k==="i") return "italic";
    if(k==="u") return "underline";
    return null;
  }
  if(k==="x") return "strikeThrough";
  if(k==="h") return "highlightToggle";
  if(k==="]" || k==="}") return "fontSizeUp";
  if(k==="[" || k==="{") return "fontSizeDown";
  return null;
}
/* Run a richShortcutCommand() against `target`, sanitize the result, and
   hand the clean HTML to `commit` -- the one piece that differs between a
   node's own body, a custom field, and a repeating-group subfield. Returns
   whether a shortcut matched, so the caller only preventDefault()s and keeps
   the browser's native undo shortcut working. */
export function handleRichShortcut(e, target, commit){
  const cmd = richShortcutCommand(e);
  if(!cmd) return false;
  e.preventDefault();
  if(cmd==="strikeThrough" || cmd==="bold" || cmd==="italic" || cmd==="underline"){
    target.focus();
    try{ document.execCommand("styleWithCSS", false, false); }catch(err){}
    document.execCommand(cmd, false, null);
    // execCommand is the browser's own doing, so re-sanitize its output --
    // but only reassign innerHTML if that actually changed anything, or the
    // reassignment collapses the very selection the user is about to apply
    // a second shortcut to.
    const clean = sanitizeHtml(target.innerHTML);
    if(clean !== target.innerHTML) target.innerHTML = clean;
    commit(clean);
  } else {
    // highlight/font-size only ever wrap/unwrap a <span style="..."> whose
    // one property comes from HIGHLIGHT_COLOR or FONT_SIZES -- never from
    // user input -- so there's nothing here for sanitizeHtml to catch, and
    // running it anyway would reassign innerHTML on every press (its output
    // never textually matches the DOM's own CSSOM style serialization) and
    // collapse the selection the same way the execCommand branch above
    // guards against.
    if(cmd==="highlightToggle") toggleHighlight(target, HIGHLIGHT_COLOR);
    else if(cmd==="fontSizeUp") stepFontSize(target, 1);
    else if(cmd==="fontSizeDown") stepFontSize(target, -1);
    commit(target.innerHTML);
  }
  return true;
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
