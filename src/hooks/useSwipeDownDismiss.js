import { useCallback, useRef, useState } from "react";

// Distance the user must drag (in px) before a release dismisses the modal.
const DISMISS_DISTANCE_PX = 90;
// A quick flick (high velocity) can dismiss at a shorter distance.
const FLICK_MIN_DISTANCE_PX = 40;
// Velocity threshold in px/ms — a fast downward flick.
const FLICK_VELOCITY_THRESHOLD = 0.35;
// Past the dismiss distance, apply rubber-band resistance so the modal
// doesn't fly off-screen if the user keeps dragging.
const RUBBER_BAND_FACTOR = 0.35;

/**
 * useSwipeDownDismiss
 *
 * Tracks a pointer drag (touch or mouse) on the attached element and
 * exposes a `dragY` value plus a set of pointer event handlers. When the
 * user releases:
 *   - if they dragged past DISMISS_DISTANCE_PX, or
 *   - if they did a quick downward flick (short distance, high velocity),
 * the hook fires `onDismiss` and animates `dragY` to the bottom of the
 * viewport so the modal slides off naturally.
 * Otherwise, `dragY` snaps back to 0.
 *
 * The hook is intentionally pointer-agnostic (pointerdown / pointermove /
 * pointerup) so it works for both touch and mouse drag — useful for
 * desktop QA. Callers should only render the grab handle on mobile via
 * CSS (`@media (hover: none)`) so desktop users don't see it.
 */
export function useSwipeDownDismiss({ onDismiss, enabled = true } = {}) {
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startRef = useRef(null);

  const onPointerDown = useCallback((event) => {
    if (!enabled) return;
    // Only respond to primary button on mouse, or any touch.
    if (event.pointerType === "mouse" && event.button !== 0) return;
    startRef.current = {
      y: event.clientY,
      time: performance.now(),
    };
    setIsDragging(true);
  }, [enabled]);

  const onPointerMove = useCallback((event) => {
    if (!startRef.current) return;
    const rawDelta = event.clientY - startRef.current.y;
    // Upward drag is ignored — we only support swipe-to-dismiss.
    if (rawDelta <= 0) {
      if (dragY !== 0) setDragY(0);
      return;
    }
    // Apply rubber-band resistance past the dismiss threshold.
    const resisted = rawDelta > DISMISS_DISTANCE_PX
      ? DISMISS_DISTANCE_PX + (rawDelta - DISMISS_DISTANCE_PX) * RUBBER_BAND_FACTOR
      : rawDelta;
    setDragY(resisted);
  }, [dragY]);

  const onPointerUp = useCallback((event) => {
    if (!startRef.current) return;
    const rawDelta = event.clientY - startRef.current.y;
    const deltaTime = performance.now() - startRef.current.time;
    const velocity = deltaTime > 0 ? Math.abs(rawDelta) / deltaTime : 0;

    const flickedDown = rawDelta > FLICK_MIN_DISTANCE_PX && velocity > FLICK_VELOCITY_THRESHOLD;
    const draggedFar = rawDelta > DISMISS_DISTANCE_PX;
    const shouldDismiss = flickedDown || draggedFar;

    startRef.current = null;
    setIsDragging(false);

    if (shouldDismiss) {
      // Animate the panel off-screen before the parent unmounts it.
      // Using a large value (3x viewport) so it clears any safe-area insets.
      setDragY(typeof window !== "undefined" ? window.innerHeight * 3 : 2000);
      onDismiss?.();
    } else {
      setDragY(0);
    }
  }, [onDismiss]);

  return {
    dragY,
    isDragging,
    handlers: { onPointerDown, onPointerMove, onPointerUp },
  };
}
