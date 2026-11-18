import { h, clear } from "./dom.ts";
import type { Ctx } from "./ctx.ts";
import { askText, confirmBox } from "./modal.ts";
import type { PresetStore } from "../presets/types.ts";
import { presetMemory, snapshot, validatePreset } from "../presets/types.ts";
import { diffImages, pushImage, type FieldDiff, type PushReport } from "../presets/push.ts";
import { channelOf, display, fieldOf } from "../devices/logic.ts";

/** Preset sidebar: list, save, recall (push + read-back report), diff vs unit, export, import, delete. */
export function presetSidebar(ctx: Ctx, store: PresetStore, setBusy: (busy: boolean, why?: string) => void): { el: HTMLElement; refresh(): Promise<void>; setConnected(c: boolean): void } {
  let selected: string | null = null;
  let connected = false;
  const list = h("ul", { class: "preset-list", testid: "preset-list" });
  const report = h("div", { class: "report", testid: "preset-report" });
  const bar = h("div", { class: "progress-fill" });
  const progLabel = h("div", { class: "progress-label", testid: "preset-progress-label" });
  const prog = h("div", { class: "progress", testid: "preset-progress", hidden: true }, h("div", { class: "progress-track" }, bar), progLabel);
  const fileIn = h("input", { type: "file", accept: ".json,application/json", testid: "preset-import-file", hidden: true });

  const btn = (id: string, text: string, fn: () => void, cls = "btn") => h("button", { class: cls, testid: id, onclick: fn }, text);
  const saveBtn = btn("preset-save", "Save current", () => void save(), "btn primary");
  const importBtn = btn("preset-import", "Import", () => fileIn.click());
  const recallBtn = btn("preset-recall", "Recall to unit", () => void recall(), "btn accent");
  const diffBtn = btn("preset-diff", "Diff vs unit", () => void diff());
  const exportBtn = btn("preset-export", "Export", () => void exportP());
  const delBtn = btn("preset-delete", "Delete", () => void del(), "btn danger");
  const sel = h("div", { class: "preset-sel", testid: "preset-selected" }, "No preset selected");

  const update = () => {
    const has = selected !== null;
    saveBtn.disabled = !connected;
    recallBtn.disabled = !has || !connected;
    diffBtn.disabled = !has || !connected;
    exportBtn.disabled = !has;
    delBtn.disabled = !has;
    sel.textContent = has ? selected! : "No preset selected";
    for (const li of list.children) li.classList.toggle("sel", (li as HTMLElement).dataset.name === selected);
  };

  async function refresh() {
    const names = await store.list();
    if (selected && !names.includes(selected)) selected = null;
    clear(list);
    if (!names.length) list.append(h("li", { class: "empty" }, "No presets yet"));
    for (const n of names)
      list.append(h("li", { "data-name": n }, h("button", { class: "preset-item", testid: `preset-item-${n}`, onclick: () => ((selected = n), update()) }, n)));
    update();
  }

  const say = (...nodes: (Node | string)[]) => {
    clear(report);
    report.append(...nodes);
  };
  const fmt = (d: FieldDiff, v: number) => {
    if (Number.isNaN(v)) return "text";
    try {
      return display(fieldOf(channelOf(ctx.dev, d.channel), d.key), v);
    } catch {
      return String(v);
    }
  };
  const diffList = (ds: FieldDiff[], aName: string, bName: string) =>
    h("ul", { class: "diff-list" }, ...ds.map((d) => h("li", {}, h("b", {}, `${channelOf(ctx.dev, d.channel).name} ${d.key}`), ` ${aName} ${fmt(d, d.a)} → ${bName} ${fmt(d, d.b)}`, d.settable ? "" : h("span", { class: "tag" }, "not settable"))));

  async function save() {
    const mem = ctx.model?.mem;
    if (!mem) return;
    const name = await askText("Save current unit state as preset", selected ?? "");
    if (!name) return;
    const existing = await store.list();
    if (existing.includes(name) && !(await confirmBox("Overwrite preset?", `"${name}" exists. Replace it with the current state?`, "Overwrite"))) return;
    await store.save(snapshot(ctx.dev, mem, name));
    selected = name;
    await refresh();
    say(`Saved "${name}".`);
  }

  async function recall() {
    const m = ctx.model;
    if (!m || !selected) return;
    const name = selected;
    const target = presetMemory(await store.load(name));
    const pending = diffImages(ctx.dev, m.mem!, target).filter((d) => d.settable).length;
    if (!(await confirmBox(`Recall "${name}"?`, `Sends ${pending} changed value${pending === 1 ? "" : "s"} to the unit, then reads the whole state back.`, "Recall"))) return;
    setBusy(true, `Recalling ${name}`);
    prog.hidden = false;
    bar.style.width = "0%";
    let rep: PushReport | null = null;
    try {
      rep = await pushImage(m, target, {
        onProgress: (done, total, label) => {
          bar.style.width = `${total ? (done / total) * 100 : 100}%`;
          progLabel.textContent = `${done}/${total} ${label}`;
        },
      });
    } catch (e) {
      say(h("div", { class: "rep-bad" }, `Recall failed: ${(e as Error).message}`));
    } finally {
      prog.hidden = true;
      setBusy(false);
      ctx.renderAll();
    }
    if (!rep) return;
    const notOk = rep.sent.filter((r) => !r.ok).length;
    say(
      h("div", { class: rep.remaining.length || notOk ? "rep-bad" : "rep-ok", testid: "preset-report-summary" }, `Recalled "${name}": sent ${rep.sent.length}${notOk ? ` (${notOk} not confirmed)` : ""}, remaining differences ${rep.remaining.length}`),
      rep.remaining.length ? diffList(rep.remaining, "unit", "preset") : "",
      rep.notPushed.length ? h("div", { class: "rep-sub" }, `Not pushed (unit cannot take these by command): ${rep.notPushed.length}`) : "",
      rep.notPushed.length ? diffList(rep.notPushed, "unit", "preset") : "",
    );
  }

  async function diff() {
    const mem = ctx.model?.mem;
    if (!mem || !selected) return;
    const ds = diffImages(ctx.dev, mem, presetMemory(await store.load(selected)));
    say(ds.length ? h("div", {}, h("div", { class: "rep-sub", testid: "preset-diff-summary" }, `${ds.length} difference${ds.length === 1 ? "" : "s"} unit vs "${selected}"`), diffList(ds, "unit", "preset")) : h("div", { class: "rep-ok", testid: "preset-diff-summary" }, `Unit matches "${selected}".`));
  }

  async function exportP() {
    if (!selected) return;
    const p = await store.load(selected);
    const url = URL.createObjectURL(new Blob([JSON.stringify(p, null, 2)], { type: "application/json" }));
    const a = h("a", { href: url, download: `${p.name.replace(/[^\w.-]+/g, "_")}.dpa.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  fileIn.addEventListener("change", async () => {
    const f = fileIn.files?.[0];
    fileIn.value = "";
    if (!f) return;
    try {
      const p = validatePreset(ctx.dev, JSON.parse(await f.text()));
      if ((await store.list()).includes(p.name) && !(await confirmBox("Overwrite preset?", `"${p.name}" exists. Replace it with the imported file?`, "Overwrite"))) return;
      await store.save(p);
      selected = p.name;
      await refresh();
      say(`Imported "${p.name}".`);
    } catch (e) {
      say(h("div", { class: "rep-bad" }, `Import failed: ${(e as Error).message}`));
    }
  });

  async function del() {
    if (!selected) return;
    if (!(await confirmBox("Delete preset?", `Delete "${selected}" from this browser? (The unit is not touched.)`, "Delete"))) return;
    await store.remove(selected);
    say(`Deleted "${selected}".`);
    selected = null;
    await refresh();
  }

  const el = h(
    "aside",
    { class: "presets", testid: "presets" },
    h("h2", {}, "Presets", h("small", {}, " stored in this browser")),
    h("div", { class: "row" }, saveBtn, importBtn, fileIn),
    list,
    sel,
    h("div", { class: "grid2" }, recallBtn, diffBtn, exportBtn, delBtn),
    prog,
    report,
  );
  return {
    el,
    refresh,
    setConnected(c) {
      connected = c;
      update();
    },
  };
}
