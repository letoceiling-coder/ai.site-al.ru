/**
 * Простой in-memory broadcaster для событий «оператора» (очередь handoff, новые сообщения).
 *
 * Работает в рамках одного Next.js-процесса. Для Prod с одним PM2-форком этого достаточно.
 * Если в будущем появится кластер — заменить на Redis pub/sub или Postgres LISTEN/NOTIFY.
 */

export type OperatorEvent =
  | { type: "queue"; tenantId: string }
  | { type: "dialog-updated"; tenantId: string; dialogId: string }
  | { type: "dialog-message"; tenantId: string; dialogId: string };

type Listener = (event: OperatorEvent) => void;

const GLOBAL_KEY = "__aiSiteAlRuOperatorEvents__";

type GlobalBag = {
  listeners: Map<string, Set<Listener>>;
};

function getBag(): GlobalBag {
  const g = globalThis as unknown as Record<string, GlobalBag>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = { listeners: new Map() };
  }
  return g[GLOBAL_KEY];
}

export function subscribeOperatorEvents(tenantId: string, listener: Listener): () => void {
  const bag = getBag();
  const set = bag.listeners.get(tenantId) ?? new Set<Listener>();
  set.add(listener);
  bag.listeners.set(tenantId, set);
  return () => {
    const current = bag.listeners.get(tenantId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      bag.listeners.delete(tenantId);
    }
  };
}

export function publishOperatorEvent(event: OperatorEvent): void {
  const bag = getBag();
  const set = bag.listeners.get(event.tenantId);
  if (!set || set.size === 0) return;
  for (const l of set) {
    try {
      l(event);
    } catch {
      /* ignore listener errors */
    }
  }
}
