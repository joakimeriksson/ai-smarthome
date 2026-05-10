<script lang="ts">
  // Recessed Synthex-style rotary knob.
  // SVG composition: orange arc track → black indicator arc → recessed well →
  // cream cap with subtle bevel → white pointer line.
  //
  // Vertical drag adjusts value. Shift = fine ×0.25, Cmd/Ctrl = coarse ×4.
  // Double-click = default. Wheel + arrow keys for keyboard accessibility.

  interface Props {
    value: number
    min?: number
    max?: number
    default?: number
    step?: number
    label: string
    unit?: string
    format?: (v: number) => string
    onchange: (v: number) => void
    size?: number
  }

  let {
    value, min = 0, max = 1, default: def = 0, step = 0,
    label, unit = '', format, onchange, size = 50,
  }: Props = $props()

  // SVG <defs> ids must not contain spaces or special characters. Labels
  // can have either ("1→2 PWM"), so we use a per-instance random suffix
  // instead of the label itself to scope the gradient definitions.
  const uid = Math.random().toString(36).slice(2, 10)

  const sweep = 280
  const start = -140

  function clamp(v: number): number { return Math.max(min, Math.min(max, v)) }
  function snap(v: number): number {
    return step > 0 ? Math.round(v / step) * step : v
  }

  let dragging = $state(false)
  let dragStartY = 0
  let dragStartV = 0
  let speed = 1

  function pointerDown(e: PointerEvent) {
    dragging = true
    dragStartY = e.clientY
    dragStartV = value
    speed = e.shiftKey ? 0.25 : (e.metaKey || e.ctrlKey ? 4 : 1)
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }
  function pointerMove(e: PointerEvent) {
    if (!dragging) return
    const dy = dragStartY - e.clientY
    const range = max - min
    const next = clamp(snap(dragStartV + (dy / 200) * range * speed))
    if (next !== value) onchange(next)
  }
  function pointerUp(e: PointerEvent) {
    dragging = false
    ;(e.target as Element).releasePointerCapture(e.pointerId)
  }
  function dblClick() { onchange(clamp(snap(def))) }
  function wheel(e: WheelEvent) {
    e.preventDefault()
    const range = max - min
    const delta = -e.deltaY / 1500 * range * (e.shiftKey ? 0.25 : 1)
    onchange(clamp(snap(value + delta)))
  }
  function key(e: KeyboardEvent) {
    const range = max - min
    const fine = e.shiftKey ? 0.01 : 0.05
    if (e.key === 'ArrowUp')   { onchange(clamp(snap(value + range * fine))); e.preventDefault() }
    if (e.key === 'ArrowDown') { onchange(clamp(snap(value - range * fine))); e.preventDefault() }
    if (e.key === 'Home')      { onchange(min); e.preventDefault() }
    if (e.key === 'End')       { onchange(max); e.preventDefault() }
  }

  // Map value position 0..1 along the sweep
  let pos01 = $derived((value - min) / (max - min))
  let angle = $derived(start + pos01 * sweep)

  // Arc indicator path — bipolar knobs (min<0 && max>0) fill from center, others fill from start.
  const isBipolar = $derived(min < 0 && max > 0)
  const arcRadius = 41

  function polar(deg: number, r: number = arcRadius): { x: number; y: number } {
    const rad = (deg - 90) * Math.PI / 180
    return { x: 50 + r * Math.cos(rad), y: 50 + r * Math.sin(rad) }
  }
  function arcPath(fromDeg: number, toDeg: number): string {
    if (Math.abs(toDeg - fromDeg) < 0.1) return ''
    const a = polar(fromDeg)
    const b = polar(toDeg)
    const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0
    const sweep = toDeg > fromDeg ? 1 : 0
    return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${arcRadius} ${arcRadius} 0 ${large} ${sweep} ${b.x.toFixed(2)} ${b.y.toFixed(2)}`
  }

  let trackPath = $derived(arcPath(start, start + sweep))
  let indicatorPath = $derived.by(() => {
    if (isBipolar) {
      const center = start + sweep * (-min / (max - min))
      return arcPath(center, angle)
    }
    return arcPath(start, angle)
  })

  let display = $derived(
    format ? format(value) :
    (Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(2)) + (unit ? ' ' + unit : '')
  )
</script>

<div
  class="knob"
  style="--size:{size}px"
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
  onwheel={wheel}
  onkeydown={key}
>
  <div class="readout-anchor">
    {#if dragging}<div class="readout">{display}</div>{/if}
  </div>

  <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
    <defs>
      <radialGradient id="capGrad-{uid}" cx="0.35" cy="0.30" r="0.85">
        <stop offset="0%" stop-color="#fbf6e7" />
        <stop offset="55%" stop-color="#e6dec5" />
        <stop offset="100%" stop-color="#b1a585" />
      </radialGradient>
      <radialGradient id="wellGrad-{uid}" cx="0.5" cy="0.5" r="0.7">
        <stop offset="0%" stop-color="#bcb29a" />
        <stop offset="80%" stop-color="#857d68" />
        <stop offset="100%" stop-color="#5c5648" />
      </radialGradient>
    </defs>

    <!-- Outer screen-printed track (faint scale arc) -->
    <path d={trackPath} class="track" />
    <!-- Filled arc indicating the current value -->
    <path d={indicatorPath} class="arc" />

    <!-- Recessed well (the panel cut-out) -->
    <circle cx="50" cy="50" r="34" fill="url(#wellGrad-{uid})" />
    <!-- Knob cap (cream, subtle bevel) -->
    <circle cx="50" cy="50" r="29" fill="url(#capGrad-{uid})" stroke="#3a3225" stroke-width="0.6" />

    <!-- Pointer line — extends from cap edge inward; dark at the edge so it
         reads against any cap shade. -->
    <line
      x1={50 + 28 * Math.cos((angle - 90) * Math.PI / 180)}
      y1={50 + 28 * Math.sin((angle - 90) * Math.PI / 180)}
      x2={50 + 13 * Math.cos((angle - 90) * Math.PI / 180)}
      y2={50 + 13 * Math.sin((angle - 90) * Math.PI / 180)}
      class="pointer"
    />
    <!-- Tiny center pip -->
    <circle cx="50" cy="50" r="2.2" fill="#3a3225" />
  </svg>

  <div class="label">{label}</div>
</div>

<style>
  .knob {
    width: var(--size);
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    cursor: ns-resize;
    touch-action: none;
    user-select: none;
    position: relative;
    outline: none;
  }
  .readout-anchor {
    position: relative;
    width: 100%;
    height: 0;
  }
  .knob:focus-visible svg {
    filter: drop-shadow(0 0 2px var(--orange-bright));
  }
  .track   { fill: none; stroke: rgba(0, 0, 0, 0.18); stroke-width: 2.4; stroke-linecap: round; }
  .arc     { fill: none; stroke: var(--orange); stroke-width: 3.2; stroke-linecap: round; }
  .pointer { stroke: #2a221a; stroke-width: 2.6; stroke-linecap: round; }

  .label {
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 600;
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--ink);
    margin-top: 0.18rem;
    text-align: center;
    line-height: 1;
  }
  .readout {
    position: absolute;
    bottom: 0.35rem;
    left: 50%;
    transform: translateX(-50%);
    background: #1a0606;
    color: var(--led);
    padding: 0.15rem 0.5rem;
    border-radius: 2px;
    font-family: 'Share Tech Mono', monospace;
    font-size: 0.7rem;
    pointer-events: none;
    white-space: nowrap;
    text-shadow: 0 0 4px var(--led-glow);
    border: 1px solid #4a0a05;
    z-index: 4;
    box-shadow:
      inset 0 0 6px rgba(255, 40, 24, 0.25),
      0 1px 3px rgba(0, 0, 0, 0.35);
  }
</style>
