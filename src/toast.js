import { toastEl } from "./dom.js";

/* The transient status line in the bottom-right corner. */

let toastTimer = null;

export function showToast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>toastEl.classList.remove("show"), 1300);
}
