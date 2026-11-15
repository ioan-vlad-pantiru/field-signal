/** Pixels a sheet must be pulled down to close, at most (shorter sheets need less). */
export const DISMISS_DISTANCE = 140;
/** A flick this fast (px/ms, downwards) closes the sheet whatever the distance. */
export const DISMISS_VELOCITY = 0.6;

/**
 * Whether a drag of `dy` px at `velocity` px/ms should close a sheet `height` px tall: a fast flick
 * down, or a pull past a third of the sheet (capped at DISMISS_DISTANCE). Short taps never close.
 */
export function dismissAfterDrag(dy: number, velocity: number, height: number): boolean {
  if (dy < 12) return false;
  if (velocity >= DISMISS_VELOCITY) return true;
  return dy >= Math.min(DISMISS_DISTANCE, Math.max(60, height / 3));
}
