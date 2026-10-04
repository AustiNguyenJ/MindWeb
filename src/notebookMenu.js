import { el } from "./dom.js";
import { state } from "./state.js";
import { escapeHtml } from "./util.js";
import { closePageMenu } from "./pageMenu.js";
import {
  newBoard,
  newNotebook,
  startRenameNotebook,
  deleteNotebook,
} from "./sidebar.js";

/* The right-click menu on a notebook in the sidebar. Mirrors pageMenu.js. */

/* ---------- notebook context menu ---------- */
export function closeNotebookMenu(){
  const m = el("notebookMenu");
  if(m){ m.remove(); document.removeEventListener("pointerdown", notebookMenuOutside, true); }
}

export function notebookMenuOutside(e){
  const m = el("notebookMenu");
  if(m && !m.contains(e.target)) closeNotebookMenu();
}

export function openNotebookMenu(notebookId, x, y){
  closePageMenu();
  closeNotebookMenu();
  const nb = state.notebooks.find(n=>n.id===notebookId);
  if(!nb) return;
  const menu = document.createElement("div");
  menu.id = "notebookMenu"; menu.className = "page-menu";
  const items = [
    { act:"newPage", label:"New page here" },
    { act:"newSub",  label:"New sub-notebook here" },
    { act:"sep" },
    { act:"rename",  label:"Rename" },
    { act:"sep" },
    { act:"del",     label:"Delete notebook", danger:true }
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
      closeNotebookMenu();
      if(act==="newPage") newBoard(notebookId);
      else if(act==="newSub") newNotebook(notebookId);
      else if(act==="rename") startRenameNotebook(notebookId);
      else if(act==="del") deleteNotebook(notebookId);
    });
  });
  setTimeout(()=>document.addEventListener("pointerdown", notebookMenuOutside, true), 0);
}
