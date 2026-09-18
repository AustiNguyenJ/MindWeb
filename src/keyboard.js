import { el } from "./dom.js";
import { state } from "./state.js";
import { NO_CONNECT_SPAWN } from "./constants.js";
import { hotkeyTypeMap } from "./toolbarConfig.js";
import { isTextEntry } from "./util.js";
import { showToast } from "./toast.js";
import { getData, findNode } from "./boards.js";
import { uid } from "./util.js";
import { setSelection, deselectAll } from "./selection.js";
import { hiddenNodeIds } from "./collapse.js";
import {
  createNode,
  spawnAtCursor,
  deleteSelectedNodes,
  processImageFile,
  focusNodeTitle,
} from "./nodes.js";
import { createConnection, deleteConnection } from "./connections.js";
import { renderBoard } from "./render.js";
import { undo, redo } from "./history.js";
import { toggleSearch, closeSearch } from "./search.js";
import { closeHelp } from "./help.js";
import { closePageMenu } from "./pageMenu.js";
import { cleanupConnectVisuals, fromItemLabel } from "./canvas.js";
import { queueBoardSave } from "./storage.js";
import { cancelConfirmModal } from "./confirmModal.js";

/* Keyboard shortcuts and pasting.
 *
 * Every canvas shortcut is suppressed while the caret is in a text field, so
 * typing never spawns a block or deletes a selection. Paste accepts three
 * things: a copied block cluster (which brings its internal connections
 * along), an image, or plain text.
 */

export function pasteNodeCopy(src){
  // accept the new {nodes, connections} shape or the old bare array
  const nodesIn = Array.isArray(src) ? src : (src && src.nodes) || [];
  const connsIn = (src && src.connections) || [];
  if(!nodesIn.length) return;
  const minX = Math.min(...nodesIn.map(n=>n.x));
  const minY = Math.min(...nodesIn.map(n=>n.y));
  const idMap = {};
  const newIds = [];
  nodesIn.forEach(n=>{
    const copy = JSON.parse(JSON.stringify(n));
    copy.id = uid(); idMap[n.id] = copy.id;
    copy.x = Math.round(state.cursorCanvas.x + (n.x-minX));
    copy.y = Math.round(state.cursorCanvas.y + (n.y-minY));
    copy.collapsed = false;
    getData().nodes.push(copy);
    newIds.push(copy.id);
  });
  // recreate internal connections with remapped ids
  connsIn.forEach(c=>{
    if(idMap[c.from] && idMap[c.to]){
      getData().connections.push({
        id: uid(), from: idMap[c.from], to: idMap[c.to],
        fromItem: (c.fromItem===undefined?null:c.fromItem),
        toItem: (c.toItem===undefined?null:c.toItem),
        label: c.label || ""
      });
    }
  });
  renderBoard(); setSelection(newIds); queueBoardSave(state.currentBoardId);
  showToast(newIds.length>1 ? "Pasted "+newIds.length+" boxes" : "Pasted");
}

export function createNoteNodeWithText(text){
  const node = createNode("note", state.cursorCanvas.x, state.cursorCanvas.y, {silent:true});
  node.body = text.slice(0,600);
  node.title = text.slice(0,40);
  renderBoard(); queueBoardSave(state.currentBoardId);
}

/* Global keyboard shortcuts and paste handling. */
export function initKeyboard(){
  document.addEventListener("keydown",(e)=>{
    const ae = document.activeElement;
    const inField = isTextEntry(ae);
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;

    // Shift+F opens/toggles the search modal (not while typing in a field)
    if(e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase()==="f" && !inField){
      e.preventDefault();
      toggleSearch();
      return;
    }
    // Escape closes search if it's open, before doing anything else
    if(e.key==="Escape" && el("searchOverlay").classList.contains("open")){
      e.preventDefault();
      closeSearch();
      return;
    }
    // ...or cancels a confirm modal, same precedence
    if(e.key==="Escape" && el("confirmOverlay").classList.contains("open")){
      e.preventDefault();
      cancelConfirmModal();
      return;
    }

    // Escape closes the help modal the same way
    if(e.key==="Escape" && el("helpOverlay").classList.contains("open")){
      e.preventDefault();
      closeHelp();
      return;
    }

    // spawn-connected while dragging a link
    if(state.dragState && state.dragState.mode==="connect" && plain){
      const type = hotkeyTypeMap()[e.key.toLowerCase()];
      if(type && !NO_CONNECT_SPAWN[type]){
        e.preventDefault();
        const from = state.dragState;
        cleanupConnectVisuals();
        state.dragState = null;
        const node = createNode(type, state.cursorCanvas.x+90, state.cursorCanvas.y, {silent:true});
        const label = fromItemLabel(from);
        if(label) node.title = label;
        createConnection(from.fromId, from.fromItem, node.id, null);
        renderBoard();
        focusNodeTitle(node.id);
        return;
      }
    }

    if(plain && !inField){
      const type = hotkeyTypeMap()[e.key.toLowerCase()];
      if(type){ e.preventDefault(); spawnAtCursor(type); return; }
    }

    if((e.key==="Delete"||e.key==="Backspace") && !inField){
      if(state.selection.size){ e.preventDefault(); deleteSelectedNodes(); }
      else if(state.selectedConnId){ e.preventDefault(); deleteConnection(state.selectedConnId); }
    }
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==="z" && !inField){
      e.preventDefault();
      if(e.shiftKey) redo(); else undo();
      return;
    }
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==="y" && !inField){
      e.preventDefault(); redo(); return;
    }
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==="a" && !inField){
      e.preventDefault();
      const hid = hiddenNodeIds(); setSelection(getData().nodes.filter(n=>!hid.has(n.id)).map(n=>n.id));
      return;
    }
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==="c" && !inField && state.selection.size){
      const nodes = [...state.selection].map(findNode).filter(Boolean);
      if(nodes.length){
        const ids = new Set(nodes.map(n=>n.id));
        // capture connections whose BOTH ends are in the selection, so a copied
        // cluster keeps its internal wiring when pasted (even on another page)
        const conns = getData().connections.filter(c=>ids.has(c.from) && ids.has(c.to));
        const payload = { nodes:JSON.parse(JSON.stringify(nodes)), connections:JSON.parse(JSON.stringify(conns)) };
        state.clipboardNode = payload;
        try{ navigator.clipboard.writeText("MINDMAP_NODE::"+JSON.stringify(payload)); }catch(err){}
        showToast(nodes.length>1 ? "Copied "+nodes.length+" boxes" : "Copied");
      }
    }
    if(e.key==="Escape"){
      if(el("pageMenu")){ closePageMenu(); return; }
      if(state.dragState && state.dragState.mode==="connect"){ cleanupConnectVisuals(); state.dragState=null; }
      deselectAll();
    }
  });

  document.addEventListener("paste",(e)=>{
    const ae = document.activeElement;
    if(isTextEntry(ae)) return;
    const cd = e.clipboardData;
    if(cd && cd.items){
      for(const item of cd.items){
        if(item.type.indexOf("image")===0){
          e.preventDefault();
          processImageFile(item.getAsFile(),(dataUrl,w,h)=>{
            const node = createNode("image", state.cursorCanvas.x, state.cursorCanvas.y, {silent:true});
            node.image = dataUrl; node.w = Math.min(320,w); node.h = node.w*(h/w);
            renderBoard(); queueBoardSave(state.currentBoardId);
          });
          return;
        }
      }
    }
    const text = cd ? cd.getData("text/plain") : "";
    if(text && text.indexOf("MINDMAP_NODE::")===0){
      e.preventDefault();
      try{ pasteNodeCopy(JSON.parse(text.slice(14))); }
      catch(err){ if(state.clipboardNode) pasteNodeCopy(state.clipboardNode); }
      return;
    }
    if(state.clipboardNode){ e.preventDefault(); pasteNodeCopy(state.clipboardNode); return; }
    if(text && text.trim()){ e.preventDefault(); createNoteNodeWithText(text.trim()); }
  });
}
