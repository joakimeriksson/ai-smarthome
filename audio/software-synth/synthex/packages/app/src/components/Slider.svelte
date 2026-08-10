<script lang="ts">
  // Synthex vertical fader: toothed/ladder track with a wide light-gray
  // fader cap (a center groove line), matching the real panel's LFO2 sliders.
  // Drag up/down to adjust. Shift = fine.

  interface Props {
    value: number
    min?: number
    max?: number
    default?: number
    label: string
    onchange: (v: number) => void
    height?: number
  }

  let {
    value, min = 0, max = 1, default: def = 0,
    label, onchange, height = 64,
  }: Props = $props()

  function clamp(v: number): number { return Math.max(min, Math.min(max, v)) }

  let dragging = $state(false)
  let dragStartY = 0
  let dragStartV = 0
  let speed = 1

  function pointerDown(e: PointerEvent) {
    dragging = true
    dragStartY = e.clientY
    dragStartV = value
    speed = e.shiftKey ? 0.25 : 1
    ;(e.target as Element).setPointerCapture(e.pointerId)
    document.body.classList.add('knob-dragging')
    e.preventDefault()
  }
  function pointerMove(e: PointerEvent) {
    if (!dragging) return
    const dy = dragStartY - e.clientY
    const range = max - min
    const next = clamp(dragStartV + (dy / height) * range * speed)
    if (next !== value) onchange(next)
    e.preventDefault()
  }
  function pointerUp(e: PointerEvent) {
    dragging = false
    ;(e.target as Element).releasePointerCapture(e.pointerId)
    document.body.classList.remove('knob-dragging')
  }
  function dblClick() { onchange(clamp(def)) }

  // Handle centre travels within the track, inset by half the cap height so
  // the cap never overhangs the track ends.
  const CAP = 11        // fader-cap height (px)
  let pos = $derived(1 - (value - min) / (max - min))
</script>

<div class="slider" style="--h:{height}px">
  <div
    class="track"
    role="slider"
    tabindex="0"
    aria-label={label}
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={value}
    onpointerdown={pointerDown}
    onpointermove={pointerMove}
    onpointerup={pointerUp}
    onpointercancel={pointerUp}
    ondblclick={dblClick}
  >
    <!-- Fader cap -->
    <div
      class="cap"
      class:active={dragging}
      style="top: calc({pos} * (var(--h) - {CAP}px))"
    >
      <div class="groove"></div>
    </div>
  </div>
  <div class="lbl">{label}</div>
</div>

<style>
  .slider {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    flex-shrink: 0;
    width: 26px;
  }
  .track {
    /* Narrow plain slot — the graduated scale is printed on the panel
       between the pair, not inside the track (see App .fader-scale). */
    width: 6px;
    height: var(--h);
    background: linear-gradient(90deg, #060504 0%, #0e0d0c 50%, #060504 100%);
    border-radius: 2px;
    position: relative;
    cursor: ns-resize;
    touch-action: none;
    user-select: none;
    box-shadow:
      inset 0 1px 3px rgba(0, 0, 0, 0.85),
      0 1px 0 rgba(255, 255, 255, 0.05);
  }

  /* Wide light-gray fader cap with a center groove */
  .cap {
    position: absolute;
    left: -5px;
    right: -5px;
    height: 11px;
    border-radius: 2px;
    background: linear-gradient(180deg, #d4d0c8 0%, #b4aea4 45%, #8e887e 55%, #a49e94 100%);
    border: 1px solid rgba(0, 0, 0, 0.5);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.5),
      0 2px 3px rgba(0, 0, 0, 0.55);
    pointer-events: none;
  }
  .groove {
    position: absolute;
    left: 1px;
    right: 1px;
    top: 50%;
    height: 2px;
    transform: translateY(-50%);
    background: linear-gradient(180deg, rgba(0,0,0,0.45), rgba(0,0,0,0.15));
    border-radius: 1px;
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.35);
  }
  .cap.active {
    background: linear-gradient(180deg, #e2ded6 0%, #c2bcb2 45%, #9c968c 55%, #b2aca2 100%);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.6),
      0 0 5px rgba(214, 90, 28, 0.35),
      0 2px 3px rgba(0, 0, 0, 0.55);
  }
  .lbl {
    /* Clearance for the cap overhang at min position. */
    margin-top: 6px;
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 600;
    font-size: 0.42rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink);
    line-height: 1;
    text-align: center;
    white-space: nowrap;
  }
</style>
