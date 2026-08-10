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
  let previousChunks: string[] = [];
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
    previousChunks = [];
    previousTransactions = null;
  };

  const resetWriteCache = (): void => {
    previousChunkCount = 0;
    previousChunks = [];
    previousTransactions = null;
    storedChunkOrder = currentChunkOrder;
  };

  const readSnapshot = async (): Promise<PersistedState | null> => {
    let raw = await storage.getItem(prefix);
    if (!raw && (await migrateLegacyState(prefix))) raw = await storage.getItem(prefix);
    if (!raw) {
      resetWriteCache();
      return null;
    }

    const parsed = JSON.parse(raw) as PersistedMeta;
    const chunkBodies: string[] = [];
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
              chunkBodies.push(value);
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
    previousChunks = corrupt ? [] : chunkBodies;
    storedChunkOrder = chunkOrder;
    previousTransactions = parsed.transactions ?? [];
    return parsed;
  };

  /** Write one snapshot inside the module's already-serial operation. */
  const writeSnapshot = async (snapshot: AppState): Promise<void> => {
    const { hydrated: _hydrated, transactions, ...meta } = snapshot;
    const transactionsChanged = previousTransactions !== transactions;
    const chunks: [string, string][] | null = transactionsChanged
      ? chunkTransactions(transactions).map(
          (body, index): [string, string] => [chunkKey(index), body],
        )
      : null;
    const chunkCount = chunks ? chunks.length : previousChunkCount;
    const order = chunks ? currentChunkOrder : storedChunkOrder;

    try {
      const changed = chunks
        ? chunks.filter(([, body], index) => previousChunks[index] !== body)
        : [];
      await storage.multiSet([
        [prefix, JSON.stringify({ ...meta, txChunks: chunkCount, txChunkOrder: order })],
        ...changed,
      ]);
      if (chunks && previousChunkCount > chunks.length) {
        await storage.multiRemove(
          Array.from(
            { length: previousChunkCount - chunks.length },
            (_, index) => chunkKey(chunks.length + index),
          ),
        );
      }
      if (chunks) {
        previousChunkCount = chunks.length;
        previousChunks = chunks.map(([, body]) => body);
        storedChunkOrder = currentChunkOrder;
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
