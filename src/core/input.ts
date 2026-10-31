// Keyboard + mouse state with per-frame "pressed" edges.
// Actions are named; the code -> action map comes from player settings, so
// gameplay never looks at physical keys. Codes are KeyboardEvent.code values
// (layout-independent: "KeyW" is the key under Z on an AZERTY keyboard) plus
// "Mouse0" / "Mouse1" / "Mouse2" for mouse buttons.

export type Action =
  | "up" | "down" | "left" | "right"
  | "light" | "heavy" | "dodge" | "sprint"
  | "spell1" | "spell2" | "throw" | "use"
  | "interact" | "inventory" | "journal" | "pause" | "mute";

/** Display order in the controls screen. */
export const ACTIONS: Action[] = [
  "up", "down", "left", "right", "sprint", "dodge",
  "light", "heavy", "spell1", "spell2", "throw", "use",
  "interact", "inventory", "journal", "pause", "mute",
];

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  up: ["KeyW", "ArrowUp"],
  down: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  sprint: ["ShiftLeft", "ShiftRight"],
  dodge: ["Space"],
  light: ["Mouse0", "KeyK"],
  heavy: ["Mouse2", "KeyL"],
  spell1: ["KeyQ"],
  spell2: ["KeyR"],
  throw: ["KeyF"],
  use: ["KeyC"],
  interact: ["KeyE"],
  inventory: ["KeyI", "Tab"],
  journal: ["KeyJ"],
  pause: ["Escape"],
  mute: ["KeyM"],
};

/** Keys that would break the browser or the menus if they did something else. */
export const RESERVED_CODES = new Set(["F5", "F11", "F12", "MetaLeft", "MetaRight"]);

export class Input {
  private down = new Set<Action>();
  private pressed = new Set<Action>();
  private map = new Map<string, Action>();
  private bindings: Record<Action, string[]> = DEFAULT_BINDINGS;
  /** Learned from key events: physical code -> character printed on the user's key. */
  private printed = new Map<string, string>();
  mouseX = 0;
  mouseY = 0;
  mouseActive = false;
  /** When false (menus open), gameplay ignores input but UI keys still work. */
  enabled = true;
  /** While set, the next key or mouse button is handed here instead of acting (rebinding). */
  capture?: (code: string, ev: Event) => void;

  constructor(private canvas: HTMLCanvasElement) {
    this.setBindings(DEFAULT_BINDINGS);
    // Ask the browser for the real printed layout where supported (Chromium).
    const kb = (navigator as unknown as { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard;
    kb?.getLayoutMap?.()
      .then((m) => m.forEach((v, k) => this.printed.set(k, v.toUpperCase())))
      .catch(() => undefined);

    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key && e.key.length === 1 && e.code.startsWith("Key")) this.printed.set(e.code, e.key.toUpperCase());
        if (this.capture) {
          e.preventDefault();
          e.stopImmediatePropagation();
          const cb = this.capture;
          this.capture = undefined;
          cb(e.code, e);
          return;
        }
        const a = this.map.get(e.code);
        if (!a) return;
        if (e.code === "Tab" || e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
        if (!e.repeat) this.pressed.add(a);
        this.down.add(a);
      },
      true,
    );
    window.addEventListener("keyup", (e) => {
      const a = this.map.get(e.code);
      if (a) this.down.delete(a);
    });
    window.addEventListener("blur", () => this.down.clear());
    window.addEventListener(
      "mousedown",
      (e) => {
        if (!this.capture) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const cb = this.capture;
        this.capture = undefined;
        cb(`Mouse${e.button}`, e);
      },
      true,
    );
    canvas.addEventListener("mousemove", (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      this.mouseY = e.clientY - r.top;
      this.mouseActive = true;
    });
    canvas.addEventListener("mousedown", (e) => {
      const a = this.map.get(`Mouse${e.button}`);
      if (!a) return;
      if (e.button === 1) e.preventDefault();
      this.pressed.add(a);
      this.down.add(a);
    });
    window.addEventListener("mouseup", (e) => {
      const a = this.map.get(`Mouse${e.button}`);
      if (a) this.down.delete(a);
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  setBindings(b: Record<Action, string[]>): void {
    this.bindings = b;
    this.map.clear();
    for (const a of ACTIONS) for (const code of b[a] ?? []) if (!this.map.has(code)) this.map.set(code, a);
    this.down.clear();
  }

  actionFor(code: string): Action | undefined {
    return this.map.get(code);
  }

  codesFor(a: Action): string[] {
    return this.bindings[a] ?? [];
  }

  /** Human label for a code, using the user's printed layout when known. */
  label(code: string | undefined, mouseNames: [string, string, string], named: Record<string, string>): string {
    if (!code) return "—";
    if (code.startsWith("Mouse")) return mouseNames[Number(code.slice(5))] ?? code;
    if (named[code]) return named[code];
    const p = this.printed.get(code);
    if (p) return p;
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    if (code.startsWith("Numpad")) return "Num " + code.slice(6);
    return code;
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
