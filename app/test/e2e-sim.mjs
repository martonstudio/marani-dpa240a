#!/usr/bin/env node
/**
 * Browser smoke test for the DPA Control page (Playwright, headless Chromium).
 *
 *   node test/e2e-sim.mjs <baseUrl> [sim|bridge] [screenshot.png]
 *
 * sim:    uses the in-page simulated unit.
 * bridge: uses the page's Bridge transport (ws://<page host>/ws), i.e. the real unit. Every value changed is
 *         restored before disconnecting (full push of the state read at connect, checked by read-back), also on failure.
 *         Note: the test toggles Out 1 mute, so Out 1 is briefly un-muted when it starts muted.
 *
 * Exit code 0 = all checks passed.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const base = process.argv[2] ?? "http://localhost:4173/";
const kind = process.argv[3] ?? "sim";
const shotPath = process.argv[4];
if (!["sim", "bridge"].includes(kind)) throw new Error("transport must be sim or bridge");

const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
const fail = (m) => {
  throw new Error(m);
};
const T = kind === "bridge" ? 60000 : 15000;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => m.type() === "error" && pageErrors.push("console: " + m.text()));

const tid = (id) => page.locator(`[data-testid="${id}"]`);
const get = (ch, key) =>
  page.evaluate(([c, k]) => {
    const d = window.dpa;
    return d.model.get(d.dev.channels.find((x) => x.id === c), k);
  }, [ch, key]);
/** Wait until a model value satisfies pred (values come from read-back). */
async function waitValue(ch, key, pred, what) {
  const t0 = Date.now();
  for (;;) {
    const v = await get(ch, key);
    if (pred(v)) return v;
    if (Date.now() - t0 > T) fail(`timeout waiting for ${ch}.${key} ${what} (now ${v})`);
    await page.waitForTimeout(50);
  }
}
/** Wait until no edits are in flight (model has nothing queued) and the value has been stable for a moment. */
async function settle(ch, key) {
  let last = await get(ch, key);
  for (let i = 0; i < 100; i++) {
    await page.waitForTimeout(kind === "bridge" ? 400 : 150);
    const v = await get(ch, key);
    if (v === last) return v;
    last = v;
  }
  return last;
}

let initial = null;
let connected = false;
let presetName = null;
let ok = false;
try {
  await page.goto(base);
  await tid("transport-select").selectOption(kind);
  log("connect via", kind);
  await tid("connect").click();
  await page.waitForSelector('[data-testid="status"][data-state="connected"]', { timeout: T });
  connected = true;
  initial = await page.evaluate(() => Array.from(window.dpa.model.mem));
  log("state loaded", initial.length, "bytes");
  if (initial.length !== 0x160) fail("state size");

  // 1. Out 1 gain: drag the fader up
  const g0 = await get("out1", "gain");
  await tid("strip-out1-gain").scrollIntoViewIfNeeded();
  const fb = await tid("strip-out1-gain").boundingBox();
  const cx = fb.x + fb.width / 2, cy = fb.y + fb.height / 2;
  const dir = g0 > 150 ? 1 : -1; // move away from the nearest end
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - dir * 30, { steps: 6 });
  await page.mouse.up();
  const g1 = await settle("out1", "gain");
  if (g1 === g0) fail("gain did not change");
  const shown = await tid("strip-out1-gain-value").textContent();
  const expectText = await page.evaluate(([v]) => {
    const d = window.dpa;
    return d.display(d.fieldOf(d.dev.channels.find((x) => x.id === "out1"), "gain"), v);
  }, [g1]);
  if (shown !== expectText) fail(`gain readout ${shown} != ${expectText}`);
  log(`gain ${g0} -> ${g1} (shown ${shown})`);

  // 2. Out 1 mute: toggle
  const m0 = await get("out1", "mute");
  await tid("strip-out1-mute").click();
  const m1 = await waitValue("out1", "mute", (v) => v !== m0, "to toggle");
  const pressed = await tid("strip-out1-mute").getAttribute("aria-pressed");
  if (pressed !== (m1 ? "true" : "false")) fail("mute button does not show read-back");
  log(`mute ${m0} -> ${m1}`);

  // 3. PEQ band 1 handle drag on Out 1's graph
  await tid("strip-out1-select").click();
  const f0 = await get("out1", "peq1.freq"), pg0 = await get("out1", "peq1.gain");
  await tid("eq-out1").scrollIntoViewIfNeeded();
  const hb = await tid("eq-handle-out1-peq1").boundingBox();
  const hx = hb.x + hb.width / 2, hy = hb.y + hb.height / 2;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx + 80, hy - 40, { steps: 8 });
  await page.mouse.up();
  await settle("out1", "peq1.gain");
  const f1 = await settle("out1", "peq1.freq"), pg1 = await get("out1", "peq1.gain");
  if (f1 <= f0 || pg1 <= pg0) fail(`PEQ drag did not raise freq and gain (${f0}->${f1}, ${pg0}->${pg1})`);
  const boxGain = await tid("detail-out1-peq1-gain").inputValue();
  log(`peq1 freq ${f0} -> ${f1}, gain ${pg0} -> ${pg1} (box ${boxGain})`);
  await page.waitForTimeout(1700); // let the handle settle onto the read-back
  if (shotPath) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: shotPath });
    log("screenshot", shotPath);
  }

  // 4. save a preset of this state
  presetName = `e2e-${Date.now()}`;
  await tid("preset-save").click();
  await tid("modal-input").fill(presetName);
  await tid("modal-ok").click();
  await tid(`preset-item-${presetName}`).waitFor({ timeout: 5000 });
  log("saved preset", presetName);

  // 5. change gain again (keyboard on the fader), so recall has something to do
  await tid("strip-out1-gain").focus();
  const key = g1 + 5 <= 180 ? "ArrowUp" : "ArrowDown";
  for (let i = 0; i < 5; i++) await page.keyboard.press(key);
  const g2 = await settle("out1", "gain");
  if (g2 === g1) fail("keyboard gain change did not reach the unit");
  log(`gain ${g1} -> ${g2} (keyboard)`);

  // 6. recall the preset
  await tid(`preset-item-${presetName}`).click();
  await tid("preset-recall").click();
  await tid("modal-ok").click();
  await tid("preset-report-summary").waitFor({ timeout: T * 2 });
  const summary = await tid("preset-report-summary").textContent();
  log("recall:", summary);
  if (!/remaining differences 0/.test(summary)) fail("recall left differences");
  if ((await get("out1", "gain")) !== g1) fail("recall did not restore gain");
  if ((await get("out1", "mute")) !== m1) fail("recall changed mute");
  if ((await get("out1", "peq1.freq")) !== f1) fail("recall changed peq1");

  // 7. diff vs unit is empty
  await tid("preset-diff").click();
  const diffTxt = await tid("preset-diff-summary").textContent();
  if (!/matches/.test(diffTxt)) fail("diff after recall: " + diffTxt);
  log("diff:", diffTxt);
  ok = true;
} catch (e) {
  console.error("FAIL:", e.message);
} finally {
  // restore the state read at connect (always for bridge; also for sim, to exercise the path)
  if (connected && initial) {
    try {
      const rep = await page.evaluate(async (init) => {
        const d = window.dpa;
        const r = await d.pushImage(d.model, Uint8Array.from(init));
        d.app.ctx.renderAll();
        return { sent: r.sent.length, remaining: r.remaining.length, same: Array.from(d.model.mem).every((b, i) => b === init[i]) };
      }, initial);
      log(`restore: sent ${rep.sent}, remaining ${rep.remaining}, memory identical to start: ${rep.same}`);
      if (rep.remaining || !rep.same) ((ok = false), console.error("FAIL: restore incomplete"));
    } catch (e) {
      ok = false;
      console.error("FAIL: restore threw", e.message);
    }
  }
  if (presetName) {
    try {
      await tid(`preset-item-${presetName}`).click();
      await tid("preset-delete").click();
      await tid("modal-ok").click();
      await tid(`preset-item-${presetName}`).waitFor({ state: "detached", timeout: 3000 });
    } catch {}
  }
  if (connected) {
    await tid("connect").click(); // Disconnect
    await page.waitForSelector('[data-testid="status"][data-state="disconnected"]', { timeout: 10000 }).catch(() => ((ok = false), console.error("FAIL: did not disconnect")));
    log("disconnected");
  }
  if (pageErrors.length) {
    ok = false;
    console.error("page errors:\n  " + pageErrors.join("\n  "));
  }
  await browser.close();
  log(ok ? "PASS" : "FAILED");
  process.exit(ok ? 0 : 1);
}
