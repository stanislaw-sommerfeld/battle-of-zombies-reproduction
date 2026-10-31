// Procedural drawing of a player character from a CharacterLook. Used by the
// world renderer, the HUD portrait and the character creator preview, so all
// three always agree. Units are world pixels; (x, y) is the actor's centre and
// the feet rest at y + 9.
import type { ContentBundle } from "../data/types.js";
import { raceOf, speciesOf, type CharacterLook } from "../character/look.js";

export interface DrawOpts {
  /** Facing angle in radians (0 = right, PI/2 = towards the viewer). */
  facing: number;
  /** Vertical breathing/stride offset for the upper body. */
  bob?: number;
  /** Stride phase in radians; legs alternate when moving. */
  walk?: number;
  moving?: boolean;
  /** Draw everything white (hit flash). */
  flash?: boolean;
  lantern?: boolean;
  /** Time in seconds, for flickering features. */
  t?: number;
}

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function bodyScale(look: CharacterLook): { hs: number; ws: number } {
  const bmi = look.weightKg / (look.heightCm / 100) ** 2;
  return { hs: clampN(look.heightCm / 175, 0.8, 1.16), ws: clampN(0.78 + (bmi - 16) * 0.035, 0.8, 1.3) };
}

export function shadeHex(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => clampN(Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt), 0, 255);
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export function drawCharacter(ctx: CanvasRenderingContext2D, c: ContentBundle, look: CharacterLook, x: number, y: number, o: DrawOpts): void {
  const sp = speciesOf(c, look);
  const race = raceOf(c, look);
  const outfit = c.cosmetics[look.outfit];
  const hairDef = c.cosmetics[look.hair];
  const mark = c.cosmetics[look.mark];
  const feats = new Set(sp.features ?? []);
  const featureColor = race.feature ?? "#ff8a2a";
  const { hs, ws: baseWs } = bodyScale(look);
  const shoulder = look.sex === "female" ? 0.93 : look.sex === "male" ? 1.05 : 1;
  const ws = baseWs * shoulder;
  const col = (v: string) => (o.flash ? "#ffffff" : v);
  const prim = look.clothPrimary;
  const sec = look.clothSecondary;
  const shape = outfit?.shape ?? "cloak";
  const hooded = look.hood && !!outfit?.hood;
  const dx = Math.cos(o.facing);
  const dy = Math.sin(o.facing);
  const back = dy < -0.55;
  const side = Math.abs(dx) > 0.8;
  const bob = o.bob ?? 0;
  const t = o.t ?? 0;

  ctx.save();
  ctx.translate(x, y + 9);
  ctx.scale(hs, hs);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // ---- legs (hidden under long garments, but give a stride)
  const stride = o.moving ? Math.sin(o.walk ?? 0) * 1.6 : 0;
  const legColor = shape === "jerkin" || shape === "wraps" ? sec : "#2a2420";
  ctx.fillStyle = col(shadeHex(legColor, -0.15));
  ctx.fillRect(-3.8 * baseWs, -8 - Math.max(0, stride), 3, 8);
  ctx.fillRect(0.8 * baseWs, -8 - Math.max(0, -stride), 3, 8);
  ctx.fillStyle = col("#1a1512");
  ctx.fillRect(-4.2 * baseWs, -1.6 - Math.max(0, stride), 3.6, 1.8);
  ctx.fillRect(0.6 * baseWs, -1.6 - Math.max(0, -stride), 3.6, 1.8);

  ctx.translate(0, bob);
  const headR = 5.6 * (sp.headScale ?? 1);
  const hx = side ? dx * 0.8 : 0;
  const hy = -24.5;

  // ---- hair that falls behind the body
  if (!hooded && hairDef) drawHairBack(ctx, hairDef.shape ?? "none", hx, hy, headR, col(look.hairColor), back);

  // ---- arms
  const armY = -14;
  const skin = col(look.skin);
  if (shape !== "cloak") {
    ctx.fillStyle = col(shadeHex(prim, -0.25));
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * 6.6 * ws, armY - stride * s * 0.4, 2.2, 5, s * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- body / outfit
  drawOutfit(ctx, shape, ws, col(prim), col(sec), col, back);

  // hands
  ctx.fillStyle = skin;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(s * (shape === "cloak" ? 5.5 : 6.8) * ws, -8.6 - stride * s * 0.4, 1.7, 0, Math.PI * 2);
    ctx.fill();
  }
  if (feats.has("embers") && !o.flash) glowDots(ctx, featureColor, [[-6.8 * ws, -8.6], [6.8 * ws, -8.6]], 0.9 + Math.sin(t * 3) * 0.2);

  // ---- neck + head
  ctx.fillStyle = col(shadeHex(look.skin, -0.12));
  ctx.fillRect(hx - 1.8, hy + headR - 2, 3.6, 3);
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(hx, hy, headR, 0, Math.PI * 2);
  ctx.fill();

  // ---- face
  if (!back) {
    if (!o.flash) drawFace(ctx, look, mark?.shape ?? "none", feats, featureColor, hx, hy, headR, dx, dy, side, t);
  }

  // ---- hair on top / hood
  if (hooded) drawHood(ctx, hx, hy, headR, col(shadeHex(prim, -0.2)), col(shadeHex(prim, -0.45)), back, dx, side);
  else if (hairDef) drawHairFront(ctx, hairDef.shape ?? "none", hx, hy, headR, col(look.hairColor), back, side, dx, t, o.flash ? undefined : featureColor);

  // ---- belt lantern
  if (o.lantern) {
    // hangs from the belt, in front of the hip rather than the hand
    const lx = -4.2 * ws;
    ctx.strokeStyle = col("#3a2c1c");
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(lx, -10.5);
    ctx.lineTo(lx, -8.6);
    ctx.stroke();
    ctx.fillStyle = col("#2a2016");
    ctx.fillRect(lx - 1.5, -8.8, 3, 3.8);
    ctx.fillStyle = col("#ffcf7a");
    ctx.fillRect(lx - 1, -8.2, 2, 2.6);
  }
  ctx.restore();
}

function drawOutfit(ctx: CanvasRenderingContext2D, shape: string, ws: number, prim: string, sec: string, col: (v: string) => string, back: boolean): void {
  const poly = (pts: number[][], fill: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
    ctx.closePath();
    ctx.fill();
  };
  switch (shape) {
    case "coat": {
      poly([[-6 * ws, -19.5], [6 * ws, -19.5], [7.6 * ws, -3], [-7.6 * ws, -3]], prim);
      ctx.strokeStyle = sec;
      ctx.lineWidth = 1.1;
      if (!back) {
        ctx.beginPath();
        ctx.moveTo(0, -18);
        ctx.lineTo(0, -3);
        ctx.stroke();
        poly([[-3.5 * ws, -19.5], [0, -14], [-1, -19.5]], col("#00000040"));
        poly([[3.5 * ws, -19.5], [0, -14], [1, -19.5]], col("#00000040"));
      }
      ctx.fillStyle = sec;
      ctx.fillRect(-7 * ws, -11, 14 * ws, 1.8);
      break;
    }
    case "robe": {
      poly([[-5.6 * ws, -19.5], [5.6 * ws, -19.5], [9 * ws, 0], [-9 * ws, 0]], prim);
      ctx.fillStyle = sec;
      ctx.fillRect(-9 * ws, -2, 18 * ws, 2);
      ctx.strokeStyle = sec;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-5 * ws, -18);
      ctx.lineTo(5.5 * ws, -9);
      ctx.stroke();
      break;
    }
    case "jerkin": {
      poly([[-6 * ws, -19.5], [6 * ws, -19.5], [5.6 * ws, -8.5], [-5.6 * ws, -8.5]], prim);
      ctx.fillStyle = col("#3a2a1a");
      ctx.fillRect(-5.8 * ws, -10.5, 11.6 * ws, 2);
      ctx.fillStyle = col("#c9a24a");
      ctx.fillRect(-0.9, -10.6, 1.8, 2.2);
      if (!back) {
        ctx.strokeStyle = col("#00000055");
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(0, -19);
        ctx.lineTo(0, -11);
        ctx.stroke();
      }
      break;
    }
    case "wraps": {
      poly([[-5.8 * ws, -19.5], [5.8 * ws, -19.5], [5.4 * ws, -6], [-5.4 * ws, -6]], prim);
      ctx.strokeStyle = sec;
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(-5.6 * ws, -18 + i * 3.4);
        ctx.lineTo(5.6 * ws, -15.6 + i * 3.4);
        ctx.stroke();
      }
      break;
    }
    default: {
      // cloak: the original silhouette, a teardrop from the shoulders to the ankles
      ctx.fillStyle = prim;
      ctx.beginPath();
      ctx.moveTo(-10 * ws, -1);
      ctx.quadraticCurveTo(-11 * ws, -17, 0, -21);
      ctx.quadraticCurveTo(11 * ws, -17, 10 * ws, -1);
      ctx.quadraticCurveTo(0, 1, -10 * ws, -1);
      ctx.fill();
      if (!back) {
        ctx.fillStyle = sec;
        ctx.beginPath();
        ctx.arc(0, -18.5, 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = col("#00000040");
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(0, -17);
        ctx.lineTo(0, -1);
        ctx.stroke();
      }
    }
  }
}

function drawFace(
  ctx: CanvasRenderingContext2D,
  look: CharacterLook,
  mark: string,
  feats: Set<string>,
  featureColor: string,
  hx: number,
  hy: number,
  r: number,
  dx: number,
  dy: number,
  side: boolean,
  t: number,
): void {
  const ex = dx * 1.6;
  const ey = hy + 0.6 + dy * 0.6;
  const eyes: [number, number][] = side ? [[hx + dx * 2.8, ey]] : [[hx - 2.1 + ex * 0.5, ey], [hx + 2.1 + ex * 0.5, ey]];
  // marks under the eyes
  const pale = shadeHex(look.skin, 0.35);
  const dark = shadeHex(look.skin, -0.35);
  ctx.lineWidth = 0.7;
  if (mark === "scar") {
    ctx.strokeStyle = pale;
    ctx.beginPath();
    ctx.moveTo(eyes[0][0] - 1.6, ey - 2.6);
    ctx.lineTo(eyes[0][0] + 1.2, ey + 2.6);
    ctx.stroke();
  } else if (mark === "freckles") {
    ctx.fillStyle = dark;
    for (const [fx, fy] of [[-2.6, 2.4], [-1.6, 2.9], [1.6, 2.9], [2.6, 2.4], [0, 3.2]]) ctx.fillRect(hx + fx + ex * 0.4, hy + fy, 0.6, 0.6);
  } else if (mark === "ash") {
    ctx.strokeStyle = "rgba(90,90,90,0.8)";
    ctx.beginPath();
    for (const [x0] of eyes) {
      ctx.moveTo(x0 - 1.4, ey + 1.8);
      ctx.lineTo(x0 + 1.4, ey + 1.8);
    }
    ctx.moveTo(hx + ex * 0.5, hy - 4);
    ctx.lineTo(hx + ex * 0.5, hy - 1.6);
    ctx.stroke();
  } else if (mark === "paint") {
    ctx.fillStyle = "rgba(150,40,30,0.85)";
    ctx.fillRect(hx - r + 0.6 + ex * 0.4, ey - 1.2, r * 2 - 1.2, 2.2);
  } else if (mark === "blot") {
    ctx.fillStyle = "rgba(20,18,30,0.85)";
    ctx.beginPath();
    ctx.arc(hx + 2.4 + ex * 0.3, hy + 2.4, 1.3, 0, Math.PI * 2);
    ctx.arc(hx + 3.2 + ex * 0.3, hy + 1.6, 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  if (feats.has("ink_veins")) {
    ctx.strokeStyle = featureColor;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 0.45;
    ctx.beginPath();
    ctx.moveTo(hx - 3.6 + ex * 0.3, hy + 1);
    ctx.quadraticCurveTo(hx - 2.6, hy + 3, hx - 3.2, hy + 4.6);
    ctx.moveTo(hx + 3.4 + ex * 0.3, hy - 2.5);
    ctx.quadraticCurveTo(hx + 4.2, hy, hx + 3.2, hy + 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (feats.has("embers")) {
    const a = 0.75 + Math.sin(t * 2.4) * 0.25;
    ctx.save();
    ctx.strokeStyle = featureColor;
    ctx.globalAlpha = a;
    ctx.shadowColor = featureColor;
    ctx.shadowBlur = 3;
    ctx.lineWidth = 0.55;
    ctx.beginPath();
    ctx.moveTo(hx - 3.8 + ex * 0.3, hy - 1);
    ctx.lineTo(hx - 2.8, hy + 1.2);
    ctx.lineTo(hx - 3.4, hy + 3.2);
    ctx.moveTo(hx + 2.2 + ex * 0.3, hy - 4.6);
    ctx.lineTo(hx + 3, hy - 2.8);
    ctx.stroke();
    ctx.restore();
  }
  // eyes
  ctx.save();
  if (feats.has("glow_eyes")) {
    ctx.shadowColor = look.eyes;
    ctx.shadowBlur = 4;
  } else {
    ctx.fillStyle = "#f2ede2";
    for (const [x0, y0] of eyes) {
      ctx.beginPath();
      ctx.ellipse(x0, y0, 1.35, 0.95, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = look.eyes;
  for (const [x0, y0] of eyes) {
    ctx.beginPath();
    ctx.arc(x0 + dx * 0.3, y0, feats.has("glow_eyes") ? 1.05 : 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawHood(ctx: CanvasRenderingContext2D, hx: number, hy: number, r: number, cloth: string, inner: string, back: boolean, dx: number, side: boolean): void {
  ctx.fillStyle = cloth;
  ctx.beginPath();
  ctx.moveTo(hx - r - 2, hy + r + 1);
  ctx.quadraticCurveTo(hx - r - 2.6, hy - r - 2.4, hx, hy - r - 2.4);
  ctx.quadraticCurveTo(hx + r + 2.6, hy - r - 2.4, hx + r + 2, hy + r + 1);
  ctx.closePath();
  if (back) {
    ctx.fill();
    return;
  }
  // cut the face opening out of the hood with an even-odd fill
  const fx = hx + (side ? dx * 1.6 : 0);
  ctx.moveTo(fx + r - 0.8, hy + 0.8);
  ctx.ellipse(fx, hy + 0.8, r - 0.8, r - 0.2, 0, 0, Math.PI * 2, true);
  ctx.fill("evenodd");
  ctx.strokeStyle = inner;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.ellipse(fx, hy + 0.8, r - 0.6, r, 0, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();
}

function drawHairBack(ctx: CanvasRenderingContext2D, shape: string, hx: number, hy: number, r: number, color: string, back: boolean): void {
  ctx.fillStyle = color;
  if (shape === "long") {
    ctx.beginPath();
    ctx.moveTo(hx - r - 0.6, hy - 1);
    ctx.lineTo(hx - r - 1.2, hy + r + 5.5);
    ctx.quadraticCurveTo(hx, hy + r + (back ? 8 : 6.5), hx + r + 1.2, hy + r + 5.5);
    ctx.lineTo(hx + r + 0.6, hy - 1);
    ctx.closePath();
    ctx.fill();
  } else if (shape === "braid") {
    const bx = back ? hx : hx + r * 0.75;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(bx, hy + r + i * 2.3, 1.5 - i * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawHairFront(ctx: CanvasRenderingContext2D, shape: string, hx: number, hy: number, r: number, color: string, back: boolean, side: boolean, dx: number, t: number, glow?: string): void {
  if (shape === "none") return;
  ctx.fillStyle = color;
  const cap = (low: number) => {
    ctx.beginPath();
    if (back) ctx.arc(hx, hy, r + 0.5, 0, Math.PI * 2);
    else {
      // hairline sits `low` px above the eyes, swept towards the facing side
      const sx = side ? dx * 1.5 : 0;
      ctx.arc(hx, hy, r + 0.5, Math.PI * 0.98, Math.PI * 2.02);
      ctx.quadraticCurveTo(hx + sx + r * 0.3, hy - low, hx + sx, hy - low - 0.6);
      ctx.quadraticCurveTo(hx + sx - r * 0.3, hy - low, hx - r - 0.5, hy + 0.2);
    }
    ctx.fill();
  };
  switch (shape) {
    case "short":
      cap(2.2);
      break;
    case "long":
    case "braid":
      cap(1.6);
      break;
    case "topknot":
      cap(2.6);
      ctx.beginPath();
      ctx.arc(hx, hy - r - 1.6, 2.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "wild": {
      cap(1.4);
      for (let i = 0; i < 7; i++) {
        const a = Math.PI * (1.05 + (i / 6) * 0.9);
        ctx.beginPath();
        ctx.arc(hx + Math.cos(a) * (r + 0.6), hy + Math.sin(a) * (r + 0.6), 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "flame": {
      ctx.save();
      if (glow) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 5;
      }
      for (let i = 0; i < 5; i++) {
        const bx = hx - r + 1 + i * ((2 * r - 2) / 4);
        const h = 4.2 + Math.sin(t * 7 + i * 1.7) * 1.1 + (i === 2 ? 1.6 : 0);
        ctx.beginPath();
        ctx.moveTo(bx - 1.7, hy - r + 2);
        ctx.quadraticCurveTo(bx - 0.4, hy - r - h * 0.5, bx + Math.sin(t * 5 + i) * 0.6, hy - r - h);
        ctx.quadraticCurveTo(bx + 0.6, hy - r - h * 0.4, bx + 1.7, hy - r + 2);
        ctx.fill();
      }
      ctx.restore();
      break;
    }
    case "quill": {
      cap(2.8);
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.9;
      for (let i = 0; i < 4; i++) {
        const sx = hx - 2.5 + i * 1.7;
        ctx.beginPath();
        ctx.moveTo(sx, hy - r + 0.5);
        ctx.quadraticCurveTo(sx + 1.5, hy - r - 3.5, sx + 3.5, hy - r - 4.5 + i * 0.3);
        ctx.stroke();
      }
      break;
    }
  }
}

function glowDots(ctx: CanvasRenderingContext2D, color: string, pts: [number, number][], a: number): void {
  ctx.save();
  ctx.globalAlpha = clampN(a, 0, 1);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 4;
  for (const [x, y] of pts) {
    ctx.beginPath();
    ctx.arc(x, y, 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Head-and-shoulders portrait into a small canvas (HUD, slot list). */
export function drawPortrait(canvas: HTMLCanvasElement, c: ContentBundle, look: CharacterLook, opts: { t?: number; tint?: string } = {}): void {
  const ctx = canvas.getContext("2d")!;
  const w = canvas.width;
  const h = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const k = w / 22;
  ctx.setTransform(k, 0, 0, k, w / 2, h * 0.98);
  // the head sits at about -24.5 * height scale above the feet; show from the chest up
  const { hs } = bodyScale(look);
  drawCharacter(ctx, c, look, 0, 24.5 * hs - 9 - 13, { facing: Math.PI / 2, t: opts.t });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (opts.tint) {
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = opts.tint;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
  }
}
