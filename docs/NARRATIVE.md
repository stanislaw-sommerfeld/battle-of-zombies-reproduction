# Narrative

All narrative is data: `data/dialogue`, `data/quests`, `data/lore`, `data/rules`, `data/npcs`. World state lives in flags.

## Main thread (seeded)

1. *A note in your own hand*: don't look for your name; don't trust anyone who sings.
2. The rising-ash stone explains the Unwriting.
3. *Scribe's marginalia* (secret) names the Rubric: ink that writes *BE STILL*.
4. *Folio of the Uncounted* (Hush chapel): the Scribes lit the fire themselves, and one volunteered to forget.
5. The Scriptorium door asks for the name of whoever burned the Ledger. This is Chapter 2.

## Quest: Ink in the Well (`q_fouled_well`)

| Resolution | How | World result |
| --- | --- | --- |
| **Slain** | kill the Leech-Mother | `spring_state=leech_slain`, `well_clean`; Lanternfast +2, Choir −2 |
| **Burned clean** | burn ~80% of the spring's ink (Ember Bolt, oil, the Kindling edict); learned from Tamsin's note, the shrine (Wits 12) or by watching ink burn | the Leech-Mother leaves without a fight; the spring becomes the *Edict of Clear Water*; Lanternfast +3, Choir −2 |
| **Choir rite** | take Cale's tincture, pour it at the shrine | `well_singing`; Lanternfast's hearth dims; the spring becomes the *Edict of the Choir* (the dead rise); Choir +3, Lanternfast −3, the Choir-Bone Ring; at Ilse, lie (Wits 15) or confess |

The quest can be resolved *before* it is accepted. World rules set `spring_state` from events, and Ilse's dialogue notices.

Reward choice: the Lanternhook (fire build) or Tamsin's Quiet Knife (stealth build), or both with Might 14 (and a standing penalty).

## Quest: The Bell That Counts (`q_hush_bell`)

Starts when you first enter the Hush (a world rule, so there's no quest giver).

| Resolution | How | World result |
| --- | --- | --- |
| **Slain** | kill the Bellwarden | the Gravewrit Maul; the Hush's Edict of Return breaks |
| **Rites** | light both chapel braziers with any fire (Ember Bolt, the Lanternhook, burning oil) | the Bellwarden lies down without a fight; Bell-Tongue Charm (the third combo hit stuns) |
| **Named** | read the Folio first, then read the names aloud at the lectern (Resolve 13; each failure costs +25 Fray) | Folio-Ash Locket; `counted_the_uncounted`; a hint that your own name is in the book |

All three set `hush_quieted`. That flag rewrites both Hush zones to *Edict of Return (Broken)*, and Ilse and Odo react to it.

## Flags in use

`spring_state`, `well_clean`, `well_singing`, `read_own_note`, `read_tamsin_note`, `told_tamsin`, `knows_rubric`, `knows_burning`, `saw_scriptorium`, `hush_quieted`, `hush_braziers`, `counted_the_uncounted`, `odo_haggled`, `lit_<spawnId>`, `cider_house_opened`, `cale_refused`, `cale_honest`, `cale_rewarded`, `odo_gift`, `ink_cleared_<zone>`, `rule.<id>`.
