import { el } from "./dom.js";
import { state } from "./state.js";
import { escapeHtml, escapeAttr } from "./util.js";
import { showToast } from "./toast.js";
import {
  toolbarEntries,
  resolvedToolbarConfig,
  normalizeToolbarConfig,
  defaultToolbarConfig,
  boardHasOverride,
} from "./toolbarConfig.js";
import { queueToolbarConfigSave, queueBoardSave } from "./storage.js";
import { renderQuickAccessToolbar } from "./toolbar.js";
import { renderTypeToolbar } from "./designer.js";

/* The Toolbar settings modal: which block types show as quick-access
   buttons, and what single key (if any) spawns each. Edits go either to the
   shared global config or, if the current board opted in, to that board's
   own copy -- see toolbarConfig.js for how the two are resolved. */

/* The config object edits are written to right now: the current board's own
   override if it has one, otherwise the shared global one. Mutating this in
   place and re-rendering is enough, since resolvedToolbarConfig() reads the
   same objects. */
function editableConfig(){
  if(boardHasOverride(state.currentBoardId)){
    const d = state.boardsData[state.currentBoardId];
    d.toolbarConfig = normalizeToolbarConfig(d.toolbarConfig);
    return d.toolbarConfig;
  }
  if(!state.toolbarConfig) state.toolbarConfig = defaultToolbarConfig();
  return state.toolbarConfig;
}

function persistEditableConfig(){
  if(boardHasOverride(state.currentBoardId)) queueBoardSave(state.currentBoardId);
  else queueToolbarConfigSave();
}

export function openToolbarSettings(){
  el("toolbarSettingsOverlay").classList.add("open");
  const d = state.boardsData[state.currentBoardId];
  el("tsBoardOverride").checked = !!(d && d.toolbarOverride);
  renderToolbarSettingsList();
}

export function closeToolbarSettings(){
  el("toolbarSettingsOverlay").classList.remove("open");
}

function applyRenderedChanges(){
  renderQuickAccessToolbar();
  renderTypeToolbar();
}

export function renderToolbarSettingsList(){
  const cfg = resolvedToolbarConfig();
  const entries = toolbarEntries();
  const byId = {};
  entries.forEach(e=>{ byId[e.id] = e; });
  const ordered = [];
  const seen = new Set();
  cfg.order.forEach(id=>{ if(byId[id] && !seen.has(id)){ seen.add(id); ordered.push(byId[id]); } });
  entries.forEach(e=>{ if(!seen.has(e.id)){ seen.add(e.id); ordered.push(e); } });

  const list = el("tsList");
  list.innerHTML = ordered.map(e=>{
    const onBar = cfg.onBar[e.id]!==false;
    const hotkey = cfg.hotkeys[e.id] || "";
    return '<div class="ts-row" data-id="'+e.id+'">' +
      '<span class="ts-name"><span class="swab" style="background:'+e.accent+'"></span>'+escapeHtml(e.name)+'</span>' +
      '<input type="checkbox" class="ts-onbar" data-onbar="'+e.id+'" '+(onBar?"checked":"")+'>' +
      '<input type="text" class="ts-hotkey" data-hotkey="'+e.id+'" maxlength="1" placeholder="—" value="'+escapeAttr(hotkey)+'">' +
      '</div>';
  }).join('');

  wireRows(cfg);
  flagDuplicates(cfg);
}

function wireRows(cfg){
  const list = el("tsList");
  list.querySelectorAll("[data-onbar]").forEach(cb=>{
    cb.addEventListener("change",()=>{
      const c = editableConfig();
      c.onBar[cb.dataset.onbar] = cb.checked;
      persistEditableConfig();
      applyRenderedChanges();
    });
  });
  list.querySelectorAll("[data-hotkey]").forEach(inp=>{
    inp.addEventListener("input",()=>{
      inp.value = inp.value.slice(-1).replace(/[^a-z0-9]/i,"");
      const typeId = inp.dataset.hotkey;
      const key = inp.value.trim().toLowerCase();
      const c = editableConfig();
      if(key) c.hotkeys[typeId] = key; else delete c.hotkeys[typeId];
      persistEditableConfig();
      flagDuplicates(resolvedToolbarConfig());
      applyRenderedChanges();
    });
  });
}

/* Flags (but doesn't silently drop) any hotkey bound to more than one type,
   so the ambiguity is visible instead of one binding quietly winning. */
function flagDuplicates(cfg){
  const counts = {};
  Object.keys(cfg.hotkeys).forEach(typeId=>{
    const k = (cfg.hotkeys[typeId]||"").trim().toLowerCase();
    if(!k) return;
    counts[k] = (counts[k]||0) + 1;
  });
  const dupKeys = new Set(Object.keys(counts).filter(k=>counts[k]>1));
  const list = el("tsList");
  let anyDup = false;
  list.querySelectorAll("[data-hotkey]").forEach(inp=>{
    const k = inp.value.trim().toLowerCase();
    const dup = k && dupKeys.has(k);
    inp.classList.toggle("dup", dup);
    if(dup) anyDup = true;
  });
  el("tsError").textContent = anyDup ? "Two block types share the same hotkey — only one of them will fire." : "";
}

export function initToolbarSettings(){
  el("toolbarSettingsBtn").addEventListener("click", openToolbarSettings);
  el("tsClose").addEventListener("click", closeToolbarSettings);
  el("tsDone").addEventListener("click", closeToolbarSettings);
  el("toolbarSettingsOverlay").addEventListener("click",(e)=>{
    if(e.target===el("toolbarSettingsOverlay")) closeToolbarSettings();
  });
  el("tsBoardOverride").addEventListener("change",(e)=>{
    const d = state.boardsData[state.currentBoardId];
    if(!d) return;
    d.toolbarOverride = e.target.checked;
    if(d.toolbarOverride && !d.toolbarConfig){
      // start the board's own copy from whatever is in effect right now
      d.toolbarConfig = normalizeToolbarConfig(state.toolbarConfig || defaultToolbarConfig());
    }
    queueBoardSave(state.currentBoardId);
    renderToolbarSettingsList();
    applyRenderedChanges();
    showToast(d.toolbarOverride ? "This page now has its own toolbar setup" : "This page uses the shared toolbar setup again");
  });
}
