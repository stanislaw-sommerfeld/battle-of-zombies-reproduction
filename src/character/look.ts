// The player's appearance, chosen in the character creator. Purely cosmetic:
// none of these values touch combat, so they can be changed freely.
import type { ContentBundle, CosmeticDef, CosmeticKind, RaceDef, SpeciesDef } from "../data/types.js";

export interface CharacterLook {
  species: string;
  race: string;
  /** Absent for species without sexes. */
  sex?: string;
  heightCm: number;
  weightKg: number;
  skin: string;
  hair: string;
  hairColor: string;
  eyes: string;
  mark: string;
  outfit: string;
  clothPrimary: string;
  clothSecondary: string;
  hood: boolean;
}

export function speciesOf(c: ContentBundle, look: CharacterLook): SpeciesDef {
  return c.species[look.species] ?? Object.values(c.species)[0];
}

export function raceOf(c: ContentBundle, look: CharacterLook): RaceDef {
  const sp = speciesOf(c, look);
  return sp.races.find((r) => r.id === look.race) ?? sp.races[0];
}

/** Cosmetics of one kind that the species may use. */
export function cosmeticsFor(c: ContentBundle, kind: CosmeticKind, species: string): CosmeticDef[] {
  return Object.values(c.cosmetics).filter((x) => x.kind === kind && (!x.species || x.species.includes(species)));
}

export function clothColors(c: ContentBundle): string[] {
  return c.cosmetics.cloth?.colors ?? ["#3b4a4f", "#26323a"];
}

export function heightRange(sp: SpeciesDef, race: RaceDef): [number, number] {
  const o = race.heightOffset ?? 0;
  return [sp.heightCm[0] + o, sp.heightCm[1] + o];
}

const mid = (r: [number, number]) => Math.round((r[0] + r[1]) / 2);

/** A sensible starting look for a species (and race, if given). */
export function defaultLook(c: ContentBundle, speciesId?: string, raceId?: string): CharacterLook {
  const sp = (speciesId && c.species[speciesId]) || Object.values(c.species)[0];
  const race = sp.races.find((r) => r.id === raceId) ?? sp.races[0];
  const hair = cosmeticsFor(c, "hair", sp.id);
  const outfit = cosmeticsFor(c, "outfit", sp.id);
  const cloth = clothColors(c);
  return {
    species: sp.id,
    race: race.id,
    sex: sp.sexes?.length ? sp.sexes[0].id : undefined,
    heightCm: mid(heightRange(sp, race)),
    weightKg: mid(sp.weightKg),
    skin: race.skin[0],
    hair: (hair.find((h) => h.shape !== "none") ?? hair[0])?.id ?? "none",
    hairColor: race.hair[0],
    eyes: race.eyes[0],
    mark: "mark_none",
    outfit: outfit[0]?.id ?? "cloak",
    clothPrimary: cloth[0],
    clothSecondary: cloth[1] ?? cloth[0],
    hood: true,
  };
}

/** Random look, for the creator's dice button. `rnd` returns [0, 1). */
export function randomLook(c: ContentBundle, rnd: () => number, keepSpecies?: string): CharacterLook {
  const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
  const sp = keepSpecies && c.species[keepSpecies] ? c.species[keepSpecies] : pick(Object.values(c.species));
  const race = pick(sp.races);
  const hr = heightRange(sp, race);
  const cloth = clothColors(c);
  const marks = cosmeticsFor(c, "mark", sp.id);
  return {
    species: sp.id,
    race: race.id,
    sex: sp.sexes?.length ? pick(sp.sexes).id : undefined,
    heightCm: Math.round(hr[0] + rnd() * (hr[1] - hr[0])),
    weightKg: Math.round(sp.weightKg[0] + rnd() * (sp.weightKg[1] - sp.weightKg[0])),
    skin: pick(race.skin),
    hair: pick(cosmeticsFor(c, "hair", sp.id)).id,
    hairColor: pick(race.hair),
    eyes: pick(race.eyes),
    mark: rnd() < 0.5 ? "mark_none" : pick(marks).id,
    outfit: pick(cosmeticsFor(c, "outfit", sp.id)).id,
    clothPrimary: pick(cloth),
    clothSecondary: pick(cloth),
    hood: rnd() < 0.5,
  };
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Repairs a look against the current content: used for imported saves and
 * after content changes (a removed hairstyle falls back to a valid one).
 * Also re-fits dependent choices when the species or race changes.
 */
export function sanitizeLook(c: ContentBundle, raw: unknown): CharacterLook {
  if (!raw || typeof raw !== "object") return defaultLook(c);
  const r = raw as Partial<CharacterLook>;
  const sp = (typeof r.species === "string" && c.species[r.species]) || Object.values(c.species)[0];
  const race = sp.races.find((x) => x.id === r.race) ?? sp.races[0];
  const d = defaultLook(c, sp.id, race.id);
  const valid = (kind: CosmeticKind, id: unknown, dflt: string) => (typeof id === "string" && cosmeticsFor(c, kind, sp.id).some((x) => x.id === id) ? id : dflt);
  const inList = (v: unknown, list: string[], dflt: string) => (typeof v === "string" && list.includes(v) ? v : dflt);
  const color = (v: unknown, dflt: string) => (typeof v === "string" && HEX.test(v) ? v : dflt);
  const clamp = (v: unknown, [lo, hi]: [number, number], dflt: number) => (typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : dflt);
  const sexes = sp.sexes ?? [];
  return {
    species: sp.id,
    race: race.id,
    sex: sexes.length ? inList(r.sex, sexes.map((s) => s.id), sexes[0].id) : undefined,
    heightCm: clamp(r.heightCm, heightRange(sp, race), d.heightCm),
    weightKg: clamp(r.weightKg, sp.weightKg, d.weightKg),
    skin: inList(r.skin, race.skin, d.skin),
    hair: valid("hair", r.hair, d.hair),
    hairColor: inList(r.hairColor, race.hair, d.hairColor),
    eyes: inList(r.eyes, race.eyes, d.eyes),
    mark: valid("mark", r.mark, "mark_none"),
    outfit: valid("outfit", r.outfit, d.outfit),
    clothPrimary: color(r.clothPrimary, d.clothPrimary),
    clothSecondary: color(r.clothSecondary, d.clothSecondary),
    hood: typeof r.hood === "boolean" ? r.hood : d.hood,
  };
}

/** Build from height and weight, as a key into the UI dictionary. */
export function buildOf(look: CharacterLook): "build.slight" | "build.lean" | "build.average" | "build.sturdy" | "build.heavy" {
  const bmi = look.weightKg / (look.heightCm / 100) ** 2;
  if (bmi < 17.5) return "build.slight";
  if (bmi < 21) return "build.lean";
  if (bmi < 25.5) return "build.average";
  if (bmi < 30) return "build.sturdy";
  return "build.heavy";
}
