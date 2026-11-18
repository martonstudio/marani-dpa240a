import { h } from "./dom.ts";

/** Right-hand slide-over drawer: overlay, closes on Esc, backdrop click or the close button. */
export function drawer(title: string, testid: string, content: HTMLElement): { el: HTMLElement; open(): void; close(): void; isOpen(): boolean } {
  const panel = h(
    "div",
    { class: "drawer-panel", role: "dialog", "aria-label": title },
    h("div", { class: "drawer-head" }, h("h2", {}, title), h("button", { class: "btn small icon", testid: `${testid}-close`, "aria-label": "Close", onclick: () => close() }, "×")),
    h("div", { class: "drawer-body" }, content),
  );
  const el = h("div", { class: "drawer", testid, "aria-hidden": "true" }, h("div", { class: "drawer-back", onclick: () => close() }), panel);
  const open = () => {
    el.classList.add("open");
    el.setAttribute("aria-hidden", "false");
  };
  const close = () => {
    el.classList.remove("open");
    el.setAttribute("aria-hidden", "true");
  };
  document.addEventListener("keydown", (e) => {
    // modals sit above drawers and handle their own Esc
    if (e.key === "Escape" && el.classList.contains("open") && !document.querySelector(".modal-back")) close();
  });
  return { el, open, close, isOpen: () => el.classList.contains("open") };
}
