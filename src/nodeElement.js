import { state } from "./state.js";
import { COLORS, COPY_ICON } from "./constants.js";
import { escapeHtml, escapeAttr, sanitizeHtml, richToText, normalizeUrl, openLinkBackground } from "./util.js";
import { canvasInner, imgFileInput } from "./dom.js";
import { copyText } from "./clipboard.js";
import { findNode } from "./boards.js";
import { isCustomType, setFieldVal } from "./blockTypes.js";
import { customBodyHtml, wireCustomFields } from "./customFields.js";
import { selectNode } from "./selection.js";
import { outgoingCount, descendantsOf, toggleCollapse } from "./collapse.js";
import { itemHasConnection, addListItem, removeListItem, addTicketRow, removeTicketRow } from "./rows.js";
import { ticketSummary, createNode, deleteNode, duplicateNode, processImageFile } from "./nodes.js";
import { updateConnectionsTouching } from "./connections.js";
import { measureListOffsets, renderBoard } from "./render.js";
import { queueBoardSave } from "./storage.js";
import { startConnectDrag } from "./app.js";

/* Building one block's DOM, and wiring every control on it.
 *
 * This is the widest function in the app: it produces the markup for each
 * block type and attaches roughly thirty listeners -- title, body, rows,
 * colour swatches, the formatting bar, copy buttons, collapse, resize, the
 * drag handle and the connection dots.
 *
 * Two recurring details. Every interactive control stops pointerdown from
 * propagating, or the block-drag handler underneath would start a drag
 * instead of letting the control work. And the formatting bar acts on
 * whichever rich-text region was focused most recently, since a block can
 * have several.
 */

/* ---------- node element ---------- */
export function nodeElement(node){
  const div = document.createElement("div");
  div.className = "node type-"+node.type + (state.selection.has(node.id)?" selected":"");
  div.dataset.id = node.id;
  div.style.left = node.x+"px"; div.style.top = node.y+"px"; div.style.width = node.w+"px";
  if(node.type!=="list" && node.type!=="ticket" && node.type!=="week" && !isCustomType(node.type)) div.style.height = node.h+"px";
  if(node.type!=="header" && node.type!=="image") div.style.background = node.color || "#fff";

  let bodyHtml = "";
  if(node.type==="image"){
    bodyHtml = '<div class="node-body">'+(node.image?'<img src="'+node.image+'">':'<span style="color:var(--muted-2);font-size:12px;">No image yet</span>')+'</div>';
  } else if(node.type==="list"){
    bodyHtml = '<div class="list-rows">' + node.items.map((txt,i)=>
      '<div class="list-row" data-idx="'+i+'">' +
        '<span class="list-bullet"></span>' +
        '<input class="list-input" data-idx="'+i+'" value="'+escapeAttr(txt)+'" placeholder="List item...">' +
        '<button class="row-del" data-idx="'+i+'" title="Remove line">&times;</button>' +
        '<span class="row-conn '+(itemHasConnection(node.id,i)?'has-link':'')+'" data-idx="'+i+'" title="Drag to branch from this line"></span>' +
      '</div>').join('') + '</div>' +
      '<button class="add-item-btn">+ line</button>';
  } else if(node.type==="week"){
    const rows = node.tickets.map((t,i)=>
      '<div class="ticket-row" data-idx="'+i+'">' +
        '<div class="tr-top">' +
          '<input class="tr-no" data-idx="'+i+'" value="'+escapeAttr(t.no||"")+'" placeholder="INC-0000">' +
          '<button class="copy-btn cp-row-no" data-idx="'+i+'" title="Copy ticket number">'+COPY_ICON+'</button>' +
          '<input class="tr-link" data-idx="'+i+'" value="'+escapeAttr(t.link||"")+'" placeholder="link">' +
          '<button class="tk-open'+(t.link?"":" off")+'" data-idx="'+i+'" title="Open link">\u2197</button>' +
          '<button class="row-del" data-idx="'+i+'" title="Remove ticket">&times;</button>' +
        '</div>' +
        '<div class="tr-meta">' +
          '<input class="tr-assigned" data-idx="'+i+'" value="'+escapeAttr(t.assigned||"")+'" placeholder="assigned">' +
          '<span class="divider"></span>' +
          '<input class="tr-customer" data-idx="'+i+'" value="'+escapeAttr(t.customer||"")+'" placeholder="customer">' +
          '<button class="copy-btn cp-row-all" data-idx="'+i+'" title="Copy this ticket">'+COPY_ICON+'</button>' +
        '</div>' +
        '<textarea class="tr-note" data-idx="'+i+'" rows="1" placeholder="note...">'+escapeHtml(t.note||"")+'</textarea>' +
        '<span class="row-conn '+(itemHasConnection(node.id,i)?"has-link":"")+'" data-idx="'+i+'" title="Drag to branch from this ticket"></span>' +
      '</div>').join('');
    bodyHtml =
      '<div class="wk-head">' +
        '<input class="wk-label" value="'+escapeAttr(node.weekLabel||"")+'" placeholder="Week of...">' +
        '<span class="wk-count">'+node.tickets.length+'</span>' +
        '<button class="copy-btn cp-week" title="Copy every ticket in this week">'+COPY_ICON+'</button>' +
      '</div>' +
      '<div class="wk-rows">'+rows+'</div>' +
      '<button class="add-item-btn">+ ticket</button>' +
      '<div class="wk-notes-label">Notes</div>' +
      '<div class="node-body"><div class="node-rich" contenteditable="true" data-ph="Notes for the week...">'+sanitizeHtml(node.bodyHtml)+'</div></div>';
  } else if(isCustomType(node.type)){
    bodyHtml = customBodyHtml(node);
  } else if(node.type!=="header"){
    const ph = node.type==="question" ? "What are we not sure about?" : "Notes...";
    bodyHtml = '<div class="node-body"><div class="node-rich" contenteditable="true" data-ph="'+ph+'">'+sanitizeHtml(node.bodyHtml)+'</div></div>';
  }

  const colorRow = (node.type!=="image" && node.type!=="header")
    ? '<div class="color-row">'+COLORS.map(c=>'<button class="swatch '+(node.color===c?'active':'')+'" data-color="'+c+'" style="background:'+c+'"></button>').join('')+'</div>'
    : '';

  const defForBar = state.customTypes[node.type];
  const hasRich = (node.type==="week") ||
    (defForBar && defForBar.fields.some(f=>
      f.kind==="richtext" || f.kind==="longtext" ||
      (f.kind==="group" && (f.subfields||[]).some(sf=>sf.kind==="richtext" || sf.kind==="longtext"))));
  const fmtBar = hasRich
    ? '<div class="fmt-bar">' +
        '<button data-cmd="bold" title="Bold"><b>B</b></button>' +
        '<button data-cmd="italic" title="Italic"><i>I</i></button>' +
        '<span class="sep"></span>' +
        '<button data-cmd="insertUnorderedList" title="Bulleted list">\u2022 \u2013</button>' +
        '<button data-cmd="insertOrderedList" title="Numbered list">1.</button>' +
        '<span class="sep"></span>' +
        '<button data-cmd="createLink" title="Add link">Link</button>' +
        '<button data-cmd="unlink" title="Remove link">\u2717</button>' +
        '<span class="sep"></span>' +
        '<button data-cmd="copytext" title="Copy this text">'+COPY_ICON+'</button>' +
      '</div>'
    : '';

  const kids = outgoingCount(node.id);
  const hiddenCount = node.collapsed ? descendantsOf(node.id).size : 0;
  const collapseBtn = kids
    ? '<button class="collapse-btn'+(node.collapsed?" is-collapsed":"")+'" title="'+(node.collapsed?"Expand":"Collapse")+' what\'s connected below">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m6 9 6 6 6-6"/></svg>' +
      '</button>'
    : '';
  const countBadge = (node.collapsed && hiddenCount)
    ? '<span class="hidden-badge">'+hiddenCount+' hidden</span>' : '';

  div.innerHTML =
    '<div class="node-header">' +
      collapseBtn +
      '<span class="grip">&#10807;&#10241;</span>' +
      '<input class="node-title" value="'+escapeAttr(node.title)+'" placeholder="'+(node.type==='header'?'Topic title':'Title')+'">' +
      countBadge +
      '<div class="node-actions">' +
        (node.type==="image"?'<button class="icon-btn change-img" title="Replace image">&#8635;</button>':'') +
        '<button class="icon-btn dupe" title="Duplicate">&#10064;</button>' +
        '<button class="icon-btn del" title="Delete">&times;</button>' +
      '</div>' +
    '</div>' + bodyHtml + colorRow + fmtBar +
    (node.type!=="header" ? '<div class="resize-handle"></div>' : '') +
    '<div class="conn-handle" title="Drag to connect"></div>';

  const collapseEl = div.querySelector(".collapse-btn");
  if(collapseEl){
    collapseEl.addEventListener("pointerdown", e=>e.stopPropagation());
    collapseEl.addEventListener("click",(e)=>{ e.stopPropagation(); toggleCollapse(node.id); });
  }

  div.addEventListener("pointerdown",(e)=>{
    if(e.button!==0) return;
    if(e.target.closest("input,textarea,button,.resize-handle,.conn-handle,.row-conn")) return;
    selectNode(node.id, e.ctrlKey||e.metaKey||e.shiftKey);
    const ids = state.selection.has(node.id) && state.selection.size>1 ? [...state.selection] : [node.id];
    const moving = [];
    ids.forEach(id=>{
      const n = findNode(id);
      const nel = canvasInner.querySelector('.node[data-id="'+id+'"]');
      if(n && nel) moving.push({node:n, el:nel, ox:n.x, oy:n.y});
    });
    state.dragState = { mode:"drag", moving, startX:e.clientX, startY:e.clientY };
    div.setPointerCapture(e.pointerId);
    e.stopPropagation();
  });

  const titleInput = div.querySelector(".node-title");
  titleInput.addEventListener("pointerdown", e=>e.stopPropagation());
  titleInput.addEventListener("input", e=>{ node.title=e.target.value; queueBoardSave(state.currentBoardId); });
  titleInput.addEventListener("focus", ()=>selectNode(node.id));

  /* custom-type fields */
  if(isCustomType(node.type)) wireCustomFields(div, node);

  /* rich text body */
  const rich = div.querySelector(".node-rich");
  if(rich){
    rich.addEventListener("pointerdown", e=>e.stopPropagation());
    rich.addEventListener("focus", ()=>selectNode(node.id));
    rich.addEventListener("input", ()=>{
      node.bodyHtml = rich.innerHTML;
      node.body = richToText(rich.innerHTML);
      queueBoardSave(state.currentBoardId);
    });
    rich.addEventListener("blur", ()=>{
      const clean = sanitizeHtml(rich.innerHTML);
      if(clean !== rich.innerHTML) rich.innerHTML = clean;
      node.bodyHtml = clean;
      node.body = richToText(clean);
      queueBoardSave(state.currentBoardId);
    });
    // paste as plain text so outside styling never leaks in
    rich.addEventListener("paste",(e)=>{
      const cd = e.clipboardData;
      if(!cd) return;
      // an image still becomes its own block on the canvas
      if(cd.items){
        for(const item of cd.items){
          if(item.type.indexOf("image")===0){
            e.preventDefault();
            e.stopPropagation();
            processImageFile(item.getAsFile(),(dataUrl,w,h)=>{
              const n = createNode("image", state.cursorCanvas.x, state.cursorCanvas.y, {silent:true});
              n.image = dataUrl; n.w = Math.min(320,w); n.h = n.w*(h/w);
              renderBoard(); queueBoardSave(state.currentBoardId);
            });
            return;
          }
        }
      }
      const txt = cd.getData("text/plain");
      if(txt){
        e.preventDefault();
        e.stopPropagation();
        const url = normalizeUrl(txt);
        if(/^https?:\/\//i.test(url) && txt.indexOf(" ")===-1){
          document.execCommand("insertHTML", false,
            '<a href="'+escapeAttr(url)+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(txt)+'</a>&nbsp;');
        } else {
          document.execCommand("insertText", false, txt);
        }
      }
    });
    // ctrl/cmd-click opens a link without disturbing the cursor
    rich.addEventListener("click",(e)=>{
      const a = e.target.closest("a");
      if(a && (e.ctrlKey||e.metaKey)){
        e.preventDefault();
        openLinkBackground(a.href);
      }
    });
  }

  /* format toolbar: acts on whichever rich area was last focused in this box */
  let lastRich = div.querySelector(".node-rich") || div.querySelector(".cf-rich");
  div.querySelectorAll(".node-rich, .cf-rich").forEach(r=>{
    r.addEventListener("focus", ()=>{ lastRich = r; });
  });
  div.querySelectorAll(".fmt-bar button").forEach(btn=>{
    btn.addEventListener("pointerdown",(e)=>{ e.preventDefault(); e.stopPropagation(); });
    btn.addEventListener("click",(e)=>{
      e.stopPropagation();
      const target = lastRich || div.querySelector(".node-rich") || div.querySelector(".cf-rich");
      if(!target) return;
      target.focus();
      const cmd = btn.dataset.cmd;
      if(cmd==="copytext"){ copyText(richToText(target.innerHTML), btn); return; }
      try{ document.execCommand("styleWithCSS", false, false); }catch(err){}
      if(cmd==="createLink"){
        const sel = window.getSelection();
        const hasSel = sel && sel.toString().trim().length;
        const url = normalizeUrl(prompt("Link URL:", "https://") || "");
        if(!url) return;
        if(hasSel){ document.execCommand("createLink", false, url); }
        else {
          document.execCommand("insertHTML", false,
            '<a href="'+escapeAttr(url)+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(url)+'</a>&nbsp;');
        }
      } else {
        document.execCommand(cmd, false, null);
      }
      const clean = sanitizeHtml(target.innerHTML);
      target.innerHTML = clean;
      // write back to the correct place: node-rich -> bodyHtml, cf-rich -> its field
      if(target.classList.contains("cf-rich")){
        setFieldVal(node, target.dataset.fk, clean);
      } else {
        node.bodyHtml = clean;
        node.body = richToText(clean);
      }
      queueBoardSave(state.currentBoardId);
    });
  });

  /* single ticket fields */
  [["tk-no","ticketNo"],["tk-link","link"],["tk-assigned","assigned"],["tk-customer","customer"]]
    .forEach(([cls, prop])=>{
      const f = div.querySelector("."+cls);
      if(!f) return;
      f.addEventListener("pointerdown", e=>e.stopPropagation());
      f.addEventListener("focus", ()=>selectNode(node.id));
      f.addEventListener("input", e=>{
        node[prop] = e.target.value;
        if(prop==="link"){
          const ob = div.querySelector(".tk-fields .tk-open");
          if(ob) ob.classList.toggle("off", !node.link);
        }
        queueBoardSave(state.currentBoardId);
      });
    });
  if(node.type==="ticket"){
    const openBtn = div.querySelector(".tk-fields .tk-open");
    if(openBtn){
      openBtn.addEventListener("pointerdown", e=>e.stopPropagation());
      openBtn.addEventListener("click",(e)=>{
        e.stopPropagation();
        openLinkBackground(node.link);
      });
    }
    [["cp-no", ()=>node.ticketNo],
     ["cp-link", ()=>node.link],
     ["cp-assigned", ()=>node.assigned],
     ["cp-customer", ()=>node.customer],
     ["cp-all", ()=>ticketSummary({no:node.ticketNo, link:node.link, assigned:node.assigned,
                                   customer:node.customer, note:richToText(node.bodyHtml)})]
    ].forEach(([cls, get])=>{
      const b = div.querySelector("."+cls);
      if(!b) return;
      b.addEventListener("pointerdown", e=>e.stopPropagation());
      b.addEventListener("click",(e)=>{ e.stopPropagation(); copyText(get(), b); });
    });
  }

  /* week container rows */
  div.querySelectorAll(".tr-no, .tr-link, .tr-note, .tr-assigned, .tr-customer").forEach(fld=>{
    fld.addEventListener("pointerdown", e=>e.stopPropagation());
    fld.addEventListener("focus", ()=>selectNode(node.id));
    fld.addEventListener("input",(e)=>{
      const i = parseInt(e.target.dataset.idx,10);
      const t = node.tickets[i];
      if(!t) return;
      if(e.target.classList.contains("tr-no")) t.no = e.target.value;
      else if(e.target.classList.contains("tr-assigned")) t.assigned = e.target.value;
      else if(e.target.classList.contains("tr-customer")) t.customer = e.target.value;
      else if(e.target.classList.contains("tr-link")){
        t.link = e.target.value;
        const btn = e.target.parentNode.querySelector(".tk-open");
        if(btn) btn.classList.toggle("off", !t.link);
      }
      else {
        t.note = e.target.value;
        e.target.style.height = "auto";
        e.target.style.height = e.target.scrollHeight+"px";
        measureListOffsets();
        updateConnectionsTouching(node.id);
      }
      queueBoardSave(state.currentBoardId);
    });
    fld.addEventListener("keydown",(e)=>{
      if(e.target.classList.contains("tr-note")) return;
      const i = parseInt(e.target.dataset.idx,10);
      if(e.key==="Enter"){ e.preventDefault(); addTicketRow(node, i); }
    });
  });
  div.querySelectorAll(".cp-row-no").forEach(btn=>{
    btn.addEventListener("pointerdown", e=>e.stopPropagation());
    btn.addEventListener("click",(e)=>{
      e.stopPropagation();
      const t = node.tickets[parseInt(btn.dataset.idx,10)];
      if(t) copyText(t.no, btn);
    });
  });
  div.querySelectorAll(".cp-row-all").forEach(btn=>{
    btn.addEventListener("pointerdown", e=>e.stopPropagation());
    btn.addEventListener("click",(e)=>{
      e.stopPropagation();
      const t = node.tickets[parseInt(btn.dataset.idx,10)];
      if(t) copyText(ticketSummary(t), btn);
    });
  });
  const cpWeek = div.querySelector(".cp-week");
  if(cpWeek){
    cpWeek.addEventListener("pointerdown", e=>e.stopPropagation());
    cpWeek.addEventListener("click",(e)=>{
      e.stopPropagation();
      const lines = node.tickets.map(t=>ticketSummary(t)).filter(Boolean);
      const head = (node.weekLabel||"").trim();
      copyText((head?head+"\n\n":"")+lines.join("\n\n"), cpWeek);
    });
  }
  div.querySelectorAll(".wk-rows .tk-open").forEach(btn=>{
    btn.addEventListener("pointerdown", e=>e.stopPropagation());
    btn.addEventListener("click",(e)=>{
      e.stopPropagation();
      const t = node.tickets[parseInt(btn.dataset.idx,10)];
      if(t) openLinkBackground(t.link);
    });
  });
  const wkLabel = div.querySelector(".wk-label");
  if(wkLabel){
    wkLabel.addEventListener("pointerdown", e=>e.stopPropagation());
    wkLabel.addEventListener("focus", ()=>selectNode(node.id));
    wkLabel.addEventListener("input", e=>{ node.weekLabel = e.target.value; queueBoardSave(state.currentBoardId); });
  }

  // list rows
  div.querySelectorAll(".list-input").forEach(input=>{
    input.addEventListener("pointerdown", e=>e.stopPropagation());
    input.addEventListener("focus", ()=>selectNode(node.id));
    input.addEventListener("input",(e)=>{
      node.items[parseInt(e.target.dataset.idx,10)] = e.target.value;
      queueBoardSave(state.currentBoardId);
    });
    input.addEventListener("keydown",(e)=>{
      const i = parseInt(e.target.dataset.idx,10);
      if(e.key==="Enter"){ e.preventDefault(); addListItem(node, i); }
      else if(e.key==="Backspace" && e.target.value===""){ e.preventDefault(); removeListItem(node, i); }
    });
  });
  div.querySelectorAll(".row-del").forEach(btn=>{
    btn.addEventListener("pointerdown", e=>e.stopPropagation());
    btn.addEventListener("click",()=>{
      const i = parseInt(btn.dataset.idx,10);
      if(node.type==="week") removeTicketRow(node, i); else removeListItem(node, i);
    });
  });
  const addItemBtn = div.querySelector(".add-item-btn");
  if(addItemBtn){
    addItemBtn.addEventListener("pointerdown", e=>e.stopPropagation());
    addItemBtn.addEventListener("click",()=>{
      if(node.type==="week") addTicketRow(node); else addListItem(node);
    });
  }
  div.querySelectorAll(".row-conn[data-idx]").forEach(dot=>{
    dot.addEventListener("pointerdown",(e)=>{
      e.stopPropagation();
      const idx = parseInt(dot.dataset.idx,10);
      const offs = state.itemOffsets[node.id] || [];
      const oy = offs[idx]!=null ? offs[idx] : node.h/2;
      startConnectDrag(node.id, idx, node.x+node.w, node.y+oy);
    });
  });

  div.querySelectorAll(".swatch").forEach(sw=>{
    sw.addEventListener("pointerdown", e=>e.stopPropagation());
    sw.addEventListener("click",()=>{
      const color = sw.dataset.color;
      const targets = state.selection.has(node.id) && state.selection.size>1 ? [...state.selection] : [node.id];
      targets.forEach(id=>{
        const n = findNode(id);
        if(!n) return;
        n.color = color;
        const nel = canvasInner.querySelector('.node[data-id="'+id+'"]');
        if(nel && n.type!=="header" && n.type!=="image"){
          nel.style.background = color;
          nel.querySelectorAll(".swatch").forEach(s=>s.classList.toggle("active", s.dataset.color===color));
        }
      });
      queueBoardSave(state.currentBoardId);
    });
  });

  const dupeBtn = div.querySelector(".dupe");
  if(dupeBtn){ dupeBtn.addEventListener("pointerdown", e=>e.stopPropagation()); dupeBtn.addEventListener("click",()=>duplicateNode(node.id)); }
  const delBtn = div.querySelector(".del");
  delBtn.addEventListener("pointerdown", e=>e.stopPropagation());
  delBtn.addEventListener("click",()=>deleteNode(node.id));

  const changeImgBtn = div.querySelector(".change-img");
  if(changeImgBtn){
    changeImgBtn.addEventListener("pointerdown", e=>e.stopPropagation());
    changeImgBtn.addEventListener("click",()=>{
      imgFileInput.onchange = (e)=>{
        const file = e.target.files[0];
        if(file) processImageFile(file,(dataUrl)=>{
          node.image = dataUrl;
          div.querySelector(".node-body").innerHTML = '<img src="'+dataUrl+'">';
          queueBoardSave(state.currentBoardId);
        });
        imgFileInput.value=""; imgFileInput.onchange=null;
      };
      imgFileInput.click();
    });
  }

  const resizeHandle = div.querySelector(".resize-handle");
  if(resizeHandle){
    resizeHandle.addEventListener("pointerdown",(e)=>{
      e.stopPropagation();
      state.dragState = { mode:"resize", node, el:div, startX:e.clientX, startY:e.clientY, ow:node.w, oh:node.h };
      div.setPointerCapture(e.pointerId);
    });
  }

  const connHandle = div.querySelector(".conn-handle");
  connHandle.addEventListener("pointerdown",(e)=>{
    e.stopPropagation();
    startConnectDrag(node.id, null, node.x+node.w, node.y+node.h/2);
  });

  return div;
}
