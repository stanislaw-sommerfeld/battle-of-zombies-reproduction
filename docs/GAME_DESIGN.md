# Game Design

## Concept

**Ash Ledger.** Fifty years ago the Ledger burned. It was the book in which every law of the world was written: that fire burns, that the dead stay dead, that water flows downhill. Its pages scattered as ash. Wherever a page landed, its law still holds locally: an **Edict**. Between Edicts lies the **Blank**, where nothing is promised.

The player is **Unwritten**: someone whose name burned with the Ledger. No law binds them, which is why they can draw on unwritten fire (spells) and read pages that would freeze anyone else. They are also the only one who can afford to ask who burned the Ledger, and why the ash still falls.

**Player fantasy:** a wanderer who learns the local rules of a broken world and then exploits them, breaks them, or rewrites them.

**Central mystery (seeded in the slice):** The Scribes burned the Ledger themselves. The Ledger's own ink had begun writing without a hand (the *Rubric*), and every law it writes is *BE STILL*. One Scribe volunteered to forget and carry the last match out of the Scriptorium. The player's note, written in their own hand, implies who that was.

## Signature mechanics

1. **Edicts (local laws).** Every zone runs under an edict that changes core rules: fire spread and damage, healing, Fray decay, whether the dead rise, and whether hostile creatures can enter at all. Data: `data/edicts`, `zones[].edict`.
2. **World scars.** Major outcomes rewrite edicts permanently (`zones[].edictWhen`). If you burn the Black Spring clean, it becomes the *Edict of Clear Water* (it heals you and washes Fray away). If you complete the Choir's rite, it becomes the *Edict of the Choir* (fire won't spread there and the dead rise), and Lanternfast's hearth dims. Killing the Bellwarden breaks the Hush's Edict of Return.
3. **Surfaces and reactions.** A cell grid of oil, water, ink, ice, fire and steam (`src/world/surfaces.ts`), combined with statuses on actors: wet, oiled, burning, chilled, frozen, inked. A small set of rules interact with edicts, AI and perks:
   - oil + fire → a spreading fire (twice as fast under Kindling); an oiled target hit by fire *flares*
   - water + fire → steam, which blocks enemy sight
   - water + frost → ice; a wet target that gets chilled freezes; frozen deep water can be walked on
   - ink + fire → the ink burns away, and a spring can be cleaned this way
   - burning creatures ignite the oil they run through; hounds panic while burning
4. **Insight (knowledge as progression).** Watching the world teaches you things. Seeing a hound burn teaches *Oily Pelts* (+60% damage to burning hounds). Watching ink burn teaches *Ink Burns Clean*: burning ink feeds you Ember, and it opens the fire solution in the shrine dialogue. Perfect-dodging thralls teaches their rhythm (a guaranteed critical after a perfect dodge). Watching echoes rise teaches you to stand near them to stop it. Insights come from event counters in data, never from XP.
5. **Echoes and Fray (risk magic).** Slain creatures leave echoes. Harvesting one gives Ember (spell fuel) and raises **Fray**. Casting raises Fray too. Above 50 Fray your spells hit 50% harder. At 100 Fray reality **ruptures** around you: hostile echoes tear through, the ground weeps oil, or time stutters. If you leave echoes alone, hounds eat them and grow stronger, and under the Edict of Return they rise as enemies.

These systems feed each other. Edicts change how surfaces behave. Surfaces change what the AI can see and where it can walk. Echoes connect killing, scavengers, edicts and Fray. Insight rewards paying attention to all of it.

## Loops

- **30 seconds:** read a creature's telegraph, position, dodge, strike. Use the ground: kick an oil barrel, then fire; soak with water, then freeze; heavy-attack frozen targets.
- **5 minutes:** find something strange (a stone, a page, a cracked wall, a fire you could start). Fight or avoid a group. Decide whether to harvest echoes (Ember now, Fray risk) and whether to rest at a waystone.
- **30 minutes:** take a problem with several solutions, pick one, and see the world change: laws, NPCs, dialogue, standing.
- **Long term:** a build made from origin, attributes, traits, gear perks and insights. Regions with new edicts. The Scriptorium and the mystery of your name.

## Design rules we hold ourselves to

- Qualitative modifiers over percentages ("heavy hits shatter frozen foes", not "+4% frost").
- Every new feature must interact with at least two existing systems.
- Problems have several solutions; consequences are stored as world flags and read by data.
- Readable combat: every enemy attack has a ground telegraph, and creatures shudder while winding up.
- Dense over large: the whole slice is 80×60 tiles.
