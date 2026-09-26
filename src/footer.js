import { el } from "./dom.js";
import { flushPendingSaves } from "./storage.js";
import { openAccountModal } from "./cloud.js";

/* The "Account & Storage" entry point lives top-right of the page header
   (headerAccountBtn, in index.html's #boardHeader) -- the conventional spot
   for account/settings access. The footer bar below it is just a compact
   save/backend status plus a manual save button; its text is kept current
   by updateStorageBar() (storage.js). This module wires both buttons' clicks. */

export function initFooterBar(){
  const acctBtn = el("headerAccountBtn");
  if(acctBtn) acctBtn.addEventListener("click", openAccountModal);
  const saveBtn = el("footerSaveBtn");
  if(saveBtn) saveBtn.addEventListener("click", flushPendingSaves);
}
