// Turns bound key codes into labels for prompts, the HUD and the controls screen.
import type { Action, Input } from "../core/input.js";
import { t } from "./i18n.js";

/** Ability slots in data ("Q" / "R") are fixed names for the two spell actions. */
export const SPELL_ACTION: Record<string, Action> = { Q: "spell1", R: "spell2" };

export function codeLabel(input: Input | undefined, code: string | undefined): string {
  const named: Record<string, string> = {
    Space: t("key.space"),
    ShiftLeft: t("key.shift"),
    ShiftRight: t("key.shiftRight"),
    ControlLeft: t("key.ctrl"),
    ControlRight: t("key.ctrlRight"),
    AltLeft: "Alt",
    AltRight: "Alt Gr",
    Escape: t("key.esc"),
    Tab: t("key.tab"),
    Enter: t("key.enter"),
    Backspace: t("key.backspace"),
    ArrowUp: t("key.up"),
    ArrowDown: t("key.down"),
    ArrowLeft: t("key.left"),
    ArrowRight: t("key.right"),
    CapsLock: t("key.caps"),
  };
  const mouse: [string, string, string] = [t("key.mouse0"), t("key.mouse1"), t("key.mouse2")];
  if (!input) {
    if (!code) return "—";
    if (code.startsWith("Mouse")) return mouse[Number(code.slice(5))] ?? code;
    return named[code] ?? code.replace(/^(Key|Digit)/, "");
  }
  return input.label(code, mouse, named);
}

/** Label of the first key bound to an action ("—" if unbound). */
export function actionKey(input: Input | undefined, a: Action): string {
  return codeLabel(input, input?.codesFor(a)[0]);
}
