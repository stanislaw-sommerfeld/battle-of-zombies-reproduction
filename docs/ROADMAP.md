# Roadmap

| # | Milestone | Becomes playable | Systems | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| 0 | Skeleton | ✅ title, movement, camera, collision, build/deploy | tsc build, data bundle, CI/Pages | S | — |
| 1 | **Vertical slice core** | ✅ the Cinder Vale: combat, 7 creatures, mini-boss and boss, loot and affixes, origins, traits, insights, 1 quest with 3 resolutions, secret, world scars, save/load | surfaces, edicts, echoes/Fray, AI, quests, dialogue, rules | L | 0 |
| 2 | Slice polish (20–40 min) | second Lanternfast quest (Hush/Bellwarden thread); Odo trades flasks; a Tamsin follow-up; balance pass; tutorial hints driven by insights | merchant/currency, journal map | M | 1 |
| 3 | The Scriptorium (dungeon) | handcrafted dungeon behind the ink door; ink-lock puzzle with several solutions (name, burn, break, Choir) | multi-region support, region transitions, dungeon sub-areas from templates | L | 1 |
| 4 | Blocking, parry, status depth | parry window, shield charms, electricity (water + spark) | new element and reactions | M | 1 |
| 5 | Companion | Tamsin or Cale as a companion depending on choices | ally AI using the same state machine | M | 2 |
| 6 | Ecosystem sim | populations per zone, migration, hounds growing if fed, spring clean → fish → herons... | zone-level simulation tick | M | 1 |
| 7 | Region 2 | a new region with 2 new edicts (e.g. altered gravity, inverted healing) | content only, plus edict hooks | L | 3 |
| 8 | Visual pass | WebGL renderer or sprite atlas, lighting shadows, music | renderer swap | M | any |

## Known limitations (honest list)

- Enemies use local steering, not pathfinding. They can get stuck behind long walls (they give up and return home).
- Spells are projectiles only; area/channelled abilities need a new kind.
- There's no merchant or currency yet, so item value is unused.
- Weather isn't simulated yet, though edicts already provide per-zone atmosphere.
- The headless browser scripts need `playwright-core`, which isn't a project dependency.
