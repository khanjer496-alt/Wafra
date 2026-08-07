/**
 * AsyncStorage as a Map. The staging area between a background fetch and a
 * foreground ledger write lives here, so tests can read it directly and check
 * what survives a "restart" (a fresh read of the same store).
 */
const items = new Map<string, string>();

export const __storage = {
  items,
  reset(): void {
    items.clear();
  },
};

const AsyncStorage = {
  async getItem(key: string): Promise<string | null> {
    return items.get(key) ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    items.set(key, value);
  },
  async removeItem(key: string): Promise<void> {
    items.delete(key);
  },
};

export default AsyncStorage;
