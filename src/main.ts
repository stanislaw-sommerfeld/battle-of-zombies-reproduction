// Boot: load the content bundle, create the game, run the loop.
import type { ContentBundle } from "./data/types.js";
import { Input } from "./core/input.js";
import { Game } from "./game.js";
import { Renderer } from "./render/renderer.js";
import { Ui } from "./ui/ui.js";
import { Sfx } from "./audio/sfx.js";

async function boot(): Promise<void> {
  const res = await fetch("data.bundle.json");
  if (!res.ok) throw new Error(`Could not load data.bundle.json (${res.status})`);
  const content = (await res.json()) as ContentBundle;

  const canvas = document.getElementById("game") as HTMLCanvasElement;
  const input = new Input(canvas);
  const game = new Game(content, window.localStorage);
  game.input = input;
  const renderer = new Renderer(canvas);
  const ui = new Ui(game);
  const sfx = new Sfx(game.bus);
  ui.onStart = () => {
    renderer.cam = { x: 0, y: 0 };
    game.mapDirty = true;
  };
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyM") game.toast(sfx.toggle() ? "Sound off" : "Sound on");
  });

  // exposed for debugging and automated smoke tests
  (window as unknown as { ashLedger: unknown }).ashLedger = { game, ui, input, renderer };

  let last = performance.now();
  let wasBlocking = true;
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // the key that closed a menu must not also act in the world
    if (wasBlocking && !ui.blocking) input.endFrame();
    wasBlocking = ui.blocking;
    if (ui.screen === "playing" && game.player) {
      input.enabled = !ui.blocking;
      // aim: mouse if used, otherwise movement direction
      if (input.mouseActive) game.aim = renderer.screenToWorld(input.mouseX, input.mouseY);
      else {
        const p = game.player;
        const mx = (input.isDown("right") ? 1 : 0) - (input.isDown("left") ? 1 : 0);
        const my = (input.isDown("down") ? 1 : 0) - (input.isDown("up") ? 1 : 0);
        if (mx || my) game.aim = { x: p.pos.x + mx * 60, y: p.pos.y + my * 60 };
        else if (!game.aim.x) game.aim = { x: p.pos.x, y: p.pos.y - 60 };
      }
      if (!ui.blocking) game.update(dt);
      renderer.draw(game, ui.blocking ? 0 : dt);
    }
    ui.update(dt);
    input.endFrame();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  document.getElementById("loading")?.remove();
}

boot().catch((e) => {
  console.error(e);
  const el = document.getElementById("loading");
  if (el) el.textContent = `Failed to start: ${e.message}`;
});
