import type { DeviceDefinition, ChannelDef } from "../devices/types.ts";
import { readText } from "../devices/logic.ts";
import type { Transport } from "../transport/types.ts";
import { WebSerialTransport } from "../transport/webserial.ts";
import { WebSocketTransport } from "../transport/websocket.ts";
import { SimTransport, SIM_DEFAULT_STATE } from "../transport/sim.ts";
import { openDevice } from "../core.ts";
import type { DeviceModel } from "../model/store.ts";
import type { PresetStore } from "../presets/types.ts";
import { h } from "./dom.ts";
import { Ctx } from "./ctx.ts";
import { channelStrip } from "./strip.ts";
import { detailPanel } from "./detail.ts";
import { presetSidebar } from "./presets.ts";
import { logPanel } from "./log.ts";

export type ConnState = "disconnected" | "connecting" | "loading" | "connected" | "lost" | "error";
type Kind = "usb" | "bridge" | "sim";

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

export class App {
  readonly ctx: Ctx;
  state: ConnState = "disconnected";
  sim: SimTransport | null = null;
  private transport: Transport | null = null;
  private statusEl: HTMLElement;
  private connectBtn: HTMLButtonElement;
  private kindSel: HTMLSelectElement;
  private urlIn: HTMLInputElement;
  private loadBar: HTMLElement;
  private loadFill: HTMLElement;
  private toastEl: HTMLElement;
  private presetNameEl: HTMLElement;
  private details = new Map<string, HTMLElement>();
  private strips = new Map<string, HTMLElement>();
  private presets: ReturnType<typeof presetSidebar>;
  private logp = logPanel();
  private main: HTMLElement;
  selectedChannel: string | null = null;

  constructor(readonly dev: DeviceDefinition, root: HTMLElement, presetStore: PresetStore) {
    this.ctx = new Ctx(dev);
    this.ctx.onError = (m) => this.toast(m);
    const params = new URLSearchParams(location.search);
    const kinds: [Kind, string][] = [];
    if (WebSerialTransport.supported()) kinds.push(["usb", "USB (Web Serial)"]);
    kinds.push(["bridge", "Bridge"], ["sim", "Simulator"]);
    this.kindSel = h("select", { class: "conn-kind", testid: "transport-select", "aria-label": "Connection" }, ...kinds.map(([v, l]) => h("option", { value: v }, l)));
    const want = params.get("transport") ?? store.get("dpa.transport");
    if (want && kinds.some(([k]) => k === want)) this.kindSel.value = want;
    this.urlIn = h("input", { type: "text", class: "conn-url", testid: "bridge-url", "aria-label": "Bridge URL", value: params.get("url") ?? store.get("dpa.url") ?? `ws://${location.host}/ws` });
    const syncKind = () => {
      this.urlIn.hidden = this.kindSel.value !== "bridge";
      store.set("dpa.transport", this.kindSel.value);
    };
    this.kindSel.addEventListener("change", syncKind);
    syncKind();
    this.connectBtn = h("button", { class: "btn primary conn-btn", testid: "connect", onclick: () => void (this.state === "connected" ? this.disconnect() : this.connect()) }, "Connect");
    this.statusEl = h("span", { class: "pill", testid: "status", "data-state": "disconnected" }, "Disconnected");
    this.presetNameEl = h("span", { class: "unit-preset", testid: "unit-preset", title: "Preset name stored on the unit" });
    this.loadFill = h("div", { class: "load-fill" });
    this.loadBar = h("div", { class: "load-bar", testid: "load-progress", hidden: true }, this.loadFill);
    this.toastEl = h("div", { class: "toast", testid: "toast", hidden: true });

    const header = h(
      "header",
      { class: "topbar" },
      h("div", { class: "brand" }, h("span", { class: "logo" }, "DPA"), h("span", { class: "brand-name" }, "DPA Control")),
      h("div", { class: "unit" }, h("span", { class: "unit-name", testid: "device-name" }, dev.name), this.presetNameEl),
      h("div", { class: "conn" }, this.kindSel, this.urlIn, this.connectBtn, this.statusEl),
    );

    const stripsEl = h("div", { class: "strips", style: `--nch:${dev.channels.length}` });
    for (const ch of dev.channels) {
      const st = channelStrip(this.ctx, ch, (c) => this.select(c));
      this.strips.set(ch.id, st);
      stripsEl.append(st);
    }
    const detailsEl = h("div", { class: "details" });
    for (const ch of dev.channels) {
      const d = detailPanel(this.ctx, ch);
      this.details.set(ch.id, d);
      detailsEl.append(d);
    }
    const g = dev.globals.find((x) => x.scale.kind === "text");
    this.ctx.onMem((mem) => (this.presetNameEl.textContent = g ? readText(dev, mem, g) : ""));

    this.presets = presetSidebar(this.ctx, presetStore, (busy, why) => {
      document.body.classList.toggle("busy", busy);
      if (busy && why) this.setStatus("connected", why + "…");
      else if (!busy && this.state === "connected") this.setStatus("connected");
    });
    this.main = h("main", { class: "layout offline" }, h("div", { class: "workspace" }, stripsEl, detailsEl), this.presets.el);
    root.append(header, this.loadBar, this.main, this.logp.el, this.toastEl);
    void this.presets.refresh();
    this.select(dev.channels.find((c) => c.kind === "output") ?? dev.channels[0]);

    const bye = () => {
      const m = this.ctx.model;
      if (m) {
        m.session.disconnectNow(); // frame goes out now; the page may not live long enough for an echo
        void m.session.transport.close();
      }
    };
    window.addEventListener("pagehide", bye);
    window.addEventListener("beforeunload", bye);
  }

  select(ch: ChannelDef): void {
    this.selectedChannel = ch.id;
    for (const [id, d] of this.details) d.hidden = id !== ch.id;
    for (const [id, s] of this.strips) s.classList.toggle("selected", id === ch.id);
  }

  private setStatus(st: ConnState, text?: string): void {
    this.state = st;
    const labels: Record<ConnState, string> = { disconnected: "Disconnected", connecting: "Connecting…", loading: "Reading state…", connected: "Connected", lost: "Link lost", error: "Error" };
    this.statusEl.textContent = text ?? labels[st];
    this.statusEl.dataset.state = st;
    document.body.dataset.conn = st;
    const live = st === "connected";
    this.main.classList.toggle("offline", !live);
    this.connectBtn.textContent = live ? "Disconnect" : "Connect";
    this.connectBtn.classList.toggle("primary", !live);
    this.connectBtn.disabled = st === "connecting" || st === "loading";
    this.kindSel.disabled = this.urlIn.disabled = st !== "disconnected" && st !== "lost" && st !== "error";
    this.presets.setConnected(live);
  }

  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.hidden = false;
    clearTimeout((this.toastEl as any)._t);
    (this.toastEl as any)._t = setTimeout(() => (this.toastEl.hidden = true), 5000);
  }

  private makeTransport(kind: Kind): Transport {
    if (kind === "usb") return new WebSerialTransport(this.dev.baudRate);
    if (kind === "bridge") {
      store.set("dpa.url", this.urlIn.value);
      return new WebSocketTransport(this.urlIn.value.trim());
    }
    // the simulated unit keeps its memory across connections, like a real one
    this.sim = new SimTransport(this.dev, this.sim?.mem ?? SIM_DEFAULT_STATE);
    return this.sim;
  }

  async connect(): Promise<void> {
    if (this.state === "connecting" || this.state === "loading" || this.state === "connected") return;
    const kind = this.kindSel.value as Kind;
    this.setStatus("connecting");
    let model: DeviceModel | null = null;
    try {
      const t = this.makeTransport(kind);
      this.transport = t;
      t.onLost((reason) => this.lost(t, reason));
      model = await openDevice(this.dev, t, this.logp.log);
      this.ctx.model = model;
      model.onChange(() => this.ctx.renderAll());
      this.setStatus("loading");
      this.loadBar.hidden = false;
      this.loadFill.style.width = "0%";
      await model.load((done, total) => {
        this.loadFill.style.width = `${(done / total) * 100}%`;
        this.statusEl.textContent = `Reading state ${Math.round((done / total) * 100)}%`;
      });
      this.loadBar.hidden = true;
      this.setStatus("connected");
    } catch (e) {
      this.loadBar.hidden = true;
      this.logp.log("error", String((e as Error).message ?? e));
      this.ctx.model = null;
      if (model) await model.session.close().catch(() => {});
      else await this.transport?.close().catch(() => {});
      this.transport = null;
      this.setStatus("error", "Error: " + ((e as Error).message ?? e));
      this.toast("Connect failed: " + ((e as Error).message ?? e));
    }
  }

  async disconnect(): Promise<void> {
    const m = this.ctx.model;
    this.ctx.model = null;
    this.transport = null;
    if (m) await m.session.close().catch((e) => this.logp.log("error", String(e)));
    this.setStatus("disconnected");
  }

  private lost(t: Transport, reason: string): void {
    if (this.transport !== t) return;
    this.logp.log("error", "link lost: " + reason);
    const m = this.ctx.model;
    this.ctx.model = null;
    this.transport = null;
    if (m) {
      m.session.disconnectNow(); // best effort: the error may have been recoverable and the unit still connected
      m.session.markLost();
    }
    void t.close().catch(() => {});
    this.loadBar.hidden = true;
    this.setStatus("lost", "Link lost");
    this.toast("Link lost: " + reason);
  }
}
