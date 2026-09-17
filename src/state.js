/* The application's shared mutable state, in one place.
 *
 * It is a single object rather than a set of exported `let` bindings because
 * ES modules make imported bindings read-only for the importer: a module that
 * needs to *reassign* `currentBoardId` could not do so through a plain import.
 * Reading and writing through one object keeps every module working on the
 * same values, and makes it obvious at the call site that something is shared
 * state rather than a local.
 *
 * Anything that belongs to a single module (the block designer's selected
 * type, the connection picker's filter, the undo stacks) stays in that module
 * instead of here.
 */
export const state = {
  // --- document model -----------------------------------------------------
  boards: [],
  boardsData: {},
  currentBoardId: null,
  notebooks: [],              // [{id, name, collapsed}]
  customTypes: {},            // typeId -> {id,name,accent,width,fields:[...]}

  // --- selection ----------------------------------------------------------
  selection: new Set(),       // ids of selected boxes
  selectedConnId: null,

  // --- viewport and interaction -------------------------------------------
  view: { x: 0, y: 0, scale: 1 },
  cursorCanvas: { x: 2100, y: 1500 },
  dragState: null,
  clipboardNode: null,

  // --- measured layout, refreshed on every render --------------------------
  itemOffsets: {},            // nodeId -> [y offset of each list/week row]
  groupOffsets: {},           // nodeId -> { "g:field:idx": yOffset }

  // --- storage ------------------------------------------------------------
  backend: "memory",          // folder | cloud | app | memory
  rootHandle: null,           // folder the user picked
  dirHandle: null,            // <root>/saved-boards
  saveTimers: {},

  /* Boards whose stored payload existed but could not be parsed. They are
     never written back, so a damaged file is not replaced by an empty one. */
  corruptBoards: new Set(),
  corruptPrompted: new Set(),

  // --- cloud --------------------------------------------------------------
  supabaseClient: null,
  supabaseSession: null,
};
