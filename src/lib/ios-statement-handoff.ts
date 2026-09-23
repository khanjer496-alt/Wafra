import { randomUUID } from 'expo-crypto';

// A route parameter alone must never bypass the onboarding gate. Only an
// explicit tap in the mounted iPhone setup flow creates this in-memory token.
let activeToken: string | null = null;

export function beginIosStatementHandoff(): string {
  activeToken = randomUUID();
  return activeToken;
}

export function matchesIosStatementHandoff(value: unknown): boolean {
  return activeToken !== null && typeof value === 'string' && value === activeToken;
}

export function clearIosStatementHandoff(): void {
  activeToken = null;
}
