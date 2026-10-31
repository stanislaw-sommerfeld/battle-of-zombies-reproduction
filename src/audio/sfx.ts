// Synthesized sound effects (WebAudio, no asset files). Subscribes to game events.
import type { EventBus } from "../core/events.js";

export class Sfx {
  private ctx?: AudioContext;
  private master?: GainNode;
  muted = false;
  /** 0..1 from settings; 0.5 matches the original mix. */
  private volume = 0.7;

  constructor(bus: EventBus) {
    const unlock = () => {
      if (!this.ctx) {
        try {
          this.ctx = new AudioContext();
          this.master = this.ctx.createGain();
          this.master.gain.value = this.gain();
          this.master.connect(this.ctx.destination);
        } catch {
          /* audio unavailable */
        }
      }
      this.ctx?.resume();
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

    bus.on("Noise", (n) => {
      if (n.source === "melee") this.noise(0.08, 900, 0.15);
    });
    bus.on("EnemyDamaged", (e) => this.tone(e.element === "fire" ? 180 : 120, 0.09, "square", 0.12, 60));
    bus.on("PlayerDamaged", () => this.tone(90, 0.2, "sawtooth", 0.2, 40));
    bus.on("EnemyKilled", () => this.tone(70, 0.35, "triangle", 0.25, 30));
    bus.on("AbilityCast", (a) => (a.element === "frost" ? this.tone(900, 0.25, "sine", 0.12, 1400) : this.noise(0.25, 400, 0.2)));
    bus.on("ItemAcquired", (i) => {
      this.tone(660, 0.12, "sine", 0.12);
      if (i.rarity !== "common") setTimeout(() => this.tone(990, 0.2, "sine", 0.12), 90);
    });
    bus.on("SurfaceReacted", (s) => {
      if (s.reaction === "ignite_oil") this.noise(0.5, 250, 0.25);
      else if (s.reaction === "steam") this.noise(0.4, 3000, 0.08);
      else if (s.reaction === "freeze_water") this.tone(1400, 0.08, "sine", 0.05, 1800);
      else if (s.reaction === "shatter") this.noise(0.3, 4000, 0.3);
    });
    bus.on("InsightGained", () => [523, 659, 784].forEach((f, i) => setTimeout(() => this.tone(f, 0.6, "sine", 0.12), i * 120)));
    bus.on("QuestCompleted", () => [392, 523, 659, 784].forEach((f, i) => setTimeout(() => this.tone(f, 0.7, "triangle", 0.12), i * 140)));
    bus.on("EchoHarvested", () => this.tone(440, 0.3, "sine", 0.12, 880));
    bus.on("RealityShifted", () => this.tone(60, 1.2, "sawtooth", 0.25, 220));
    bus.on("TileBroken", () => this.noise(0.5, 200, 0.35));
    bus.on("PerfectDodge", () => this.tone(1200, 0.15, "sine", 0.1, 600));
  }

  private gain(): number {
    return this.muted ? 0 : this.volume * 0.5;
  }

  setVolume(volume: number, muted: boolean): void {
    this.volume = volume;
    this.muted = muted;
    if (this.master) this.master.gain.value = this.gain();
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, to?: number): void {
    const c = this.ctx;
    if (!c || !this.master || this.muted) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, c.currentTime);
    if (to) o.frequency.exponentialRampToValueAtTime(to, c.currentTime + dur);
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(c.currentTime + dur);
  }

  private noise(dur: number, cutoff: number, vol: number): void {
    const c = this.ctx;
    if (!c || !this.master || this.muted) return;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cutoff;
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }
}
