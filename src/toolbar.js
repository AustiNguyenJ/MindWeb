import { el, imgFileInput } from "./dom.js";
import { state } from "./state.js";
import { escapeHtml } from "./util.js";
import { createNode, processImageFile } from "./nodes.js";
import { viewportCenterCanvasCoords } from "./view.js";
import { renderBoard } from "./render.js";
import { queueBoardSave } from "./storage.js";
import { barBuiltinEntries, imageOnBar, imageHotkey } from "./toolbarConfig.js";

/* The block buttons across the top of the canvas.
 *
 * The built-in (non-image) buttons are rendered from the resolved
 * quick-access config rather than hardcoded in index.html, so a click
 * handler has to be (re)attached each render -- the same pattern
 * designer.js already uses for #customTypeBtns. The Image button stays the
 * one fixed element in #toolbar it always was (it needs a file picker, not
 * a plain createNode call); this module only toggles its visibility and key
 * label from config. */

export function renderQuickAccessToolbar(){
  const wrap = el("builtinToolbarBtns");
  if(wrap){
    wrap.innerHTML = barBuiltinEntries().map(e=>
      '<button class="add-btn" data-type="'+e.id+'">' +
        '<span class="swab" style="background:'+e.accent+'"></span>'+escapeHtml(e.name) +
        (e.hotkey ? '<span class="key">'+escapeHtml(e.hotkey.toUpperCase())+'</span>' : '') +
      '</button>'
    ).join('');
    wrap.querySelectorAll(".add-btn[data-type]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const c = viewportCenterCanvasCoords();
        createNode(btn.dataset.type, c.x+(Math.random()*60-30), c.y+(Math.random()*60-30));
      });
    });
  }

  const imgBtn = el("addImageBtn");
  if(imgBtn){
    imgBtn.style.display = imageOnBar() ? "" : "none";
    const key = imageHotkey();
    let keySpan = imgBtn.querySelector(".key");
    if(key){
      if(!keySpan){ keySpan = document.createElement("span"); keySpan.className="key"; imgBtn.appendChild(keySpan); }
      keySpan.textContent = key.toUpperCase();
    } else if(keySpan){
      keySpan.remove();
    }
  }
}

/* Wire the add-block buttons. */
export function initToolbar(){
  renderQuickAccessToolbar();

  el("addImageBtn").addEventListener("click", ()=>{
    imgFileInput.onchange = (e)=>{
      const file = e.target.files[0];
      if(file) processImageFile(file,(dataUrl,w,h)=>{
        const c = viewportCenterCanvasCoords();
        const node = createNode("image", c.x, c.y, {silent:true});
        node.image = dataUrl; node.w = Math.min(320,w); node.h = node.w*(h/w);
        renderBoard(); queueBoardSave(state.currentBoardId);
      });
      imgFileInput.value=""; imgFileInput.onchange=null;
    };
    imgFileInput.click();
  });
}
