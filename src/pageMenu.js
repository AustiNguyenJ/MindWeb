import { el } from "./dom.js";
import { state } from "./state.js";
import { escapeHtml } from "./util.js";
import {
  treeEl,
  togglePin,
  startRenameBoard,
  switchBoard,
  deleteBoard,
  duplicatePage,
} from "./sidebar.js";

/* The right-click / overflow menu on a page in the sidebar. */

/* ---------- page context menu ---------- */
export function closePageMenu(){
  const m = el("pageMenu");
  if(m){ m.remove(); document.removeEventListener("pointerdown", pageMenuOutside, true); }
}

export function pageMenuOutside(e){
  const m = el("pageMenu");
  if(m && !m.contains(e.target)) closePageMenu();
}

export function openPageMenu(pageId, x, y){
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
