import { el } from "./dom.js";
import { flushPendingSaves } from "./storage.js";
import { openAccountModal } from "./cloud.js";

/* The always-visible footer bar: a compact save/backend status plus a way
   into the Account & Storage modal. Its label text is kept current by
   updateStorageBar() (storage.js) -- this module only wires the two clicks. */

export function initFooterBar(){
  const bar = el("footerBar");
  if(!bar) return;
  bar.addEventListener("click", (e)=>{
    if(e.target.closest("#footerSaveBtn")) return;
    openAccountModal();
  });
  const saveBtn = el("footerSaveBtn");
  if(saveBtn) saveBtn.addEventListener("click", (e)=>{
    e.stopPropagation();
    flushPendingSaves();
  });
}
