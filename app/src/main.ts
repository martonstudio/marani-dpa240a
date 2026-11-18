import "./ui/style.css";
import { DPA240A } from "./devices/dpa240a.ts";
import { App } from "./ui/app.ts";
import { IdbPresetStore } from "./presets/idbstore.ts";
import { pushImage, diffImages } from "./presets/push.ts";
import { snapshot, presetMemory } from "./presets/types.ts";
import { display, fieldOf, parseValue } from "./devices/logic.ts";

const app = new App(DPA240A, document.getElementById("app")!, new IdbPresetStore());

/** Hook for automated tests (Playwright) and the console. */
(window as any).dpa = {
  get model() {
    return app.ctx.model;
  },
  dev: DPA240A,
  app,
  get state() {
    return app.state;
  },
  pushImage,
  diffImages,
  snapshot,
  presetMemory,
  display,
  fieldOf,
  parseValue,
};
