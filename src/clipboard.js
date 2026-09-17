import { COPY_ICON } from "./constants.js";
import { showToast } from "./toast.js";

/* Copying to the clipboard, with a fallback for contexts where the async
   Clipboard API is unavailable or blocked, and the little copy button markup
   that goes with it. */

export function fallbackCopy(txt, done){
  const ta = document.createElement("textarea");
  ta.value = txt;
  ta.style.position="fixed"; ta.style.top="-2000px"; ta.style.opacity="0";
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  let ok=false;
  try{ ok = document.execCommand("copy"); }catch(e){ ok=false; }
  ta.remove();
  if(ok) done(); else showToast("Copy failed");
}
export function copyText(txt, btn){
  txt = (txt===undefined || txt===null) ? "" : String(txt);
  if(!txt.trim()){ showToast("Nothing to copy"); return; }
  const done = ()=>{
    if(btn){
      const prev = btn.textContent;
      btn.textContent = "\u2713";
      btn.classList.add("copied");
      setTimeout(()=>{ btn.textContent = prev; btn.classList.remove("copied"); }, 900);
    }
    showToast("Copied");
  };
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(done).catch(()=>fallbackCopy(txt, done));
  } else {
    fallbackCopy(txt, done);
  }
}
export function copyBtnHtml(extraClass, title){
  return '<button class="copy-btn '+(extraClass||"")+'" title="'+(title||"Copy")+'">'+COPY_ICON+'</button>';
}
