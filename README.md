# Ash Ledger

A systemic dark-fantasy action RPG that runs in the browser. No install, no plugins.

> The book that held the world's laws has burned. Its pages still fall. Where they land, they rule.

You wake in a crater where the ash falls upward. A note in your own handwriting tells you not to look for your name. North is a town sheltering under a page that says *warmth is owed to all who shelter*; east is an orchard where *fire is hungry*; west is a graveyard where *the dead do not stay down*.

## Play

- **Online:** after the first deploy, at `https://<owner>.github.io/<repo>/` (see [Deployment](#deployment)).
- **Locally:**
  ```bash
  npm install
  npm run dev        # http://localhost:5173 — TypeScript in watch mode, data reloads on refresh
  ```

### Controls

| Action | Input |
| --- | --- |
| Move / aim | WASD · mouse |
| Light attack (3-hit combo) / heavy attack | Left click (K) / right click (L) |
| Dodge (i-frames) / sprint | Space / Shift |
| Spells (burst at the cursor) | Q (Ember Bolt) · R (found in the world) |
| Throw flask / eat | F / C |
| Interact, harvest echoes | E |
| Character & inventory / journal / pause / mute | I / J / Esc / M |

## What's in this build (Milestone 1 vertical slice)

- **One dense region (the Cinder Vale):** the Ash Crater start, the hub town Lanternfast, the Cinder Road, the Drowned Orchard and its Black Spring, a walled-up secret cider house, the Hush graveyard and its chapel, plus a sealed Scriptorium door that sets up the next chapter.
- **Creatures with different behaviour:** pack-hunting Mire Hounds that circle, lunge, howl for the pack and eat corpses' echoes. Ink Leeches that keep their distance and spit puddles. Slow Ash Thralls with telegraphed slams. Risen echoes. A mini-boss (the Leech-Mother) and a boss (the Bellwarden). Hounds and leeches also fight each other.
- **Systemic surfaces:** oil, water, ink, ice, fire and steam on a cell grid. Fire spreads through oil, ink and dry grass. Fire on water makes steam, and nothing can see through steam. Frost freezes water, and frozen deep water can be walked on. Ink burns away.
- **Character building:** 3 origins, 4 attributes, 11 traits that change how you fight (e.g. heavy attacks shatter frozen enemies), equipment with qualitative perks and drawbacks, random affixes, and a relic or two.
- **A quest with three resolutions:** kill the Leech-Mother, burn the spring clean, or complete the Cinder Choir's rite. D&D-style d20 skill checks appear in dialogue. The choice permanently rewrites local laws, NPC dialogue and who lives in town.
- **Save/load** (versioned, localStorage) at waystones and from the pause menu. When you die you rise at your last rest.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with `tsc --watch` |
| `npm run build` | Compile to `dist/` (native ES modules, no bundler), bundle `/data`, validate content |
| `npm test` | Build + data validation + unit tests (`node --test`) |
| `npm run preview` | Serve `dist/` |
| `node scripts/smoke.mjs`, `node scripts/playthrough.mjs` | Headless-browser checks (need `playwright-core`; see the script headers) |

The project's only dependency is TypeScript.

## Deployment

`.github/workflows/pages.yml` builds and tests every push and PR. Pushes to `main` deploy `dist/` to GitHub Pages. One-time setup: **Settings → Pages → Source: GitHub Actions**. Pages for private repositories requires a paid GitHub plan; otherwise make the repository public.

## Documentation

- [Game design](docs/GAME_DESIGN.md): pillars, signature mechanics, loops
- [Architecture](docs/ARCHITECTURE.md): systems and how they talk
- [World](docs/WORLD.md) and [Narrative](docs/NARRATIVE.md)
- [Content guide](docs/CONTENT_GUIDE.md): how to add weapons, enemies, quests, zones…
- [Roadmap](docs/ROADMAP.md)

`prototypes/godot/` holds the earlier Godot prototype that was in this repository. It is kept for reference and is not part of the web game.
