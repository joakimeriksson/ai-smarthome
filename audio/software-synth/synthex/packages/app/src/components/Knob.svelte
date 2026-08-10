<script lang="ts">
  // Dark Elka-X style rotary knob.
  // SVG composition: faint track arc → white indicator arc → dark recessed well →
  // dark metallic cap with subtle bevel → white pointer line.
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
    tickLabels?: (string | number)[]  // custom tick labels; length sets tick count
    light?: boolean  // silver/light cap (Master Tune style)
  }

  let {
    value, min = 0, max = 1, default: def = 0, step = 0,
    label, unit = '', format, onchange, size = 50, tickLabels, light = false,
  }: Props = $props()

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
  let readoutX = $state(0)
  let readoutY = $state(0)

  function pointerDown(e: PointerEvent) {
    dragging = true
    dragStartY = e.clientY
    dragStartV = value
    speed = e.shiftKey ? 0.25 : (e.metaKey || e.ctrlKey ? 4 : 1)
    ;(e.target as Element).setPointerCapture(e.pointerId)
    document.body.classList.add('knob-dragging')
    // Position readout above the knob using fixed coords
    const el = (e.target as Element).closest('.knob') as HTMLElement
    if (el) {
      const r = el.getBoundingClientRect()
      readoutX = r.left + r.width / 2
      readoutY = r.top - 4
    }
    e.preventDefault()
  }
  function pointerMove(e: PointerEvent) {
    if (!dragging) return
    const dy = dragStartY - e.clientY
    const range = max - min
    const next = clamp(snap(dragStartV + (dy / 200) * range * speed))
    if (next !== value) onchange(next)
    e.preventDefault()
  }
  function pointerUp(e: PointerEvent) {
    dragging = false
    ;(e.target as Element).releasePointerCapture(e.pointerId)
    document.body.classList.remove('knob-dragging')
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

  let pos01 = $derived((value - min) / (max - min))
  let angle = $derived(start + pos01 * sweep)

  const isBipolar = $derived(min < 0 && max > 0)
  let display = $derived(
    format ? format(value) :
    (Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(2)) + (unit ? ' ' + unit : '')
  )

  // Tick marks well outside the knob, numbers at the edge
  const tickInner = 34
  const tickRadius = 38
  const labelRadius = 44

  let tickData = $derived.by(() => {
    // Use custom labels if provided
    if (tickLabels) {
      return tickLabels.map((lbl, i) => ({
        frac: i / (tickLabels.length - 1),
        label: String(lbl),
      }))
    }
    // Auto-derive: integer ranges show actual values, 0-1 ranges show 0-10
    const range = max - min
    if (step >= 1 && range <= 24) {
      // Integer steps (transpose, range, etc.) — show actual values
      const count = Math.round(range / step) + 1
      const maxTicks = 13
      const skip = count > maxTicks ? Math.ceil(count / maxTicks) : 1
      const items: { frac: number; label: string }[] = []
      for (let i = 0; i < count; i += skip) {
        const val = min + i * step
        items.push({ frac: i / (count - 1), label: String(val) })
      }
      // Ensure last tick is included
      if (items[items.length - 1]?.frac !== 1) {
        items.push({ frac: 1, label: String(max) })
      }
      return items
    }
    if (isBipolar) {
      // Bipolar: show symmetric labels around center (e.g. 5..0..5)
      const half = 5
      const items: { frac: number; label: string }[] = []
      for (let i = 0; i <= half * 2; i++) {
        items.push({ frac: i / (half * 2), label: String(Math.abs(i - half)) })
      }
      return items
    }
    // Default: 0-10 scale
    return Array.from({ length: 11 }, (_, i) => ({
      frac: i / 10,
      label: String(i),
    }))
  })

  let ticks = $derived.by(() => {
    return tickData.map(t => {
      const deg = start + t.frac * sweep
      const rad = (deg - 90) * Math.PI / 180
      return {
        x1: 50 + tickInner * Math.cos(rad),
        y1: 50 + tickInner * Math.sin(rad),
        x2: 50 + tickRadius * Math.cos(rad),
        y2: 50 + tickRadius * Math.sin(rad),
        lx: 50 + labelRadius * Math.cos(rad),
        ly: 50 + labelRadius * Math.sin(rad),
        label: t.label,
      }
    })
  })
</script>

<div
  class="knob"
  class:active={dragging}
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
  {#if dragging}<div class="readout" style="left:{readoutX}px;top:{readoutY}px">{display}</div>{/if}

  <svg viewBox="-2 -2 104 104" width={size} height={size} aria-hidden="true">
    <defs>
      <!-- Knob cap: dark by default (matching real Synthex), silver for Master -->
      <radialGradient id="capGrad-{uid}" cx="0.40" cy="0.35" r="0.65">
        {#if light}
          <stop offset="0%" stop-color="#d8d4cc" />
          <stop offset="40%" stop-color="#c0bab0" />
          <stop offset="100%" stop-color="#908a80" />
        {:else}
          <stop offset="0%" stop-color="#484644" />
          <stop offset="40%" stop-color="#363432" />
          <stop offset="100%" stop-color="#222020" />
        {/if}
      </radialGradient>
      <!-- Dark recessed well / panel cutout -->
      <radialGradient id="wellGrad-{uid}" cx="0.5" cy="0.45" r="0.6">
        <stop offset="0%" stop-color="#181614" />
        <stop offset="100%" stop-color="#080706" />
      </radialGradient>
    </defs>

    <!-- Tick marks + numbers (screen-printed on panel). Numbers become
         unreadable noise below ~40px — small knobs keep ticks only. -->
    {#each ticks as t, i (i)}
      <line x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} class="tick" />
      {#if size >= 40}
        <text x={t.lx} y={t.ly} class="tick-num">{t.label}</text>
      {/if}
    {/each}

    <!-- Thin shadow ring where knob meets panel -->
    <circle cx="50" cy="50" r="24.5" fill="none"
      stroke="rgba(0,0,0,0.3)" stroke-width="1" />

    <!-- Knob cap — sits directly on panel -->
    <circle cx="50" cy="50" r="23" fill="url(#capGrad-{uid})"
      stroke="rgba(0,0,0,0.4)" stroke-width="0.6" />
    <!-- Top-edge highlight for 3D effect -->
    <circle cx="50" cy="50" r="22.5" fill="none"
      stroke={light ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)'} stroke-width="0.5" />

    <!-- Pointer line (white on silver knob, matching real Synthex) -->
    <line
      x1={50 + 22 * Math.cos((angle - 90) * Math.PI / 180)}
      y1={50 + 22 * Math.sin((angle - 90) * Math.PI / 180)}
      x2={50 + 6 * Math.cos((angle - 90) * Math.PI / 180)}
      y2={50 + 6 * Math.sin((angle - 90) * Math.PI / 180)}
      class="pointer"
    />
    <!-- Center pip -->
    <circle cx="50" cy="50" r="1.8" fill={light ? '#5a5650' : '#1a1818'} />
  </svg>

  <div class="label">{label}</div>
</div>

<style>
  .knob {
    width: var(--size);
    min-width: 0;
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    cursor: ns-resize;
    touch-action: none;
    user-select: none;
    position: relative;
    outline: none;
    flex-shrink: 0;
  }
  .knob:focus-visible svg {
    filter: drop-shadow(0 0 2px var(--orange-bright));
  }
  /* Active (dragging) — subtle glow */
  .knob.active svg {
    filter: drop-shadow(0 0 4px rgba(214, 90, 28, 0.4));
  }
  .knob.active .pointer { stroke: #fff; stroke-width: 3.2; }
  .knob.active .label { color: var(--orange); }

  .tick    { stroke: rgba(255, 255, 255, 0.6); stroke-width: 1.2; stroke-linecap: round; }
  .tick-num {
    fill: var(--ink, #e8e4dc);
    font-size: 12px;
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    text-anchor: middle;
    dominant-baseline: central;
  }
  .pointer { stroke: #ffffff; stroke-width: 2.8; stroke-linecap: round; }

  .label {
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--ink);
    margin-top: 0.18rem;
    text-align: center;
    line-height: 1;
    white-space: nowrap;
  }
  .readout {
    position: fixed;
    transform: translateX(-50%) translateY(-100%);
    background: #1a0606;
    color: var(--led);
    padding: 0.18rem 0.55rem;
    border-radius: 2px;
    font-family: 'Share Tech Mono', monospace;
    font-size: 0.75rem;
    pointer-events: none;
    white-space: nowrap;
    text-shadow: 0 0 4px var(--led-glow);
    border: 1px solid #4a0a05;
    z-index: 200;
    box-shadow:
      inset 0 0 6px rgba(255, 40, 24, 0.25),
      0 2px 8px rgba(0, 0, 0, 0.6);
  }
</style>
