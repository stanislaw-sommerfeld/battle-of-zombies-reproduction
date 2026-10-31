// Keyboard + mouse state with per-frame "pressed" edges.
// Actions are named so bindings can change without touching gameplay code.

export type Action =
  | "up" | "down" | "left" | "right"
  | "light" | "heavy" | "dodge" | "sprint"
  | "spell1" | "spell2" | "throw" | "use"
  | "interact" | "inventory" | "journal" | "pause" | "mute";

const KEY_BINDINGS: Record<string, Action> = {
  KeyW: "up", ArrowUp: "up",
  KeyS: "down", ArrowDown: "down",
  KeyA: "left", ArrowLeft: "left",
  KeyD: "right", ArrowRight: "right",
  Space: "dodge",
  ShiftLeft: "sprint", ShiftRight: "sprint",
  KeyQ: "spell1",
  KeyR: "spell2",
  KeyF: "throw",
  KeyC: "use",
  KeyE: "interact",
  KeyI: "inventory", Tab: "inventory",
  KeyJ: "journal",
  Escape: "pause",
  KeyM: "mute",
  KeyK: "light",
  KeyL: "heavy",
};

export class Input {
  private down = new Set<Action>();
  private pressed = new Set<Action>();
  mouseX = 0;
  mouseY = 0;
  mouseActive = false;
  /** When false (menus open), gameplay ignores input but UI keys still work. */
  enabled = true;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      const a = KEY_BINDINGS[e.code];
      if (!a) return;
      if (e.code === "Tab" || e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
      if (!e.repeat) this.pressed.add(a);
      this.down.add(a);
    });
    window.addEventListener("keyup", (e) => {
      const a = KEY_BINDINGS[e.code];
      if (a) this.down.delete(a);
    });
    window.addEventListener("blur", () => this.down.clear());
    canvas.addEventListener("mousemove", (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      this.mouseY = e.clientY - r.top;
      this.mouseActive = true;
    });
    canvas.addEventListener("mousedown", (e) => {
      const a: Action | undefined = e.button === 0 ? "light" : e.button === 2 ? "heavy" : undefined;
      if (!a) return;
      this.pressed.add(a);
      this.down.add(a);
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.down.delete("light");
      if (e.button === 2) this.down.delete("heavy");
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  isDown(a: Action): boolean {
    return this.down.has(a);
  }
  wasPressed(a: Action): boolean {
    return this.pressed.has(a);
  }
  /** Programmatic input (used by automated smoke tests). */
  press(a: Action): void {
    this.pressed.add(a);
  }
  hold(a: Action, on: boolean): void {
    if (on) this.down.add(a);
    else this.down.delete(a);
  }
  endFrame(): void {
    this.pressed.clear();
  }
  get canvasEl(): HTMLCanvasElement {
    return this.canvas;
  }
}
