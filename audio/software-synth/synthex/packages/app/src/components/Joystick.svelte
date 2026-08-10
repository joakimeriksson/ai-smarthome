<script lang="ts">
  // Synthex spring-return XY joystick (the signature bender, left of the
  // keyboard on the real unit). Drag to deflect; releases snap back to
  // center. X is typically pitch bend, Y filter/LFO mod — routing is the
  // caller's business via onchange.
  interface Props {
    onchange: (x: number, y: number) => void
    // Optional screen-print around the well (real panel: BEND+ / BEND- /
    // TO OSC. / TO FILTER).
    topLabel?: string
    bottomLabel?: string
    leftLabel?: string
    rightLabel?: string
  }
  let { onchange, topLabel = '', bottomLabel = '', leftLabel = '', rightLabel = '' }: Props = $props()

  let x = $state(0)
  let y = $state(0)
  let dragging = $state(false)
  let well: HTMLElement | undefined = $state()

  function setFromEvent(e: PointerEvent) {
    if (!well) return
    const r = well.getBoundingClientRect()
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1
    const ny = -(((e.clientY - r.top) / r.height) * 2 - 1)
    x = Math.max(-1, Math.min(1, nx))
    y = Math.max(-1, Math.min(1, ny))
    onchange(x, y)
  }
  function down(e: PointerEvent) {
    dragging = true
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    setFromEvent(e)
    e.preventDefault()
  }
  function move(e: PointerEvent) {
    if (dragging) { setFromEvent(e); e.preventDefault() }
  }
  function up(e: PointerEvent) {
    dragging = false
    ;(e.currentTarget as Element).releasePointerCapture(e.pointerId)
    // Spring return to center, like the real hardware.
    x = 0; y = 0
    onchange(0, 0)
  }
</script>

<div class="joy">
  {#if topLabel}<div class="edge top">{topLabel}</div>{/if}
  <div class="mid">
  {#if leftLabel}<div class="edge side">{leftLabel}</div>{/if}
  <div
    class="well"
    class:dragging
    bind:this={well}
    role="slider"
    aria-label="Joystick"
    aria-valuemin={-1}
    aria-valuemax={1}
    aria-valuenow={x}
    tabindex="0"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
  >
    <div class="cross-h"></div>
    <div class="cross-v"></div>
    <div
      class="stick"
      class:sprung={!dragging}
      style="left: calc(50% + {x * 34}%); top: calc(50% - {y * 34}%)"
    >
      <div class="boot"></div>
      <div class="ball"></div>
    </div>
  </div>
  {#if rightLabel}<div class="edge side">{rightLabel}</div>{/if}
  </div>
  {#if bottomLabel}<div class="edge bottom">{bottomLabel}</div>{/if}
</div>

<style>
  .joy {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
  }
  .well {
    width: 62px;
    height: 62px;
    background:
      radial-gradient(circle at 50% 45%, #201e1c 0%, #141210 70%, #0c0a08 100%);
    border: 1px solid #000;
    border-radius: 3px;
    position: relative;
    cursor: pointer;
    touch-action: none;
    box-shadow:
      inset 0 2px 6px rgba(0, 0, 0, 0.8),
      0 1px 0 rgba(255, 255, 255, 0.05);
    outline: none;
  }
  .well:focus-visible { border-color: var(--orange); }
  .cross-h, .cross-v {
    position: absolute;
    background: rgba(255, 255, 255, 0.1);
    pointer-events: none;
  }
  .cross-h { left: 6px; right: 6px; top: 50%; height: 1px; }
  .cross-v { top: 6px; bottom: 6px; left: 50%; width: 1px; }

  .stick {
    position: absolute;
    width: 0;
    height: 0;
    pointer-events: none;
  }
  .stick.sprung {
    transition: left 120ms cubic-bezier(0.2, 1.4, 0.4, 1), top 120ms cubic-bezier(0.2, 1.4, 0.4, 1);
  }
  /* Rubber boot at the base of the shaft */
  .boot {
    position: absolute;
    left: -11px;
    top: -11px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: radial-gradient(circle at 42% 38%, #2c2a28 0%, #181614 65%, #0e0c0a 100%);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
  }
  /* Ball top */
  .ball {
    position: absolute;
    left: -8px;
    top: -8px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: radial-gradient(circle at 38% 32%, #4a4644 0%, #262422 55%, #141210 100%);
    box-shadow:
      inset 0 1px 1px rgba(255, 255, 255, 0.25),
      0 2px 4px rgba(0, 0, 0, 0.7);
  }
  .well.dragging .ball {
    background: radial-gradient(circle at 38% 32%, #5a5654 0%, #302e2c 55%, #1a1816 100%);
  }
  .mid {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .edge {
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.5rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink);
    line-height: 1;
    white-space: nowrap;
  }
  .edge.side { width: 3.2rem; text-align: center; }
</style>
