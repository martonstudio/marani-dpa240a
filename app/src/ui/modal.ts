import { h } from "./dom.ts";

/** In-page dialogs (no window.prompt/confirm). */
function overlay(content: HTMLElement): { close(): void; el: HTMLElement } {
  const el = h("div", { class: "modal-back" }, h("div", { class: "modal", role: "dialog", "aria-modal": "true" }, content));
  document.body.append(el);
  return { el, close: () => el.remove() };
}

export function askText(title: string, initial = "", okLabel = "Save"): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h("input", { type: "text", class: "modal-input", testid: "modal-input", value: initial, maxlength: 64 });
    const done = (v: string | null) => {
      o.close();
      resolve(v);
    };
    const form = h(
      "form",
      { class: "modal-body", onsubmit: (e: Event) => (e.preventDefault(), input.value.trim() && done(input.value.trim())) },
      h("h3", {}, title),
      input,
      h("div", { class: "modal-actions" }, h("button", { type: "button", class: "btn", testid: "modal-cancel", onclick: () => done(null) }, "Cancel"), h("button", { type: "submit", class: "btn primary", testid: "modal-ok" }, okLabel)),
    );
    const o = overlay(form);
    o.el.addEventListener("keydown", (e) => e.key === "Escape" && done(null));
    setTimeout(() => (input.focus(), input.select()), 0);
  });
}

export function confirmBox(title: string, body: string, okLabel = "OK"): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (v: boolean) => {
      o.close();
      resolve(v);
    };
    const o = overlay(
      h(
        "div",
        { class: "modal-body" },
        h("h3", {}, title),
        h("p", {}, body),
        h("div", { class: "modal-actions" }, h("button", { class: "btn", testid: "modal-cancel", onclick: () => done(false) }, "Cancel"), h("button", { class: "btn primary", testid: "modal-ok", onclick: () => done(true) }, okLabel)),
      ),
    );
  });
}
