import { el, imgFileInput } from "./dom.js";
import { state } from "./state.js";
import { escapeHtml } from "./util.js";
import { createNode, processImageFile } from "./nodes.js";
import { viewportCenterCanvasCoords } from "./view.js";
import { renderBoard } from "./render.js";
import { queueBoardSave } from "./storage.js";
import { TOOLBAR_SECTIONS, TOOLBAR_SECTIONS_KEY } from "./constants.js";
import { barBuiltinEntries, barShapeEntries, imageOnBar, imageHotkey } from "./toolbarConfig.js";

/* The block buttons across the top of the canvas, grouped into collapsible
 * sections (Blocks, Shapes). Which sections are folded is remembered per
 * viewer in localStorage; without storage everything simply renders open.
 *
 * The built-in (non-image) buttons are rendered from the resolved
 * quick-access config rather than hardcoded in index.html, so a click
 * handler has to be (re)attached each render -- the same pattern
 * designer.js already uses for #customTypeBtns. The Image button stays the
 * one fixed element in #toolbar it always was (it needs a file picker, not
 * a plain createNode call); this module only toggles its visibility and key
 * label from config. */

/* Outline glyphs for the Shapes buttons, drawn on a 24x24 grid. */
const SHAPE_ICONS = {
  shape_rect:          '<rect x="3" y="6" width="18" height="12" rx="1"/>',
  shape_rounded:       '<rect x="3" y="6" width="18" height="12" rx="5"/>',
  shape_ellipse:       '<ellipse cx="12" cy="12" rx="9" ry="6"/>',
  shape_diamond:       '<polygon points="12,3 21,12 12,21 3,12"/>',
  shape_parallelogram: '<polygon points="7,6 21,6 17,18 3,18"/>',
  shape_terminator:    '<rect x="2" y="7" width="20" height="10" rx="5"/>',
  label:               '<path d="M6 7h12M12 7v11"/>',
};

function barButtonHtml(e){
  const glyph = SHAPE_ICONS[e.id];
  const icon = glyph
    ? '<svg class="shape-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">'+glyph+'</svg>'
    : '<span class="swab" style="background:'+e.accent+'"></span>';
  return '<button class="add-btn" data-type="'+e.id+'">' + icon + escapeHtml(e.name) +
    (e.hotkey ? '<span class="key">'+escapeHtml(e.hotkey.toUpperCase())+'</span>' : '') +
    '</button>';
}

function fillBarSection(wrap, entries){
  wrap.innerHTML = entries.map(barButtonHtml).join('');
  wrap.querySelectorAll(".add-btn[data-type]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const c = viewportCenterCanvasCoords();
      createNode(btn.dataset.type, c.x+(Math.random()*60-30), c.y+(Math.random()*60-30));
    });
  });
}

/* Folded state survives only if localStorage works; the in-memory copy keeps
   the toggle usable for the session when it doesn't. */
let sessionCollapsed = null;

function readCollapsed(){
  if(sessionCollapsed) return sessionCollapsed;
  try{
    const v = JSON.parse(localStorage.getItem(TOOLBAR_SECTIONS_KEY) || "{}");
    return (v && typeof v==="object") ? v : {};
  }catch(err){ return {}; }
}

function writeCollapsed(map){
  sessionCollapsed = map;
  try{ localStorage.setItem(TOOLBAR_SECTIONS_KEY, JSON.stringify(map)); }catch(err){}
}

function applyCollapsed(){
  const collapsed = readCollapsed();
  TOOLBAR_SECTIONS.forEach(s=>{
    const sec = document.querySelector('.tb-section[data-section="'+s.id+'"]');
    if(!sec) return;
    const folded = collapsed[s.id]===true;
    sec.classList.toggle("collapsed", folded);
    const head = sec.querySelector(".tb-sec-head");
    if(head) head.setAttribute("aria-expanded", folded ? "false" : "true");
  });
}

export function renderQuickAccessToolbar(){
  const wrap = el("builtinToolbarBtns");
  if(wrap) fillBarSection(wrap, barBuiltinEntries());

  const shapeWrap = el("shapeToolbarBtns");
  if(shapeWrap){
    const entries = barShapeEntries();
    fillBarSection(shapeWrap, entries);
    // nothing of this section on the bar: drop the whole group, header and all
    const sec = shapeWrap.closest(".tb-section");
    if(sec) sec.style.display = entries.length ? "" : "none";
  }
  applyCollapsed();

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

  document.querySelectorAll(".tb-sec-head").forEach(head=>{
    head.addEventListener("click", ()=>{
      const id = head.closest(".tb-section").dataset.section;
      const collapsed = readCollapsed();
      collapsed[id] = !(collapsed[id]===true);
      writeCollapsed(collapsed);
      applyCollapsed();
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
