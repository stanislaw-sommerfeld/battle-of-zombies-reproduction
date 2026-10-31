// Small DOM helpers shared by the UI modules.

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Escapes and keeps line breaks. */
export const escLines = (s: string) => esc(s).replace(/\n/g, "<br/>");

/** Offers `text` as a file download. */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Opens a file picker and resolves with the chosen file's text (undefined if cancelled). */
export function pickTextFile(accept = ".json,application/json"): Promise<string | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", async () => {
      const f = input.files?.[0];
      input.remove();
      if (!f) return resolve(undefined);
      if (f.size > 5_000_000) return resolve("");
      resolve(await f.text());
    });
    input.addEventListener("cancel", () => {
      input.remove();
      resolve(undefined);
    });
    input.click();
  });
}

/** File-name-safe timestamp, e.g. 2026-10-31_14-05. */
export const stamp = (d = new Date()) => d.toISOString().slice(0, 16).replace("T", "_").replace(":", "-");

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const h = Math.floor(m / 60);
  return h ? `${h} h ${String(m % 60).padStart(2, "0")}` : `${m} min`;
}

/**
 * Two-step confirmation for destructive buttons: the first click arms the
 * button and changes its label, a second click within 3 s runs `fn`.
 */
export function armButton(btn: HTMLElement, confirmLabel: string, fn: () => void): void {
  const label = btn.innerHTML;
  let armed = false;
  let timer = 0;
  btn.addEventListener("click", () => {
    if (armed) {
      clearTimeout(timer);
      fn();
      return;
    }
    armed = true;
    btn.classList.add("armed");
    btn.textContent = confirmLabel;
    timer = window.setTimeout(() => {
      armed = false;
      btn.classList.remove("armed");
      btn.innerHTML = label;
    }, 3000);
  });
}
