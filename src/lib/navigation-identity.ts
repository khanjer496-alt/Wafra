/** Same page + same query is one destination; different records/filters stay distinct. */
export function singlePageId(name: string, params: Record<string, unknown> = {}): string {
  return JSON.stringify([name, canonicalParams(params)]);
}

function canonicalParams(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalParams);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key, entry]) => entry !== undefined && !key.startsWith('__internal'))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonicalParams(entry)]));
  }
  return value;
}
