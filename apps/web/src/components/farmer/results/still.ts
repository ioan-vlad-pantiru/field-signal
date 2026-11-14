/**
 * The season strips are the page's one animation, so shared charts inside this wrapper stay still.
 * It also drops the one-unit dash the line-draw uses: with non-scaling strokes Chrome measures it in
 * screen space and cuts the line short.
 * Marked important because the global `.draw` and `.rise` rules sit outside Tailwind's layers.
 */
export const STILL = "[&_.draw]:[animation:none]! [&_.draw]:[stroke-dasharray:none]! [&_.rise]:[animation:none]!";
