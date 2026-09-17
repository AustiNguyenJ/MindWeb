/* Element lookup, plus the handful of nodes the app holds on to.
 *
 * These are resolved at module load, which is safe because the entry is a
 * module script and therefore deferred until the document has been parsed.
 */

export const el = (id)=>document.getElementById(id);
export const viewport = el("viewport");
export const canvasInner = el("canvasInner");
export const connSvg = el("connSvg");
export const toastEl = el("toast");
export const imgFileInput = el("imgFileInput");
