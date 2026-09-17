import { el, imgFileInput } from "./dom.js";
import { state } from "./state.js";
import { createNode, processImageFile } from "./nodes.js";
import { viewportCenterCanvasCoords } from "./view.js";
import { renderBoard } from "./render.js";
import { queueBoardSave } from "./storage.js";

/* The block buttons across the top of the canvas. */

/* Wire the add-block buttons. */
export function initToolbar(){
  document.querySelectorAll(".add-btn[data-type]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const c = viewportCenterCanvasCoords();
      createNode(btn.dataset.type, c.x+(Math.random()*60-30), c.y+(Math.random()*60-30));
    });
  });


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
