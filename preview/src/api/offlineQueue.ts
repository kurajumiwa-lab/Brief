// Durable account-scoped offline writes. A browser tab never owns the server
// identity: the API supplies an account id learned from a verified /auth/me or
// sign-in response. Legacy unbound entries are quarantined, never replayed.
export interface QueuedWrite {
  id: string;
  path: string;
  method: string;
  body: string | null;
  clientKey: string | null;
  accountId?: string | null;
  queuedAt: string;
  /** Legacy-only credential field; never read for replay or written again. */
  headers?: Record<string, string>;
}
export interface DeadLetter extends QueuedWrite {
  error: string;
  failedAt: string;
}
const QUEUE_KEY = 'brief.offlineQueue.v1';
const DEAD_KEY = 'brief.offlineDead.v1';
const MAX_QUEUE = 200;

function readJson<T>(key: string, fallback: T): T {
  try { const raw = globalThis.localStorage?.getItem(key); return raw ? JSON.parse(raw) as T : fallback; }
  catch { return fallback; }
}
function readQueue(): QueuedWrite[] {
  if (!globalThis.localStorage) throw new Error('Offline storage unavailable');
  const raw = globalThis.localStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows)) throw new Error('Offline queue is unreadable; existing changes were not overwritten');
  return rows;
}
function scrub<T extends QueuedWrite>(row: T): T {
  const { headers: _legacyCredential, ...safe } = row;
  return safe as T;
}
function writeJson(key: string, value: unknown): void {
  if (!globalThis.localStorage) throw new Error('Offline storage unavailable');
  globalThis.localStorage.setItem(key, JSON.stringify(value));
}
// Old versions wrote bearer headers to localStorage. Scrub them on first load,
// retaining the rows as unbound (never replayable) rather than losing work.
for (const key of [QUEUE_KEY, DEAD_KEY]) {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) continue;
    const rows = JSON.parse(raw);
    if (Array.isArray(rows) && rows.some(w => w.headers)) writeJson(key, rows.map(scrub));
  } catch { /* locked/corrupt storage cannot be safely rewritten */ }
}
export function queueDepth(): number { return readJson<QueuedWrite[]>(QUEUE_KEY, []).length; }
export function blockedQueueDepth(accountId: string | null): number {
  return readJson<QueuedWrite[]>(QUEUE_KEY, []).filter(w => !accountId || w.accountId !== accountId).length;
}
export function deadLetters(): DeadLetter[] { return readJson<DeadLetter[]>(DEAD_KEY, []); }

export function enqueue(write: Omit<QueuedWrite, 'id' | 'queuedAt'>): QueuedWrite {
  if (!write.accountId) throw new Error('Sign in and confirm your account before saving changes offline');
  const queue = readQueue().map(scrub);
  if (write.clientKey) {
    const at = queue.findIndex(w => w.accountId === write.accountId && w.clientKey === write.clientKey);
    if (at >= 0) queue.splice(at, 1);
  }
  const row: QueuedWrite = scrub({ ...write, id: `qw_${Date.now().toString(36)}_${crypto.randomUUID()}`,
    queuedAt: new Date().toISOString() });
  queue.push(row);
  // Never silently discard pending economic writes when storage fills.
  if (queue.length > MAX_QUEUE) throw new Error('Offline queue is full; reconnect before saving more changes');
  writeJson(QUEUE_KEY, queue);
  // Some browsers silently refuse persistence. Do not tell the user the write is safe.
  if (!readQueue().some(w => w.id === row.id)) throw new Error('Offline storage did not save this change');
  return row;
}

export type Replayer = (write: QueuedWrite) => Promise<{ ok: boolean; error?: string }>;
let replaying: Promise<number> | null = null;
/** Replay only the active account, preserving entries added during awaits. */
export function replayQueue(replayer: Replayer, accountId: string | null = null): Promise<number> {
  if (replaying) return replaying;
  if (!accountId) return Promise.resolve(0);
  replaying = (async () => {
    const snapshot = readQueue().filter(w => w.accountId === accountId);
    let landed = 0;
    for (const write of snapshot) {
      let outcome: { ok: boolean; error?: string };
      try { outcome = await replayer(scrub(write)); }
      catch { break; } // still offline: preserve this and the remainder
      // Read current storage AFTER each await. Remove only this id, never
      // replace the whole snapshot; new writes and other accounts survive.
      const current = readQueue();
      if (!current.some(w => w.id === write.id)) continue;
      if (!outcome.ok) {
        const dead = readJson<DeadLetter[]>(DEAD_KEY, []);
        writeJson(DEAD_KEY, [...dead, { ...scrub(write), error: outcome.error ?? 'refused on replay', failedAt: new Date().toISOString() }].slice(-50));
      }
      writeJson(QUEUE_KEY, current.filter(w => w.id !== write.id).map(scrub));
      if (outcome.ok) landed++;
    }
    return landed;
  })().finally(() => { replaying = null; });
  return replaying;
}
export function clearDeadLetters(): void { writeJson(DEAD_KEY, []); }
