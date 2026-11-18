import { h } from "./dom.ts";
import type { LogFn } from "../protocol/session.ts";

const MAX = 600;

/** Collapsible frame log (tx/rx/info/error from the Session). */
export function logPanel(): { el: HTMLElement; log: LogFn } {
  const list = h("div", { class: "log-list", testid: "log-list" });
  const count = h("span", { class: "log-count" }, "0");
  let n = 0;
  const toggleBtn = h("button", { class: "log-toggle", testid: "log-toggle", "aria-expanded": "false" }, "Frame log ", count);
  const clearBtn = h("button", { class: "btn small", testid: "log-clear", onclick: () => ((list.textContent = ""), (n = 0), (count.textContent = "0")) }, "Clear");
  const el = h("section", { class: "log collapsed", testid: "log" }, h("div", { class: "log-bar" }, toggleBtn, clearBtn), list);
  toggleBtn.addEventListener("click", () => {
    const open = el.classList.toggle("collapsed") === false;
    toggleBtn.setAttribute("aria-expanded", String(open));
    if (open) list.scrollTop = list.scrollHeight;
  });
  const log: LogFn = (kind, text) => {
    const t = new Date();
    const ts = `${String(t.getMinutes()).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")}.${String(t.getMilliseconds()).padStart(3, "0")}`;
    const stick = list.scrollTop + list.clientHeight >= list.scrollHeight - 4;
    list.append(h("div", { class: `log-line ${kind}` }, h("span", { class: "ts" }, ts), h("span", { class: "kind" }, kind), h("span", { class: "txt" }, text)));
    while (list.childElementCount > MAX) list.firstElementChild!.remove();
    count.textContent = String(++n);
    if (stick) list.scrollTop = list.scrollHeight;
  };
  return { el, log };
}
