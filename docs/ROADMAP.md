# Roadmap

| # | Milestone | Becomes playable | Systems | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| 0 | Skeleton | ✅ title, movement, camera, collision, build/deploy | tsc build, data bundle, CI/Pages | S | — |
| 1 | **Vertical slice core** | ✅ the Cinder Vale: combat, 7 creatures, mini-boss and boss, loot and affixes, origins, traits, insights, 1 quest with 3 resolutions, secret, world scars, save/load | surfaces, edicts, echoes/Fray, AI, quests, dialogue, rules | L | 0 |
| 2 | Slice polish (20–40 min) | ✅ second quest (*The Bell That Counts*, 3 resolutions); ✅ Odo's shop with cinder marks; ✅ contextual tips; ✅ minimap with saved fog of war; ✅ flow-field chasing. Still to do: a Tamsin follow-up and a balance pass from real play | data-only merchant, PathField | M | 1 |
| 2.5 | Menus, settings, creator | ✅ title menu; settings (EN/FR, rebinding, audio, display) with export/import; save slots with export/import; character creator; HUD redesign | i18n overlays, settings store, slot saves (v2), procedural character drawing | M | 2 |
| 3 | The Scriptorium (dungeon) | handcrafted dungeon behind the ink door; ink-lock puzzle with several solutions (name, burn, break, Choir) | multi-region support, region transitions, dungeon sub-areas from templates | L | 1 |
| 4 | Blocking, parry, status depth | parry window, shield charms, electricity (water + spark) | new element and reactions | M | 1 |
| 5 | Companion | Tamsin or Cale as a companion depending on choices | ally AI using the same state machine | M | 2 |
| 6 | Ecosystem sim | populations per zone, migration, hounds growing if fed, spring clean → fish → herons... | zone-level simulation tick | M | 1 |
| 7 | Region 2 | a new region with 2 new edicts (e.g. altered gravity, inverted healing) | content only, plus edict hooks | L | 3 |
| 8 | Visual pass | WebGL renderer or sprite atlas, lighting shadows, music | renderer swap | M | any |

## Known limitations (honest list)

- Chasing uses a flow field toward the player (26-tile radius). Returning home still uses plain steering.
- Spells are projectiles only; area/channelled abilities need a new kind.
- The shop only sells to you; you can't sell items yet.
- Weather isn't simulated yet, though edicts already provide per-zone atmosphere.
- The headless browser scripts need `playwright-core`, which isn't a project dependency.
- Species, peoples and sexes are cosmetic and not yet part of the story. French text avoids gendered agreement for the player; origin names use the masculine generic.
- No gamepad support yet.
