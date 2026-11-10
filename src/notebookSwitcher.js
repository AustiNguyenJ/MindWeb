import { el } from "./dom.js";
import { state } from "./state.js";
import { escapeHtml, escapeAttr } from "./util.js";
import { boardsInNotebook, notebooksInParent, isNotebookDescendant } from "./boards.js";
import { closeNotebookMenu } from "./notebookMenu.js";
import { enableMenuKeys } from "./pageMenu.js";
import {
  getViewNotebookId,
  ancestorChain,
  viewNotebook,
  switchBoard,
  togglePin,
  newNotebook,
  pagesForAction,
  movePageTo,
  moveNotebookTo,
} from "./sidebar.js";

/* The notebook switcher and the "Move to..." picker.
 *
 * The switcher is a panel under the sidebar's notebook button listing every
 * notebook as an indented tree, with the favorites (pinned pages from every
 * notebook) folded in above it. Choosing a notebook changes which one the
 * sidebar shows; choosing a favorite opens that page. The "Move to..." picker
 * reuses the same tree so a page or notebook can be sent to a notebook that
 * isn't on screen. The panel is rendered with every list render (cheap, and it
 * keeps the favorites and counts current) and merely hidden while closed. */

export let favCollapsed = false;

/* ---------- the tree both popovers share ---------- */

/* opts.activeId marks one notebook as the current one; opts.disabled is a Set
   of ids that can't be chosen; opts.fk prefixes each row's focus key. */
function treeRowsHtml(parentId, depth, opts, counts){
  return notebooksInParent(parentId).map(nb=>{
    const dis = opts.disabled.has(nb.id);
    const cls = 'sw-nb'+(nb.id===opts.activeId?' active':'')+(dis?' disabled':'');
    return '<button type="button" class="'+cls+'" data-nb="'+escapeAttr(nb.id)+'" data-fk="'+opts.fk+escapeAttr(nb.id)+'" style="--depth:'+depth+'"'+
        (nb.id===opts.activeId?' aria-current="true"':'')+(dis?' disabled':'')+'>' +
      '<span class="nb-name">'+escapeHtml(nb.name||"Notebook")+'</span>' +
      '<span class="sw-count">'+(counts.get(nb.id)||0)+'</span>' +
    '</button>' + treeRowsHtml(nb.id, depth+1, opts, counts);
  }).join('');
}

function notebookTreeHtml(opts){
  const counts = new Map();
  state.boards.forEach(b=>counts.set(b.notebookId, (counts.get(b.notebookId)||0)+1));
  return treeRowsHtml(null, 0, opts, counts);
}

/* ---------- the switcher panel ---------- */
const panel = ()=>el("nbSwitchPanel");
export const isSwitcherOpen = ()=>!!panel() && !panel().hidden;

function switcherOutside(e){
  const p = panel();
  if(p && !p.contains(e.target) && !el("nbSwitchBtn").contains(e.target)) closeSwitcher();
}

export function closeSwitcher(returnFocus){
  const p = panel();
  if(!p || p.hidden) return;
  p.hidden = true;
  el("nbSwitchBtn").setAttribute("aria-expanded", "false");
  document.removeEventListener("pointerdown", switcherOutside, true);
  if(returnFocus) el("nbSwitchBtn").focus();
}

function openSwitcher(){
  panel().hidden = false;
  el("nbSwitchBtn").setAttribute("aria-expanded", "true");
  renderSwitcher();
  document.addEventListener("pointerdown", switcherOutside, true);
  const first = panel().querySelector(".sw-nb.active") || panel().querySelector(".fav-item,.sw-nb");
  if(first) first.focus();
}

function renderFavorites(){
  const wrap = el("favWrap");
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
    '<div class="fav-item '+(b.id===state.currentBoardId?"active":"")+'" tabindex="0" data-id="'+b.id+'" data-fk="fav:'+b.id+'">' +
      '<span class="fav-dot">★</span>' +
      '<span class="fav-name">'+escapeHtml(b.name||"Untitled")+'</span>' +
      (nb ? '<span class="fav-nb">'+escapeHtml(nb.name||"")+'</span>' : '') +
      '<button class="fav-unstar" data-id="'+b.id+'" data-fk="unstar:'+b.id+'" title="Remove from favorites">★</button>' +
    '</div>').join('');
}

/* Refresh the switcher button's label, the favorites and the notebook tree.
   Keyboard focus inside the panel survives the re-render (unstarring a
   favorite re-renders the panel it was clicked in). */
export function renderSwitcher(){
  const p = panel();
  if(!p) return;
  const prev = document.activeElement;
  const focusKey = (prev && prev.closest && prev.closest("#nbSwitchPanel")) ? prev.dataset.fk : null;

  const viewId = getViewNotebookId();
  const root = ancestorChain(viewId)[0];
  el("nbSwitchLabel").textContent = root ? (root.name||"Notebook") : "All notebooks";
  renderFavorites();
  el("swTree").innerHTML = notebookTreeHtml({ activeId:viewId, disabled:new Set(), fk:"sw:" });

  if(focusKey){
    const target = p.querySelector('[data-fk="'+focusKey+'"]') || p.querySelector(".sw-nb.active");
    if(target) target.focus();
  }
}

/* The Escape key, from keyboard.js: close whichever sidebar popover is open.
   Returns true if there was one, so Escape does nothing else that time. */
export function closeSidebarPopups(){
  let closed = false;
  if(isSwitcherOpen()){ closeSwitcher(true); closed = true; }
  if(el("moveToPicker")){ closeMoveToPicker(); closed = true; }
  if(el("notebookMenu")){ closeNotebookMenu(); closed = true; }
  return closed;
}

/* ---------- "Move to..." ---------- */
export function closeMoveToPicker(){
  const m = el("moveToPicker");
  if(m){ m.remove(); document.removeEventListener("pointerdown", moveToOutside, true); }
}

function moveToOutside(e){
  const m = el("moveToPicker");
  if(m && !m.contains(e.target)) closeMoveToPicker();
}

/* kind is "page" or "notebook". A page can go to any notebook but the one it
   is in (when several selected pages move together, any). A notebook can go
   to the top level or under any notebook except itself and its own
   descendants, which would cut that whole subtree off from the tree. */
export function openMoveToPicker(kind, id, x, y){
  closeMoveToPicker();
  closeNotebookMenu();
  let title, activeId = null, disabled = new Set(), topLevel = false;
  if(kind==="page"){
    const ids = pagesForAction(id);
    const b = state.boards.find(p=>p.id===id);
    if(!b) return;
    title = ids.length>1 ? "Move "+ids.length+" pages to…" : "Move page to…";
    if(ids.length===1){ activeId = b.notebookId; disabled.add(b.notebookId); }
  } else {
    const nb = state.notebooks.find(n=>n.id===id);
    if(!nb) return;
    title = "Move notebook to…";
    topLevel = true;
    activeId = nb.parentId || null;
    state.notebooks.forEach(n=>{ if(isNotebookDescendant(id, n.id)) disabled.add(n.id); });
    if(nb.parentId) disabled.add(nb.parentId);
  }
  const menu = document.createElement("div");
  menu.id = "moveToPicker"; menu.className = "page-menu move-picker";
  menu.setAttribute("role", "dialog"); menu.setAttribute("aria-label", title);
  menu.innerHTML = '<div class="mp-title">'+escapeHtml(title)+'</div>' +
    (topLevel ? '<button type="button" class="sw-nb sw-top'+(activeId===null?' active':'')+'" data-nb="" data-fk="mt:top"'+(activeId===null?' disabled':'')+'><span class="sw-label-text">Top level</span></button>' : '') +
    notebookTreeHtml({ activeId, disabled, fk:"mt:" });
  document.body.appendChild(menu);
  // position, clamped to viewport
  const mw = 240, mh = menu.offsetHeight || 260;
  let left = x, top = y+4;
  if(left+mw > window.innerWidth-8) left = window.innerWidth-mw-8;
  if(top+mh > window.innerHeight-8) top = Math.max(8, y-mh-4);
  menu.style.left = left+"px"; menu.style.top = top+"px";

  menu.querySelectorAll(".sw-nb").forEach(btn=>{
    btn.addEventListener("click",()=>{
      closeMoveToPicker();
      if(kind==="page") movePageTo(id, btn.dataset.nb);
      else moveNotebookTo(id, btn.dataset.nb || null);
    });
  });
  enableMenuKeys(menu, ".sw-nb:not(:disabled)");
  setTimeout(()=>document.addEventListener("pointerdown", moveToOutside, true), 0);
}

/* Wire the switcher button, its panel and the favorites inside it. */
export function initSwitcher(){
  el("nbSwitchBtn").addEventListener("click", ()=>{ if(isSwitcherOpen()) closeSwitcher(); else openSwitcher(); });

  el("swTree").addEventListener("click",(e)=>{
    const row = e.target.closest(".sw-nb");
    if(!row || row.disabled) return;
    closeSwitcher(true);
    viewNotebook(row.dataset.nb);
  });
  el("swNewTopBtn").addEventListener("click",()=>{ closeSwitcher(); newNotebook(null); });

  // favorites: a click opens the page and shows its notebook; the star unpins
  const openFavorite = (id)=>{
    const b = state.boards.find(x=>x.id===id);
    if(!b) return;
    closeSwitcher(true);
    viewNotebook(b.notebookId);
    switchBoard(id);
  };
  el("favList").addEventListener("click",(e)=>{
    const star = e.target.closest(".fav-unstar");
    if(star){ e.stopPropagation(); togglePin(star.dataset.id); return; }
    const item = e.target.closest(".fav-item");
    if(item) openFavorite(item.dataset.id);
  });
  el("favList").addEventListener("keydown",(e)=>{
    const item = e.target.closest(".fav-item");
    if(item && e.target===item && (e.key==="Enter" || e.key===" ")){ e.preventDefault(); openFavorite(item.dataset.id); }
  });
  const toggleFavorites = ()=>{
    favCollapsed = !favCollapsed;
    el("favWrap").classList.toggle("collapsed", favCollapsed);
  };
  el("favHead").addEventListener("click", toggleFavorites);
  el("favHead").addEventListener("keydown",(e)=>{
    if(e.target===e.currentTarget && (e.key==="Enter" || e.key===" ")){ e.preventDefault(); toggleFavorites(); }
  });

  // tabbing out of the panel closes it (a destroyed-by-rerender focus has no
  // relatedTarget, so that case leaves it open)
  panel().addEventListener("focusout",(e)=>{
    const to = e.relatedTarget;
    if(to && !panel().contains(to) && !el("nbSwitchBtn").contains(to)) closeSwitcher();
  });

  // Up/Down walk the panel's entries
  panel().addEventListener("keydown",(e)=>{
    if(e.key!=="ArrowDown" && e.key!=="ArrowUp") return;
    const items = [...panel().querySelectorAll(".fav-item,.sw-nb,.sw-new-top")]
      .filter(x=>!x.disabled && !x.closest("#favWrap.collapsed"));
    if(!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement);
    const next = e.key==="ArrowDown" ? (i+1)%items.length : (i-1+items.length)%items.length;
    items[next].focus();
  });
}
