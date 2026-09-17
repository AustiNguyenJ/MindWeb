import { state } from "./state.js";
import { uid } from "./util.js";
import { showToast } from "./toast.js";
import { ensureNotebookStructure } from "./boards.js";
import { migrateLongtextKinds } from "./blockTypes.js";
import { queueTypesSave, persistIndex, persistBoard } from "./storage.js";
import { renderTypeToolbar } from "./app.js";
import { migrateNode } from "./nodes.js";
import { renderBoardList } from "./sidebar.js";

/* The single-file backup format: one JSON bundle carrying notebooks, pages,
   their blocks and connections, and the block-type library. Import adds
   alongside what is already there rather than replacing it, remapping ids so
   an imported page can never collide with an existing one. */

/* ---------- export / import ---------- */
export function exportAll(){
  const payload = {
    version:2, exported:new Date().toISOString(),
    blockTypes: state.customTypes,
    notebooks: state.notebooks,
    boards: state.boards.map(b=>({
      id:b.id, name:b.name, description:b.description||"", notebookId:b.notebookId||null, order:b.order, pinned:!!b.pinned,
      nodes:(state.boardsData[b.id]||{}).nodes||[],
      connections:(state.boardsData[b.id]||{}).connections||[]
    }))
  };
  const blob = new Blob([JSON.stringify(payload,null,2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "mindmaps-"+new Date().toISOString().slice(0,10)+".json";
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
  showToast("Exported");
}

export function importAll(file){
  const reader = new FileReader();
  reader.onload = async (e)=>{
    let payload;
    try{ payload = JSON.parse(e.target.result); }
    catch(err){ alert("That file isn't valid JSON."); return; }
    const incoming = payload.boards || [];
    if(!incoming.length){ alert("No pages found in that file."); return; }
    if(!confirm("Import "+incoming.length+" page(s)? They'll be added alongside your current pages.")) return;
    // merge any custom block types the file carries (keep existing on id clash)
    if(payload.blockTypes){
      let added = 0;
      Object.keys(payload.blockTypes).forEach(id=>{
        if(!state.customTypes[id]){ state.customTypes[id] = payload.blockTypes[id]; added++; }
      });
      if(added){ queueTypesSave(); renderTypeToolbar(); }
      migrateLongtextKinds();
    }
    // recreate the imported notebooks under fresh ids, mapping old->new
    const nbMap = {};
    let importNbId = null;
    if(Array.isArray(payload.notebooks) && payload.notebooks.length){
      payload.notebooks.forEach(onb=>{
        const nid = "nb_"+uid().slice(0,8);
        nbMap[onb.id] = nid;
        state.notebooks.push({ id:nid, name:onb.name||"Imported notebook", collapsed:false });
      });
    } else {
      importNbId = "nb_"+uid().slice(0,8);
      state.notebooks.push({ id:importNbId, name:"Imported", collapsed:false });
    }
    incoming.forEach(b=>{
      const id = uid();
      const nbId = (b.notebookId && nbMap[b.notebookId]) ? nbMap[b.notebookId] : (importNbId || state.notebooks[state.notebooks.length-1].id);
      state.boards.push({id, name:(b.name||"Imported page"), description:b.description||"", notebookId:nbId, order:(typeof b.order==="number"?b.order:state.boards.length), pinned:!!b.pinned});
      state.boardsData[id] = { nodes:(b.nodes||[]).map(migrateNode), connections:b.connections||[] };
    });
    ensureNotebookStructure();
    renderBoardList();
    await persistIndex();
    for(const b of state.boards){ await persistBoard(b.id); }
    showToast("Imported");
  };
  reader.readAsText(file);
}
