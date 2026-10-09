/**
 * The Spent card's tilt: the phone's attitude (DeviceMotion rotation, in
 * radians) turned into a small lean of the card, at most TILT_MAX_DEG either
 * way. The lean follows how the phone moves from the way it is being held,
 * not its absolute angle: the resting pose is a slow average of the readings,
 * so a phone held at any angle settles flat. Each reading is smoothed before
 * it is drawn. Right to left mirrors the side-to-side lean. Pure.
 */
export const TILT_MAX_DEG = 4;
/** Card degrees per radian the phone moves away from its resting pose. */
const DEG_PER_RADIAN = 22;
/** How quickly the drawn lean follows a reading (per update, 0–1). */
const FOLLOW = 0.22;
/** How quickly the resting pose drifts to the current hold (per update, 0–1). */
const SETTLE = 0.02;

export interface TiltState {
  /** Resting pose: beta (front–back) and gamma (side to side), radians. */
  restBeta: number;
  restGamma: number;
  /** The lean drawn: rotateX and rotateY, degrees. */
  x: number;
  y: number;
}

const clamp = (value: number) => Math.max(-TILT_MAX_DEG, Math.min(TILT_MAX_DEG, value));

/** The next drawn lean after one reading; a reading without numbers changes nothing. */
export function tiltStep(state: TiltState | null, beta: number, gamma: number, rtl: boolean): TiltState | null {
  if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return state;
  if (!state) return { restBeta: beta, restGamma: gamma, x: 0, y: 0 };
  const restBeta = state.restBeta + (beta - state.restBeta) * SETTLE;
  const restGamma = state.restGamma + (gamma - state.restGamma) * SETTLE;
  // Tipping the top away leans the card's top back; rolling right turns it to the right.
  const targetX = clamp(-(beta - restBeta) * DEG_PER_RADIAN);
  const targetY = clamp((gamma - restGamma) * DEG_PER_RADIAN * (rtl ? -1 : 1));
  return {
    restBeta, restGamma,
    x: clamp(state.x + (targetX - state.x) * FOLLOW),
    y: clamp(state.y + (targetY - state.y) * FOLLOW),
  };
}

/** Updates a second (about 30 a second): smooth to the eye, light on the bridge. */
export const TILT_INTERVAL_MS = 33;
