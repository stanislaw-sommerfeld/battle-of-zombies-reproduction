# Content Guide

Every JSON file under `data/<category>/` holds one definition (an object with `id`) or an array of them. File names don't matter. Run `npm run dev` and refresh the browser to see changes. Run `npm run validate` to catch broken references. The schema is `src/data/types.ts`.

## Weapon

`data/items/weapons.json`:

```json
{
  "id": "fractured_blade",
  "name": "Fractured Blade",
  "type": "weapon",
  "weaponClass": "blade",
  "damage": 14,
  "attackSpeed": 1.1,
  "reach": 48,
  "arc": 110,
  "heavyMultiplier": 2.2,
  "scaling": { "finesse": 1 },
  "perks": ["rime_edge", "shatter"],
  "drawbacks": ["unwritten_edge"],
  "rollAffixes": true,
  "description": "It remembers being whole."
}
```

`weaponClass` is one of `blade | hook | knife | maul` (knives swing faster; the class affects the drawing). Then put it in a loot table, a chest (`params.loot`), or a dialogue `giveItem` effect.

## Qualitative effect (perk)

Add an entry in `src/effects/perks.ts` with a `text` and hooks (`onHit`, `onKill`, `damageMult`, `onHarvest`, `onDodge`, `onPerfectDodge`, or multipliers like `frayMult`). Reference its id from items, affixes, traits or insights.

## Enemy

`data/enemies/*.json`: pick a `behavior` (`lunger` circles and lunges, `brute` slams, `spitter` keeps distance, `boss` mixes ranged and melee, `echo` presses forward). Give it `attacks` of kind `melee | lunge | slam | projectile` (each gets an automatic ground telegraph), plus a faction, a loot table and a visual (`hound | thrall | leech | matron | echo` with colours and scale). Useful extras: `pack`, `scavenger`, `risesAs`, `immune`, `resist`, `boss`, `departsWhen`. Place it with a spawn in the region.

## Quest

`data/quests/*.json`: stages with `triggers`. A trigger listens to an event, optionally `match`es payload fields, checks an `if` condition, counts to `count`, then runs `effects` and goes `to` a stage or `complete`s an outcome. The pseudo-event `"Check"` fires when a stage is entered and whenever world state changes, which makes condition-only triggers possible. Start a quest from dialogue (`startQuest`) and complete it from dialogue or a trigger.

Events are listed in `src/core/events.ts` (`GameEvents`).

## Dialogue

`entries` pick the start node by condition. Nodes have `text`, conditional `variants`, entry `effects` and `options`. Options can have an `if`, `effects`, `goto`, a d20 `check: { attr, dc }` with `failGoto`/`failEffects`, and `once` (a flag that hides the option after use). Attach a dialogue to an NPC (`data/npcs`) or a prop (`interact.dialogue`).

## World consequences

- **Flags:** the `setFlag` effect.
- **World rules** (`data/rules`): "when event X happens (anywhere), apply effects". They work even if no quest is active.
- **Spawns** with `when` appear as soon as their condition holds (e.g. Odo appears once `well_clean` is set).
- **World scars:** `zones[].edictWhen` swaps a zone's law when a condition holds.

## Merchant (data only)

A shop is a dialogue: options with `if: { hasItem: "cinder_mark", count: N }` and the effects `takeItem` + `giveItem` loop back to the shop node. See Odo in `data/dialogue/places.json`.

## Tips and tutorials

Add a world rule with a `toast` effect and `"kind": "hint"`. Rules fire once by default, e.g. on the first `PlayerDamaged`.

## Zone, edict, region

- Edict (`data/edicts`): `fireSpread`, `fireDamage`, `healing`, `regen`, `frayDecay`, `deadRise`, `sanctuary`, and atmosphere (`ambient`, `darkness`, `ash`, `fog`).
- Zone (`data/zones`): a rect in tiles with an edict. Later zones in the region's `zones` list override earlier ones.
- Region (`data/regions`): an ASCII `map`, a `legend` mapping characters to tiles (`data/tiles`), and `spawns`. `scripts/gen-cinder-vale.py` generated the first map; edit the ASCII directly from now on.

## Lore, props, NPC

- Lore (`data/lore`): `title`, `text`, first-read `effects`. Place it with a `page` prop and `params.lore`.
- Props (`data/props`): barrels (`onBreak`), chests (`interact.loot`), pages, waystones, braziers, doors, shrines. A spawn's `params` can override `lore`, `loot` and `dialogue`.
- NPCs (`data/npcs`): name, dialogue, colours, conditional `barks`.

## Origin, trait, ability

- Origins: starting attributes, gear, and a trait.
- Traits (`data/traits`): perks plus optional attribute `requires`. Three random eligible traits are offered on each level-up.
- Abilities (`data/abilities`): a projectile spell on Q or R with an element, Ember cost, Fray and scaling. Learn one with the `learnAbility` effect.
