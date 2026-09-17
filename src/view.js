import { state } from "./state.js";
import { el, viewport, canvasInner } from "./dom.js";

/* The canvas viewport: pan offset and zoom, and the conversions between
   screen coordinates and canvas coordinates that everything else relies on. */

/* ---------- view ---------- */
export function applyTransform(){
  canvasInner.style.transform = "translate("+state.view.x+"px,"+state.view.y+"px) scale("+state.view.scale+")";
  el("zoomPct").textContent = Math.round(state.view.scale*100)+"%";
}

export function centerView(){
  const rect = viewport.getBoundingClientRect();
  state.view.scale = 1; state.view.x = rect.width/2-2100; state.view.y = rect.height/2-1500;
  applyTransform();
}

export function zoomAt(clientX, clientY, factor){
  const rect = viewport.getBoundingClientRect();
  const mx=clientX-rect.left, my=clientY-rect.top;
  const cx=(mx-state.view.x)/state.view.scale, cy=(my-state.view.y)/state.view.scale;
  const ns = Math.min(2.2, Math.max(0.35, state.view.scale*factor));
  state.view.x = mx-cx*ns; state.view.y = my-cy*ns; state.view.scale = ns;
  applyTransform();
}

export function clientToCanvas(clientX, clientY){
  const rect = viewport.getBoundingClientRect();
  return { x:(clientX-rect.left-state.view.x)/state.view.scale, y:(clientY-rect.top-state.view.y)/state.view.scale };
}

export function viewportCenterCanvasCoords(){
  const rect = viewport.getBoundingClientRect();
  return { x:(rect.width/2-state.view.x)/state.view.scale, y:(rect.height/2-state.view.y)/state.view.scale };
}
