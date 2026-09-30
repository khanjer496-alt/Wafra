import { CATEGORIES, categorySupportsType, isCustomCategoryId, isRegisteredCategory } from '@/lib/categories';
import type { CategoryId, CustomCategory, CustomCategoryId, TransactionType } from '@/lib/types';

export const MAX_CUSTOM_CATEGORIES = 100;
export type CustomCategoryFailure = 'invalid-name' | 'duplicate-name' | 'limit' | 'not-ready';
export type CreateCustomCategoryResult = { ok: true; id: CustomCategoryId } | { ok: false; reason: CustomCategoryFailure };

/** Controls are rejected before whitespace normalization; never hide source text. */
export function normalizeCustomCategoryName(value: unknown): string | null {
  if (typeof value !== 'string' || /[\p{Cc}\p{Cf}]/u.test(value)) return null;
  const name = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return [...name].length >= 1 && [...name].length <= 40 ? name : null;
}
const nameKey = (name: string): string => name.normalize('NFKC').toLocaleLowerCase('en-US');
const builtinNames = new Set(CATEGORIES.flatMap((category) => [nameKey(category.label), nameKey(category.labelAr)]));

export function prepareCustomCategory(
  value: unknown, type: TransactionType, catalog: readonly CustomCategory[], id: CustomCategoryId,
): { ok: true; category: CustomCategory } | { ok: false; reason: CustomCategoryFailure } {
  const name = normalizeCustomCategoryName(value);
  if (!name || !isCustomCategoryId(id) || !categorySupportsType(id, type)) return { ok: false, reason: 'invalid-name' };
  if (catalog.length >= MAX_CUSTOM_CATEGORIES) return { ok: false, reason: 'limit' };
  const key = nameKey(name);
  if (builtinNames.has(key) || catalog.some((category) => nameKey(category.name) === key || category.id === id)) {
    return { ok: false, reason: 'duplicate-name' };
  }
  return { ok: true, category: { id, name, type } };
}

export function isValidCustomCategoryCatalog(value: unknown): value is CustomCategory[] {
  if (!Array.isArray(value) || value.length > MAX_CUSTOM_CATEGORIES) return false;
  const accepted: CustomCategory[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) ||
      Object.keys(candidate).some((key) => key !== 'id' && key !== 'name' && key !== 'type') ||
      normalizeCustomCategoryName(candidate.name) !== candidate.name ||
      (candidate.type !== 'expense' && candidate.type !== 'income')) return false;
    const result = prepareCustomCategory(candidate.name, candidate.type, accepted, candidate.id);
    if (!result.ok) return false;
    accepted.push(result.category);
  }
  return true;
}

/** Invalid local metadata is dropped; existing monetary rows are left untouched. */
export function sanitizeCustomCategoryCatalog(value: unknown): CustomCategory[] {
  if (!Array.isArray(value)) return [];
  const accepted: CustomCategory[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || (candidate.type !== 'expense' && candidate.type !== 'income')) continue;
    const result = prepareCustomCategory(candidate.name, candidate.type, accepted, candidate.id);
    if (result.ok) accepted.push(result.category);
    if (accepted.length === MAX_CUSTOM_CATEGORIES) break;
  }
  return accepted;
}

export function categoryAssignmentAllowed(id: unknown, type: unknown, catalog: readonly CustomCategory[] = []): id is CategoryId {
  return isRegisteredCategory(id, catalog) && categorySupportsType(id, type);
}
