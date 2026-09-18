import { el } from "./dom.js";

/* A small in-app substitute for window.confirm(), used anywhere the app
   asks before a destructive action (deleting a page, a notebook, a block
   type). Native confirm() blocks the whole tab and looks like a browser
   chrome dialog rather than part of the app -- this is styled the same as
   every other modal here (block designer, account settings). */

let resolveCurrent = null;

/** Show the modal and resolve true/false with what the person picked. Only
 *  one can be open at a time; opening a second one while the first is still
 *  up resolves the first as cancelled. */
export function confirmModal({ title = "Are you sure?", message = "", confirmLabel = "Delete", danger = true } = {}){
  if(resolveCurrent) finish(false);
  return new Promise((resolve)=>{
    resolveCurrent = resolve;
    el("confirmTitle").textContent = title;
    el("confirmMessage").textContent = message;
    const okBtn = el("confirmOkBtn");
    okBtn.textContent = confirmLabel;
    okBtn.className = "bd-btn"+(danger ? " danger" : " primary");
    el("confirmOverlay").classList.add("open");
    el("confirmCancelBtn").focus();
  });
}

function finish(result){
  el("confirmOverlay").classList.remove("open");
  if(resolveCurrent){ const r = resolveCurrent; resolveCurrent = null; r(result); }
}

/** Cancel whatever's open, as if Cancel had been clicked. Called from
 *  keyboard.js's Escape handling, alongside the other overlays. */
export function cancelConfirmModal(){ finish(false); }

export function initConfirmModal(){
  el("confirmCancelBtn").addEventListener("click", ()=>finish(false));
  el("confirmOkBtn").addEventListener("click", ()=>finish(true));
  el("confirmClose").addEventListener("click", ()=>finish(false));
  el("confirmOverlay").addEventListener("click", (e)=>{ if(e.target===el("confirmOverlay")) finish(false); });
}
