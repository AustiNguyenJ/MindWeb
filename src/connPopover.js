import { CONN_ROUTES, CONN_DASHES, CONN_COLORS, CONN_WIDTHS } from "./constants.js";
import { themedConnColor } from "./connStyle.js";

/* The two small pieces of UI that float over a selected connection: the style
 * popover and the inline label editor.
 *
 * Both are built here and handed back as detached elements; connections.js
 * decides when to show them and where, and owns what happens when they are
 * used. That keeps this module free of any import from connections.js.
 */

const icon = (path, extra)=>'<svg viewBox="0 0 20 14" aria-hidden="true"><path d="'+path+'"'+(extra||"")+'/></svg>';
const ICONS = {
  straight: icon("M3 11 L17 3"),
  elbow: icon("M3 11 H10 V3 H17"),
  curve: icon("M3 11 C10 11 10 3 17 3"),
  startArrow: icon("M5 7 H17 M9 3 L5 7 L9 11"),
  endArrow: icon("M3 7 H15 M11 3 L15 7 L11 11"),
  solid: icon("M3 7 H17"),
  dashed: icon("M2 7 H6 M8 7 H12 M14 7 H18"),
  dotted: icon("M3 7 H3.1 M7 7 H7.1 M11 7 H11.1 M15 7 H15.1", ' stroke-linecap="round" stroke-width="2.6"'),
  thin: icon("M3 7 H17", ' stroke-width="1"'),
  normal: icon("M3 7 H17", ' stroke-width="2"'),
  thick: icon("M3 7 H17", ' stroke-width="3.6"'),
};
const TITLES = {
  straight: "Straight line", elbow: "Elbow (right angles)", curve: "Curve",
  startArrow: "Arrowhead at the start", endArrow: "Arrowhead at the end",
  solid: "Solid", dashed: "Dashed", dotted: "Dotted",
  thin: "Thin", normal: "Normal", thick: "Thick",
};
const COLOR_NAMES = {
  "#9aa1ab": "Grey", "#374151": "Dark", "#4757d1": "Blue", "#d64545": "Red",
  "#2f9e5f": "Green", "#d98a00": "Amber", "#8b5cf6": "Purple",
};

/* `on` is true/false for a toggle or one-of-many control, and left undefined
   for a plain action button, which then carries no aria-pressed. */
const btn = (act, val, on, label, inner, cls)=>
  '<button type="button" class="'+(cls||"cp-btn")+(on ? " on" : "")+'" data-act="'+act+'"'+
  (val!==undefined ? ' data-val="'+val+'"' : "")+
  (on!==undefined ? ' aria-pressed="'+on+'"' : "")+
  ' title="'+label+'" aria-label="'+label+'">'+inner+'</button>';

const swatch = (c, on, dark)=>
  '<button type="button" class="cp-swatch'+(on ? " on" : "")+'" data-act="color" data-val="'+c+'" aria-pressed="'+on+'"'+
  ' style="background:'+themedConnColor(c, dark)+'" title="'+COLOR_NAMES[c]+'" aria-label="'+COLOR_NAMES[c]+'"></button>';

/* `style` is the resolved connStyleOf(); `actions.set(patch, control)` is
   called for every style choice, `actions.label()` and `actions.remove()` for
   the other two buttons. `dark` only affects how the colour swatches look. */
export function buildConnPopover(style, dark, actions){
  const pop = document.createElement("div");
  pop.className = "conn-pop";
  pop.setAttribute("role","toolbar");
  pop.setAttribute("aria-label","Connection style");

  const group = (html)=>'<span class="cp-group">'+html+'</span>';
  pop.innerHTML =
    group(CONN_ROUTES.map(r=>btn("route", r, style.route===r, TITLES[r], ICONS[r])).join("")) +
    group(btn("startArrow", undefined, style.startArrow, TITLES.startArrow, ICONS.startArrow) +
          btn("endArrow", undefined, style.endArrow, TITLES.endArrow, ICONS.endArrow)) +
    group(CONN_DASHES.map(d=>btn("dash", d, style.dash===d, TITLES[d], ICONS[d])).join("")) +
    group(Object.keys(CONN_WIDTHS).map(w=>btn("width", CONN_WIDTHS[w], Math.abs(style.width-CONN_WIDTHS[w])<0.01, TITLES[w], ICONS[w])).join("")) +
    group(CONN_COLORS.map(c=>swatch(c, style.color===c, dark)).join("")) +
    group(btn("label", undefined, undefined, "Edit label", "Label", "cp-btn cp-text") +
          btn("delete", undefined, undefined, "Delete connection", "&times;", "conn-del"));

  // pointerdown must not reach the canvas, or pressing a control would pan it
  pop.addEventListener("pointerdown", (e)=>e.stopPropagation());
  pop.addEventListener("click", (e)=>{
    const b = e.target.closest("button");
    if(!b) return;
    e.stopPropagation();
    const act = b.dataset.act, val = b.dataset.val;
    const control = { act, val };
    if(act==="route") actions.set({ route:val }, control);
    else if(act==="startArrow") actions.set({ startArrow:!style.startArrow }, control);
    else if(act==="endArrow") actions.set({ endArrow:!style.endArrow }, control);
    else if(act==="dash") actions.set({ dash:val }, control);
    else if(act==="width") actions.set({ width:Number(val) }, control);
    else if(act==="color") actions.set({ color:val }, control);
    else if(act==="label") actions.label();
    else if(act==="delete") actions.remove();
  });
  return pop;
}

/* The label editor: a text box standing where the label is. Enter and losing
   focus keep what was typed, Escape throws it away; `onDone` gets the text, or
   null for Escape, exactly once. Escape is stopped here so it closes only the
   editor and leaves the connection selected. */
export function buildLabelEditor(initial, onDone){
  const input = document.createElement("input");
  input.type = "text";
  input.className = "conn-label-edit";
  input.value = initial;
  input.placeholder = "Label";
  input.spellcheck = false;
  input.setAttribute("aria-label","Connection label");
  const fit = ()=>{ input.style.width = Math.max(90, input.value.length*7.5+26)+"px"; };
  fit();
  const finish = (value)=>{
    if(input._done) return;
    input._done = true;
    onDone(value);
  };
  input.addEventListener("input", fit);
  input.addEventListener("pointerdown", (e)=>e.stopPropagation());
  input.addEventListener("dblclick", (e)=>e.stopPropagation());
  input.addEventListener("keydown", (e)=>{
    if(e.key==="Enter" && !e.isComposing){ e.preventDefault(); e.stopPropagation(); finish(input.value); }
    else if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); finish(null); }
  });
  input.addEventListener("blur", ()=>finish(input.value));
  return input;
}
