import { h } from "./dom.ts";
import type { LogFn } from "../protocol/session.ts";

const MAX = 800;

/** Frame log (tx/rx/info/error from the Session), shown in the Log drawer. */
export function logPanel(): { el: HTMLElement; log: LogFn } {
  const list = h("div", { class: "log-list", testid: "log-list" });
  const count = h("span", { class: "log-count", testid: "log-count" }, "0 lines");
  let n = 0;
  const clearBtn = h("button", { class: "btn small", testid: "log-clear", onclick: () => ((list.textContent = ""), (n = 0), (count.textContent = "0 lines")) }, "Clear");
  const el = h("section", { class: "log", testid: "log" }, h("div", { class: "log-bar" }, count, clearBtn), list);
  const log: LogFn = (kind, text) => {
    const t = new Date();
    const ts = `${String(t.getMinutes()).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")}.${String(t.getMilliseconds()).padStart(3, "0")}`;
    const stick = list.scrollTop + list.clientHeight >= list.scrollHeight - 4;
    list.append(h("div", { class: `log-line ${kind}` }, h("span", { class: "ts" }, ts), h("span", { class: "kind" }, kind), h("span", { class: "txt" }, text)));
    while (list.childElementCount > MAX) list.firstElementChild!.remove();
    count.textContent = `${++n} lines`;
    if (stick) list.scrollTop = list.scrollHeight;
  };
  return { el, log };
}
