import { CONN_SIDES, CONN_COLOR_DEFAULT, CONN_WIDTH_DEFAULT, CONN_COLOR_DARK_MAP } from "./constants.js";

/* How a connection looks, kept apart from where it goes.
 *
 * A stored connection carries only the style properties that differ from the
 * default, and a missing property means the default:
 *
 *   route       "elbow" | "curve"        (absent: a straight line)
 *   startArrow  true                     (absent: no arrowhead at the start)
 *   endArrow    false                    (absent: an arrowhead at the end)
 *   dash        "dashed" | "dotted"      (absent: solid)
 *   color       "#rrggbb"                (absent: CONN_COLOR_DEFAULT)
 *   width       number                   (absent: CONN_WIDTH_DEFAULT)
 *   fromSide /  "t" | "r" | "b" | "l"    (absent or null: automatic)
 *   toSide
 *
 * Storing only the differences is what keeps every connection saved before
 * these properties existed -- and every plain new one -- byte-identical to
 * before, in board files, exports, undo snapshots and the cloud. It is also why
 * everything here is a pure function with no DOM or state: the same
 * sanitising has to run on data that came from a hand-edited or damaged file.
 */

export const CONN_STYLE_KEYS = ["route","startArrow","endArrow","dash","color","width","fromSide","toSide"];

const HEX6 = /^#[0-9a-f]{6}$/i;

/* The canonical stored form of whatever style properties `raw` carries:
   unknown keys and invalid values are dropped, and a value equal to its
   default is dropped too. Safe to call on a whole connection object. */
export function sanitizeConnStyle(raw){
  const out = {};
  if(!raw || typeof raw!=="object") return out;
  if(raw.route==="elbow" || raw.route==="curve") out.route = raw.route;
  if(raw.startArrow===true) out.startArrow = true;
  if(raw.endArrow===false) out.endArrow = false;
  if(raw.dash==="dashed" || raw.dash==="dotted") out.dash = raw.dash;
  if(typeof raw.color==="string" && HEX6.test(raw.color) && raw.color.toLowerCase()!==CONN_COLOR_DEFAULT){
    out.color = raw.color.toLowerCase();
  }
  if(typeof raw.width==="number" && isFinite(raw.width) && raw.width>=0.5 && raw.width<=12 && raw.width!==CONN_WIDTH_DEFAULT){
    out.width = raw.width;
  }
  if(CONN_SIDES.indexOf(raw.fromSide)!==-1) out.fromSide = raw.fromSide;
  if(CONN_SIDES.indexOf(raw.toSide)!==-1) out.toSide = raw.toSide;
  return out;
}

/* Every property resolved to a concrete value. */
export function connStyleOf(conn){
  const s = sanitizeConnStyle(conn);
  return {
    route: s.route || "straight",
    startArrow: s.startArrow===true,
    endArrow: s.endArrow!==false,
    dash: s.dash || "solid",
    color: s.color || CONN_COLOR_DEFAULT,
    width: s.width || CONN_WIDTH_DEFAULT,
    fromSide: s.fromSide || null,
    toSide: s.toSide || null,
  };
}

/* Apply `patch` to a connection in place, keeping it canonical: setting a
   property back to its default (or to null, for a side) removes it. */
export function setConnStyle(conn, patch){
  const next = sanitizeConnStyle({ ...conn, ...patch });
  CONN_STYLE_KEYS.forEach(k=>{ delete conn[k]; });
  Object.assign(conn, next);
  return conn;
}

/* Dash pattern in user units, scaled with the line so a thick dashed line
   does not turn into a row of slivers. Dots are zero-length dashes that the
   round linecap (set by the caller) swells to the line's own width. */
export function dashArray(dash, width){
  if(dash==="dashed") return (width*3.5)+" "+(width*2.5);
  if(dash==="dotted") return "0.01 "+(width*2.2);
  return null;
}

/* The colour to draw `hex` in. The default grey is deliberately the same in
   both themes (it always was); the palette colours lift in dark mode. */
export function themedConnColor(hex, dark){
  if(!dark) return hex;
  return CONN_COLOR_DARK_MAP[hex.toLowerCase()] || hex;
}
