# Architecture

## Stack and why

- **TypeScript compiled to native ES modules with `tsc`. No bundler, no runtime dependencies.** Browsers load `dist/js/main.js` directly, and GitHub Pages serves it as static files. Builds take about a second. The only dev dependency is `typescript`, so there's almost nothing to break or update.
- **Canvas 2D** for the world (procedural shapes, cached ground layer, darkness/light compositing, particles). **DOM/CSS** for the UI (crisp text, easy layout).
- **JSON content** in `/data`, merged into `data.bundle.json` at build time. In dev it is re-bundled on every page load.

A 2.5D top-down view was chosen over 3D so systemic gameplay could be built first. The renderer is isolated (`src/render`), so it can be swapped for WebGL later without touching gameplay.

## Layout

```text
src/
  core/        events.ts (EventBus), input.ts, math.ts (Rng, vectors)
  data/        types.ts — the content schema
  world/       tilemap.ts, surfaces.ts (reaction grid), worldstate.ts (persistent memory), interact.ts
  entities/    entities.ts (plain data), player.ts (controller)
  combat/      damage.ts (pure rules), combat.ts (hits/kills), projectiles.ts
  ai/          enemy.ts (shared state machine, archetype movement), pathfield.ts (BFS flow field to the player)
  effects/     perks.ts (qualitative effects referenced by id from data)
  items/       inventory.ts, loot.ts
  quests/      quests.ts (data-driven stage machine)
  dialogue/    dialogue.ts (node graph + d20 checks)
  narrative/   rules.ts (conditions/effects DSL), insight.ts, worldrules.ts
  simulation/  reality.ts (status ticks, edicts, Fray/rupture, echoes, zones)
  save/        save.ts (versioned format, migrations, slots, file export/import)
  character/   look.ts (appearance from the character creator; cosmetic only)
  i18n/        en.ts / fr.ts (interface strings), content.ts (content overlays), keys.ts (key labels)
  render/      renderer.ts, fx.ts
  ui/          ui.ts (HUD, title, pause, panels), creator.ts, settings.ts, saves.ts, minimap.ts (fog of war, saved as a bitmap in WorldState.explored)
  audio/       sfx.ts (WebAudio synth, event-driven)
  game.ts      hub: owns state, implements RuleContext + EffectHost
  main.ts      boot + loop
```

## Communication

```text
  input ─► player.ts ─► combat.ts ─┬─► EventBus ──► QuestSystem   (data: quests)
  ai/enemy.ts ─────────► combat.ts │              ├► InsightSystem (data: insights)
  surfaces.ts ─ reactions ─────────┤              ├► WorldRules    (data: rules)
  interact.ts ─ dialogue / props ──┘              ├► UI (toasts, banners)
                                                  ├► Sfx
                                                  └► AI (Noise → investigate)
  WorldState.set() ─► WorldStateChanged ─► quests recheck, edicts refresh, spawns sync
```

- **Gameplay systems emit facts** (`EnemyKilled`, `SurfaceReacted`, `AreaEntered`, …). Quests, insights, world rules, UI and audio subscribe. There are no direct calls from combat to quests.
- **One rule language.** `narrative/rules.ts` defines `Condition` and `Effect`, used by dialogue options, quest triggers, insights, lore, props, spawns (`when`), world rules and zone scars.
- **`Game` is the only implementation of `RuleContext` and `EffectHost`.** Data effects route through it, so the systems don't need to know about each other.
- **World memory** (`WorldState`) holds flags, removed spawns, broken tiles, discovered zones and faction standing. It is saved as-is. Spawns, zone edicts and dialogue read it, so a flag set anywhere changes the world on the next evaluation. Spawns appear live via `syncSpawns()`.
- **Perks** (`effects/perks.ts`) are the bridge from data to behaviour. Items, affixes, traits and insights list perk ids, and combat and simulation ask `game.perks()` for hooks.

## Save format

Saves live in four slots (`auto` plus `1`–`3`) under `ash-ledger.slot.<id>`; waystones and new games write `auto`. A slot can be exported to a JSON file and imported back; imports go through the same migration and a structural check, then are checked against the content (region, origin). Settings (`src/core/settings.ts`) are stored apart under `ash-ledger.settings` and can be exported too.

`SaveData` (`src/save/save.ts`) carries `version`. To change it, bump `SAVE_VERSION` and add `MIGRATIONS[oldVersion]`. On load, items, traits, insights and quests whose definitions no longer exist are dropped instead of crashing.

## Testing

- `tests/systems.test.mjs`: statuses, damage, the surface grid, inventory, loot determinism, conditions, d20 checks, the quest flow, saves.
- `scripts/validate-data.mjs`: every cross-reference in `/data` (items in loot, dialogue gotos, quest stages, perks, spawn tiles not solid…).
- `scripts/smoke.mjs` / `scripts/playthrough.mjs`: headless browser. The playthrough drives the full quest through the systemic solution, plus the secret, freezing deep water, the reward, world reaction, save/load, rising echoes and death. Both fail on any console error.

## Extensibility check

| Add… | Touches |
| --- | --- |
| weapon, charm, coat | `data/items/*.json` |
| affix | `data/affixes` |
| enemy (existing archetype) | `data/enemies`, optionally `data/loot` |
| new enemy behaviour | a branch in `ai/enemy.ts` `engage()` + a visual shape in `renderer.ts` |
| ability (projectile spell) | `data/abilities` (+ `learnAbility` effect somewhere) |
| qualitative effect | one entry in `effects/perks.ts`, then reference it anywhere |
| status effect | `StatusId` + rules in `combat/damage.ts` + an icon in the renderer |
| NPC, dialogue, quest, lore, world rule | data only |
| zone / edict / world scar | data only |
| faction | `data/factions` |
| new surface reaction | `world/surfaces.ts` |

## Localization

- Interface strings: `src/i18n/en.ts` is the source; `src/i18n/fr.ts` must define every key (the compiler checks). Use `t("key", { param })` in code.
- Content text stays in English in `/data`. Each other language has `locales/<lang>.content.json`, keyed by a path into the bundle (`items/rusted_blade/name`). The build flattens it to `dist/locales/<lang>.json`; the game rewrites the live content in place when the language changes, so no reload is needed.
- `node scripts/i18n.mjs sync fr` adds new strings and drops removed ones; `node scripts/i18n.mjs check` lists missing and outdated translations (the English changed after translating). `npm test` reports the totals but never fails on them.
- Content text can name a control as `{key:spell1}`; the UI shows the key the player bound.

## Controls

`src/core/input.ts` maps physical key codes (`KeyboardEvent.code`, plus `Mouse0`–`Mouse2`) to actions. Codes follow key position, so the defaults (WASD) are ZQSD on AZERTY keyboards. Labels use the browser's keyboard layout map where available. Rebinding happens in the settings screen; a key can belong to one action only.
