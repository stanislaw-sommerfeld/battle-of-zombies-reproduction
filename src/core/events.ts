// Generic publish/subscribe bus. Systems never call each other directly for
// gameplay reactions: they emit facts ("EnemyKilled") and others subscribe.
// Payloads are flat records so data files (quests, insights) can match on fields.

export interface GameEvents {
  EnemyKilled: { enemyId: string; spawnId: string; zone: string; byPlayer: boolean; element: string; x: number; y: number };
  EnemyDamaged: { enemyId: string; amount: number; element: string; byPlayer: boolean };
  PlayerDamaged: { amount: number; element: string; source: string };
  PlayerDied: { zone: string };
  ItemAcquired: { itemId: string; count: number; rarity: string };
  ItemEquipped: { itemId: string; slot: string };
  ItemUsed: { itemId: string };
  AreaEntered: { zone: string; edict: string; first: boolean };
  NPCSpokenTo: { npcId: string };
  DialogueChoice: { dialogueId: string; node: string; option: number };
  SkillCheck: { attr: string; dc: number; roll: number; total: number; success: boolean };
  QuestStarted: { questId: string };
  QuestStageChanged: { questId: string; stage: string };
  QuestCompleted: { questId: string; outcome: string };
  FactionChanged: { factionId: string; value: number; delta: number };
  WorldStateChanged: { key: string; value: string | number | boolean };
  InsightGained: { insightId: string };
  LoreRead: { loreId: string };
  StatusApplied: { targetId: string; status: string; isPlayer: boolean };
  SurfaceReacted: { reaction: string; zone: string; x: number; y: number };
  PropBroken: { propId: string; spawnId: string; zone: string };
  PropInteracted: { propId: string; spawnId: string; zone: string };
  TileBroken: { tile: string; x: number; y: number; zone: string };
  EchoHarvested: { enemyId: string; zone: string };
  EchoRisen: { enemyId: string; zone: string };
  EchoEaten: { enemyId: string; byId: string };
  RealityShifted: { kind: string; zone: string };
  PerfectDodge: { attackerId: string };
  AbilityCast: { abilityId: string; element: string };
  LevelUp: { level: number };
  Noise: { x: number; y: number; radius: number; source: string };
  Toast: { text: string; kind?: string };
  GameSaved: { slot: string };
}

export type EventName = keyof GameEvents;
type Handler<K extends EventName> = (payload: GameEvents[K]) => void;
type AnyHandler = (name: EventName, payload: Record<string, unknown>) => void;

export class EventBus {
  private handlers = new Map<EventName, Set<Handler<any>>>();
  private anyHandlers = new Set<AnyHandler>();
  private queue: [EventName, unknown][] = [];
  private dispatching = false;

  on<K extends EventName>(name: K, fn: Handler<K>): () => void {
    let set = this.handlers.get(name);
    if (!set) this.handlers.set(name, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  /** Receives every event; used by data-driven systems (quests, insights). */
  onAny(fn: AnyHandler): () => void {
    this.anyHandlers.add(fn);
    return () => this.anyHandlers.delete(fn);
  }

  /**
   * Events emitted while another event is being handled are queued and
   * delivered afterwards, so handlers never observe half-applied state.
   */
  emit<K extends EventName>(name: K, payload: GameEvents[K]): void {
    this.queue.push([name, payload]);
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      while (this.queue.length) {
        const [n, p] = this.queue.shift()!;
        this.handlers.get(n)?.forEach((h) => h(p));
        this.anyHandlers.forEach((h) => h(n, p as Record<string, unknown>));
      }
    } finally {
      this.dispatching = false;
    }
  }

  clear(): void {
    this.handlers.clear();
    this.anyHandlers.clear();
    this.queue = [];
  }
}
