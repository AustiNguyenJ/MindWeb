import { el } from "./dom.js";
import { escapeHtml } from "./util.js";
import { allHotkeyEntries, imageHotkey } from "./toolbarConfig.js";

/* Shortcuts & tips modal: a list of subsection titles down the left, one
   section's content shown on the right at a time. Every section's markup is
   built once per open() and kept in the DOM together -- switching sections
   just toggles which .help-section is visible -- so the whole body is still
   present for anything (search, tests) that reads it as one block of text. */

const STATIC_SECTIONS = [
  { id:"notebooks", title:"Notebooks & pages", html:
    '<h3>Notebooks &amp; pages</h3>' +
    '<p>Pages live inside notebooks, like OneNote. Click a notebook to collapse it, the <b>+</b> on its row to add a page, the pencil to rename, the <b>×</b> to delete. <b>+ Notebook</b> adds a new one.</p>' +
    '<p><b>Reorder</b> pages by dragging them up or down; drag onto another notebook to move them there. Right-click a page (or use its <b>⋯</b> button) to <b>pin</b> it to the top, rename, <b>duplicate the whole page</b>, or delete. Pinned pages show a star and can still be reordered among themselves.</p>'
  },
  { id:"favorites", title:"Favorites", html:
    '<h3>Favorites</h3>' +
    '<p>Pinned pages also collect in a Favorites strip at the top of the sidebar, pulling together starred pages from every notebook for quick access. It only appears once you’ve pinned something, and collapses to a single row if you want it out of the way.</p>'
  },
  { id:"copy-pages", title:"Copy between pages", html:
    '<h3>Copy between pages</h3>' +
    '<p>Select blocks, <kbd>Ctrl</kbd>+<kbd>C</kbd>, switch to any page, then <kbd>Ctrl</kbd>+<kbd>V</kbd> — the blocks and the connections between them come along.</p>'
  },
  { id:"search", title:"Search", html:
    '<h3>Search</h3>' +
    '<p><kbd>⇧F</kbd> (Shift+F) or the Search button opens the search box as a pop-up, so your notebooks stay visible underneath. Narrow it with the scope chips — all notebooks, the current notebook, or just this page. Matches are highlighted; <kbd>Enter</kbd> jumps to the top hit, <kbd>Esc</kbd> closes.</p>'
  },
  { id:"custom-blocks", title:"Custom blocks", html:
    '<h3>Custom blocks</h3>' +
    '<p><b>Design blocks</b> in the toolbar opens the designer. The built-in Note, Question, and Ticket blocks are listed there and can be edited like any other — add fields, rename them, change placeholders. Build your own types too, with any mix of fields — short text, long text, formatted text, links, numbers, dates, dropdowns, checkboxes — pick a header colour and width, and drag fields to reorder. A live preview updates as you go. List and Week have special repeating rows, so they’re shown locked.</p>'
  },
  { id:"repeating-rows", title:"Repeating rows", html:
    '<h3>Repeating rows</h3>' +
    '<p>Set a field’s type to “Repeating rows” to get an appendable group, like steps + description. Define the columns each row should have, choose whether they sit <b>stacked</b> or <b>side by side</b>, and drag the column handles to reorder them. On the block you click <b>+</b> to add as many rows as you like. Every row gets its own connection dot, so you can branch off any single step. Saved types travel with your Export file.</p>'
  },
  { id:"spawn", title:"Spawn at cursor", html:null }, // built live in spawnSectionHtml()
  { id:"tickets", title:"Tickets", html:
    '<h3>Tickets</h3>' +
    '<p>A <b>ticket</b> box holds a number, link, assignee, customer, and note. A <b>week</b> box groups a whole week’s tickets with a shared notes area — each ticket row has its own dot, so you can branch detail off any one of them. The week label fills in with the current Mon–Sun range. Click <b>↗</b> to open a ticket’s link.</p>'
  },
  { id:"copying", title:"Copying", html:
    '<h3>Copying</h3>' +
    '<p>Every field has a <b>⧉</b> button. On a ticket box, <b>Copy all</b> grabs the whole record; in a week box the ⧉ beside the customer copies that one ticket, and the ⧉ in the header copies the whole week. The formatting bar has one too, for the note text.</p>'
  },
  { id:"formatting", title:"Formatting", html:
    '<h3>Formatting</h3>' +
    '<p>Select a box to reveal its formatting bar: bold, italic, bullet and numbered lists, and links. Pasting a bare URL turns it into a link automatically. <kbd>Ctrl</kbd>+click any link to open it.</p>'
  },
  { id:"connecting", title:"Connecting", html:
    '<h3>Connecting</h3>' +
    '<p>Drag the dot on a box’s edge onto another box.</p>' +
    '<p>Drop on <b>empty canvas</b> to open a picker — type to filter, <kbd>Enter</kbd> picks the top match, and the new box appears already connected.</p>' +
    '<p>Each <b>list item</b> has its own dot, so you can branch a hierarchy off any line.</p>' +
    '<p>Double-click a line to label it.</p>'
  },
  { id:"canvas", title:"Canvas", html:
    '<h3>Canvas</h3>' +
    '<ul>' +
      '<li><b>Left-drag</b> empty space to pan</li>' +
      '<li><b>Right-drag</b> anywhere to rubber-band select</li>' +
      '<li><b>Mouse wheel</b> to zoom</li>' +
      '<li><kbd>Ctrl</kbd>+<kbd>Z</kbd> undo &middot; <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> redo</li>' +
      '<li><kbd>Ctrl</kbd>+<kbd>A</kbd> select all</li>' +
      '<li>Drag any selected box to move the whole group</li>' +
      '<li><kbd>Ctrl</kbd>/<kbd>Shift</kbd>+click to add or remove from a selection</li>' +
      '<li><kbd>Del</kbd> removes everything selected</li>' +
      '<li><kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>V</kbd> copy &amp; paste boxes</li>' +
      '<li>Paste an image anywhere to drop it on the canvas</li>' +
    '</ul>'
  },
  { id:"collapsing", title:"Collapsing", html:
    '<h3>Collapsing</h3>' +
    '<p>Any box with arrows leading out of it gets a chevron at its head. Click it to fold everything downstream out of sight; the box shows how many are hidden. Click again to bring them back.</p>'
  },
  { id:"colours", title:"Colours", html:
    '<h3>Colours</h3>' +
    '<p>Boxes start white. Click a box to reveal its swatches; with several selected, a swatch recolours all of them at once.</p>'
  },
  { id:"saving", title:"Saving", html:
    '<h3>Saving</h3>' +
    '<p>Pick a folder once with <b>Connect folder</b>. This page then creates <b>saved-boards/</b> inside it and writes:</p>' +
    '<p class="help-code">saved-boards/index.json<br>saved-boards/board-&lt;id&gt;.json</p>' +
    '<p>One file per page, rewritten on every change. Needs Chrome or Edge. <b>Export</b> gives you a single backup file that works anywhere.</p>'
  },
];

let activeSectionId = STATIC_SECTIONS[0].id;

function spawnSectionHtml(){
  const rows = allHotkeyEntries().map(e=>({ key:e.hotkey, name:e.name }));
  if(imageHotkey()) rows.push({ key:imageHotkey(), name:"Image" });
  const list = rows.length
    ? '<ul class="help-hotkeys">' + rows.map(r=>
        '<li><kbd>'+escapeHtml(r.key.toUpperCase())+'</kbd> '+escapeHtml(r.name)+'</li>').join('') + '</ul>'
    : '<p>No hotkeys are currently assigned.</p>';
  return '<h3>Spawn at cursor</h3>' +
    '<p>With nothing focused in a text field, press a block’s hotkey to drop that block at your cursor.</p>' +
    list +
    '<p>These follow whatever is set in <b>Toolbar settings</b>, so this list always matches your current bindings.</p>';
}

function sectionHtml(id){
  if(id==="spawn") return spawnSectionHtml();
  const s = STATIC_SECTIONS.find(s=>s.id===id);
  return s ? s.html : "";
}

function renderHelpModal(){
  const nav = el("helpSectionList");
  nav.innerHTML = STATIC_SECTIONS.map(s=>
    '<button class="bd-typebtn help-navbtn'+(s.id===activeSectionId?" active":"")+'" data-section="'+s.id+'">'+escapeHtml(s.title)+'</button>'
  ).join('');
  nav.querySelectorAll("[data-section]").forEach(btn=>{
    btn.addEventListener("click", ()=>showHelpSection(btn.dataset.section));
  });

  const body = el("helpBody");
  body.innerHTML = STATIC_SECTIONS.map(s=>
    '<div class="help-section'+(s.id===activeSectionId?" active":"")+'" data-section="'+s.id+'">'+sectionHtml(s.id)+'</div>'
  ).join('');
}

function showHelpSection(id){
  activeSectionId = id;
  el("helpSectionList").querySelectorAll("[data-section]").forEach(b=>{
    b.classList.toggle("active", b.dataset.section===id);
  });
  el("helpBody").querySelectorAll(".help-section").forEach(sec=>{
    sec.classList.toggle("active", sec.dataset.section===id);
  });
}

export function openHelp(){
  renderHelpModal();
  el("helpOverlay").classList.add("open");
}

export function closeHelp(){
  el("helpOverlay").classList.remove("open");
}

export function initHelp(){
  renderHelpModal(); // populate #helpBody up front, so its text is findable before the modal is ever opened
  el("helpTriggerBtn").addEventListener("click", openHelp);
  el("helpClose").addEventListener("click", closeHelp);
  el("helpDone").addEventListener("click", closeHelp);
  el("helpOverlay").addEventListener("click",(e)=>{ if(e.target===el("helpOverlay")) closeHelp(); });
}
