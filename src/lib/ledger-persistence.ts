/**
 * Durable persistence for Wafra's whole ledger snapshot.
 *
 * The native storage adapter deliberately exposes a small encrypted key/value
 * interface. The ledger still has higher-level invariants that do not belong
 * in React: chunk layout compatibility, diff-cache advancement, save ordering,
 * blocking after a failed load, and the erase-then-initialize lifecycle. This
 * module owns those invariants behind four operations so StoreProvider cannot
 * accidentally reimplement their ordering.
 */
import type { StateStorage } from '@/lib/state-storage';
import type { AppState, Transaction } from '@/lib/types';

type PersistedState = Partial<Omit<AppState, 'hydrated'>>;

type PersistedMeta = PersistedState & {
  txChunks?: number;
  txChunkOrder?: string;
};

type ChunkOrder = 'oldest-first' | 'newest-first';

export interface LedgerPersistence {
  /** A successful null means the encrypted store is genuinely empty. */
  load(): Promise<PersistedState | null>;
  /** Resolves only after the snapshot is durably written. False means blocked. */
  save(snapshot: AppState): Promise<boolean>;
  /** Synchronously supersede every admitted write until load/reset succeeds. */
  block(): void;
  /** Cryptographically erase, then durably create the latest post-reset state. */
  reset(snapshotAfterErase: () => { snapshot: AppState; revision: number }): Promise<void>;
}

export type LedgerResetStage = 'destroy' | 'initialize';

/**
 * Closed-vocabulary reset attribution. The native error stays available to
 * diagnostics but never becomes UI copy.
 */
export class LedgerResetError extends Error {
  constructor(
    readonly stage: LedgerResetStage,
    readonly original: unknown,
  ) {
    super(stage === 'destroy' ? 'Encrypted ledger erase failed' : 'Blank encrypted store failed');
    this.name = 'LedgerResetError';
  }
}

interface LedgerPersistenceOptions {
  prefix: string;
  chunkSize: number;
  currentChunkOrder: 'oldest-first';
  chunkTransactions(transactions: Transaction[]): string[];
  storage: StateStorage;
  migrateLegacyState(prefix: string): Promise<boolean>;
}

type Mode = 'blocked' | 'ready' | 'resetting';

/**
 * Construction is exported for an in-memory adapter in interface tests. The
 * shipping StoreProvider creates one instance for its lifetime.
 */
export function createLedgerPersistence({
  prefix,
  chunkSize,
  currentChunkOrder,
  chunkTransactions,
  storage,
  migrateLegacyState,
}: LedgerPersistenceOptions): LedgerPersistence {
  const chunkKey = (index: number) => `${prefix}:tx:${index}`;

  let mode: Mode = 'blocked';
  let previousChunkCount = 0;
  let previousTransactions: Transaction[] | null = null;
  let storedChunkOrder: ChunkOrder = currentChunkOrder;
  let lifecycleGeneration = 0;
  let readyGeneration = -1;

  // One failed operation must not wedge later recovery work. Callers retain
  // each operation's real promise while the shared tail always settles.
  let operationTail: Promise<void> = Promise.resolve();

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const operation = operationTail.then(task, task);
    operationTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };

  const clearWriteCache = (): void => {
    previousTransactions = null;
  };

  const resetWriteCache = (): void => {
    previousChunkCount = 0;
    previousTransactions = null;
    storedChunkOrder = currentChunkOrder;
  };

  // Native SQLCipher supplies a connection-wide snapshot lease. The fallback
  // keeps in-memory/test and older browser adapters source-compatible.
  const withSnapshotRead = <T>(task: () => Promise<T>): Promise<T> =>
    storage.withSnapshotRead ? storage.withSnapshotRead(task) : task();

  const readExistingSnapshot = async (): Promise<PersistedState | null> =>
    withSnapshotRead(async () => {
      const raw = await storage.getItem(prefix);
      if (!raw) {
        resetWriteCache();
        return null;
      }

      const parsed = JSON.parse(raw) as PersistedMeta;
      const chunkOrder: ChunkOrder =
        parsed.txChunkOrder === currentChunkOrder ? currentChunkOrder : 'newest-first';
      let corrupt = false;

      if (!Array.isArray(parsed.transactions)) {
        const count = Number(parsed.txChunks) || 0;
        const blocks: Transaction[][] = [];
        if (count > 0) {
          const pairs = await storage.multiGet(
            Array.from({ length: count }, (_, index) => chunkKey(index)),
          );
          for (const [, value] of pairs) {
            if (!value) {
              corrupt = true;
              continue;
            }
            try {
              const rows = JSON.parse(value) as Transaction[];
              if (Array.isArray(rows)) {
                blocks.push(rows);
              } else {
                corrupt = true;
              }
            } catch {
              corrupt = true;
            }
          }
        }
        if (chunkOrder === currentChunkOrder) blocks.reverse();
        parsed.transactions = blocks.flat();
      }

      delete parsed.txChunks;
      delete parsed.txChunkOrder;

      previousChunkCount = Math.ceil((parsed.transactions?.length ?? 0) / chunkSize);
      storedChunkOrder = chunkOrder;
      // A partial/corrupt read must never become the identity baseline for a
      // later "unchanged chunk" decision. Force the next write to rebuild all
      // chunk keys from the recovered in-memory snapshot instead.
      previousTransactions = corrupt ? null : parsed.transactions ?? [];
      return parsed;
    });

  const readSnapshot = async (): Promise<PersistedState | null> => {
    const existing = await readExistingSnapshot();
    if (existing) return existing;
    // Legacy migration writes into the encrypted store, so it must run OUTSIDE
    // the snapshot-read lock. Re-enter the lock only after that write settles.
    if (await migrateLegacyState(prefix)) return readExistingSnapshot();
    return null;
  };

  /** Logical row range for one persisted chunk in either supported layout. */
  const chunkRange = (length: number, index: number, order: ChunkOrder): [number, number] => {
    if (order === 'newest-first') {
      const start = index * chunkSize;
      return [start, Math.min(length, start + chunkSize)];
    }
    const end = length - index * chunkSize;
    return [Math.max(0, end - chunkSize), Math.max(0, end)];
  };

  /**
   * Store snapshots are immutable. Before serialising a chunk, compare the row
   * objects that would occupy it with the previous durable snapshot. This is a
   * cheap O(n) reference walk and avoids JSON.stringify over the entire ledger
   * when a history page healed only a narrow date window.
   */
  const chunkRowsUnchanged = (
    transactions: Transaction[],
    index: number,
    order: ChunkOrder,
  ): boolean => {
    if (!previousTransactions || storedChunkOrder !== order) return false;
    const [start, end] = chunkRange(transactions.length, index, order);
    const [priorStart, priorEnd] = chunkRange(previousTransactions.length, index, order);
    if (end - start !== priorEnd - priorStart) return false;
    for (let offset = 0; offset < end - start; offset += 1) {
      if (transactions[start + offset] !== previousTransactions[priorStart + offset]) return false;
    }
    return true;
  };

  const serializeChunk = (transactions: Transaction[], index: number, order: ChunkOrder): string => {
    const [start, end] = chunkRange(transactions.length, index, order);
    return JSON.stringify(transactions.slice(start, end));
  };

  /** Write one snapshot inside the module's already-serial operation. */
  const writeSnapshot = async (snapshot: AppState): Promise<void> => {
    const { hydrated: _hydrated, transactions, ...meta } = snapshot;
    const transactionsChanged = previousTransactions !== transactions;
    // History is read newest-to-oldest: each page appends OLDER transactions.
    // Tail-anchored (oldest-first) chunks shift on every append, rewriting the
    // imported history through SQLCipher. Anchor at the newest end while the
    // durable history job is unfinished, including pause/failure/restart.
    // Both layouts already have a persisted marker and an exact reader above.
    // Completion converts once, atomically with the final cursor, to the
    // ordinary oldest-first layout optimized for future incoming messages.
    // Unrelated metadata-only saves keep legacy layouts until rows change.
    const targetOrder: ChunkOrder = snapshot.historyImport
      ? snapshot.historyImport.status === 'complete' ? currentChunkOrder : 'newest-first'
      : transactionsChanged ? currentChunkOrder : storedChunkOrder;
    const layoutChanged = targetOrder !== storedChunkOrder;
    const needsChunks = transactionsChanged || layoutChanged;
    const chunkCount = needsChunks ? Math.ceil(transactions.length / chunkSize) : previousChunkCount;
    const order = needsChunks ? targetOrder : storedChunkOrder;
    let changed: [string, string][] = [];

    if (needsChunks) {
      // A layout conversion changes every key's meaning, so write every chunk
      // once. Ordinary immutable updates stay on the fast identity-diff path.
      //
      // Do NOT retain the serialized chunk bodies after this write. On a large
      // ledger that kept a second full JSON representation alive beside the
      // parsed transaction objects for the whole app session, increasing steady
      // memory and GC pressure. Row identity already tells us which ordinary
      // chunks are unchanged; a rewritten chunk is cheap enough to write once.
      if (layoutChanged || !previousTransactions) {
        const bodies = order === currentChunkOrder
          ? chunkTransactions(transactions)
          : Array.from({ length: chunkCount }, (_, index) => serializeChunk(transactions, index, order));
        changed = bodies.map((body, index) => [chunkKey(index), body]);
      } else {
        for (let index = 0; index < chunkCount; index += 1) {
          if (chunkRowsUnchanged(transactions, index, order)) continue;
          const body = serializeChunk(transactions, index, order);
          changed.push([chunkKey(index), body]);
        }
      }
    }

    try {
      await storage.multiSet([
        [prefix, JSON.stringify({ ...meta, txChunks: chunkCount, txChunkOrder: order })],
        ...changed,
      ]);
      if (needsChunks && previousChunkCount > chunkCount) {
        await storage.multiRemove(
          Array.from(
            { length: previousChunkCount - chunkCount },
            (_, index) => chunkKey(chunkCount + index),
          ),
        );
      }
      if (needsChunks) {
        previousChunkCount = chunkCount;
        storedChunkOrder = order;
      }
      previousTransactions = transactions;
    } catch (error) {
      // The next save must assume none of this attempt landed. Keep the old
      // count so it can still remove stale tail keys after a partial write.
      clearWriteCache();
      throw error;
    }
  };

  return {
    block() {
      lifecycleGeneration += 1;
      mode = 'blocked';
      readyGeneration = -1;
      clearWriteCache();
    },

    load() {
      // A retry cannot reopen writes while its read is still unresolved.
      const generation = ++lifecycleGeneration;
      mode = 'blocked';
      return enqueue(async () => {
        try {
          const loaded = await readSnapshot();
          // A newer requested load still owns the latch. An earlier success
          // cannot create a write window ahead of that later read.
          if (generation === lifecycleGeneration) {
            mode = 'ready';
            readyGeneration = generation;
          }
          return loaded;
        } catch (error) {
          if (generation === lifecycleGeneration) {
            mode = 'blocked';
            readyGeneration = -1;
          }
          clearWriteCache();
          throw error;
        }
      });
    },

    save(snapshot) {
      if (mode !== 'ready') return Promise.resolve(false);
      const admittedGeneration = lifecycleGeneration;
      return enqueue(async () => {
        // Admission and execution both belong to the same successful
        // lifecycle. A later load/reset supersedes queued snapshots.
        if (
          mode !== 'ready' ||
          admittedGeneration !== lifecycleGeneration ||
          readyGeneration !== admittedGeneration
        ) return false;
        await writeSnapshot(snapshot);
        return true;
      });
    },

    reset(snapshotAfterErase) {
      // Synchronous with the call: a render caused by the blank dispatch may
      // schedule a save immediately, and that save must already be refused.
      const generation = ++lifecycleGeneration;
      mode = 'resetting';
      readyGeneration = -1;
      return enqueue(async () => {
        try {
          await storage.destroy(prefix);
        } catch (error) {
          if (generation === lifecycleGeneration) mode = 'blocked';
          clearWriteCache();
          throw new LedgerResetError('destroy', error);
        }

        // The old ledger is gone. The controlled initialization writes without
        // opening the public save path; only the latest lifecycle may reopen.
        resetWriteCache();
        try {
          // Mutations/capture may legitimately arrive while encrypted destroy
          // or initialization is running. Keep reconciling the authoritative
          // snapshot until its monotonic revision remains stable across a
          // durable write; once stable, every later change uses normal save().
          let writtenRevision: number;
          do {
            const current = snapshotAfterErase();
            writtenRevision = current.revision;
            await writeSnapshot(current.snapshot);
          } while (snapshotAfterErase().revision !== writtenRevision);
        } catch (error) {
          if (generation === lifecycleGeneration) mode = 'blocked';
          throw new LedgerResetError('initialize', error);
        }
        if (generation === lifecycleGeneration) {
          mode = 'ready';
          readyGeneration = generation;
        }
      });
    },
  };
}
