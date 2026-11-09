import { state } from "./state.js";
import { BUILTIN_TOOLBAR_META, TOOLBAR_KEY } from "./constants.js";
import { fsRead } from "./storage.js";

/* Quick-access toolbar + hotkey configuration.
 *
 * One global config, state.toolbarConfig, governs every page:
 * { order: [typeId,...], onBar: {typeId:bool}, hotkeys: {typeId:key} },
 * persisted next to block-types.json.
 */

export function defaultToolbarConfig(){
  const order = Object.keys(BUILTIN_TOOLBAR_META);
  const onBar = {};
  order.forEach(id=>{ onBar[id] = true; });
  return {
    order: order.slice(),
    onBar,
    hotkeys: { header:"h", note:"n", list:"l", question:"q", ticket:"t", week:"w", image:"g" },
  };
}

export function normalizeToolbarConfig(raw){
  const base = defaultToolbarConfig();
  if(!raw || typeof raw!=="object") return base;
  return {
    order: Array.isArray(raw.order) ? raw.order.slice() : base.order,
    onBar: Object.assign({}, base.onBar, (raw.onBar && typeof raw.onBar==="object") ? raw.onBar : {}),
    hotkeys: Object.assign({}, base.hotkeys, (raw.hotkeys && typeof raw.hotkeys==="object") ? raw.hotkeys : {}),
  };
}

/* Every block type the settings modal can configure: built-ins (from
   BUILTIN_TOOLBAR_META) plus every custom (non-builtin) type currently in
   the block-type library. Order here is just for listing; bar order comes
   from cfg.order. */
export function toolbarEntries(){
  const list = Object.keys(BUILTIN_TOOLBAR_META).map(id=>(
    { id, name: BUILTIN_TOOLBAR_META[id].label, accent: BUILTIN_TOOLBAR_META[id].accent, builtin:true }
  ));
  Object.keys(state.customTypes).forEach(id=>{
    const t = state.customTypes[id];
    if(t.builtin) return;   // note/question/ticket already listed above by their own id
    list.push({ id, name: t.name || "Custom", accent: t.accent || "#ffffff", builtin:false });
  });
  return list;
}

/* The quick bar and hotkeys are one global config shared by every page, so an
   edit shows up everywhere. (Pages used to be able to opt into their own copy;
   any leftover per-board toolbarOverride/toolbarConfig in saved data is
   ignored.) */
export function resolvedToolbarConfig(){
  return state.toolbarConfig || defaultToolbarConfig();
}

/* Built-in, non-image entries currently on the bar, in configured order --
   what toolbar.js renders into #builtinToolbarBtns. (Image keeps its own
   fixed button; custom types keep their own #customTypeBtns container.) */
export function barBuiltinEntries(){
  const cfg = resolvedToolbarConfig();
  const byId = {};
  toolbarEntries().forEach(e=>{ if(e.builtin) byId[e.id] = e; });
  const seen = new Set();
  const ordered = [];
  cfg.order.forEach(id=>{
    if(id==="image" || !byId[id] || seen.has(id)) return;
    seen.add(id); ordered.push(byId[id]);
  });
  Object.keys(byId).forEach(id=>{
    if(id==="image" || seen.has(id)) return;
    seen.add(id); ordered.push(byId[id]);
  });
  return ordered.filter(e => cfg.onBar[e.id]!==false).map(e=>({ ...e, hotkey: cfg.hotkeys[e.id]||"" }));
}

export function barCustomEntries(){
  const cfg = resolvedToolbarConfig();
  return toolbarEntries()
    .filter(e=>!e.builtin && cfg.onBar[e.id]!==false)
    .map(e=>({ ...e, hotkey: cfg.hotkeys[e.id]||"" }));
}

/* Every type with a bound hotkey, on-bar or not -- hotkeyTypeMap() (and thus
   keyboard.js) honors a binding regardless of the type's on-bar flag, so the
   help modal's "Spawn at cursor" list needs this, not the bar-only lists. */
export function allHotkeyEntries(){
  const cfg = resolvedToolbarConfig();
  return toolbarEntries()
    .filter(e=>e.id!=="image" && cfg.hotkeys[e.id])
    .map(e=>({ ...e, hotkey: cfg.hotkeys[e.id] }));
}

export function imageOnBar(){
  return resolvedToolbarConfig().onBar.image !== false;
}

export function imageHotkey(){
  return resolvedToolbarConfig().hotkeys.image || "";
}

/* key (lowercase) -> typeId, for keyboard.js. Blank hotkeys are skipped. */
export function hotkeyTypeMap(){
  const cfg = resolvedToolbarConfig();
  const map = {};
  Object.keys(cfg.hotkeys).forEach(typeId=>{
    const k = (cfg.hotkeys[typeId]||"").trim().toLowerCase();
    if(k) map[k] = typeId;
  });
  return map;
}

export async function loadToolbarConfig(){
  try{
    if(state.backend==="folder"){
      const txt = await fsRead("toolbar-config.json");
      if(txt) state.toolbarConfig = normalizeToolbarConfig(JSON.parse(txt));
    } else if(state.backend==="app" && typeof window.storage!=="undefined" && window.storage){
      const res = await window.storage.get(TOOLBAR_KEY, false);
      if(res && res.value) state.toolbarConfig = normalizeToolbarConfig(JSON.parse(res.value));
    }
  }catch(err){ /* fall through to the default below */ }
  if(!state.toolbarConfig) state.toolbarConfig = defaultToolbarConfig();
}
