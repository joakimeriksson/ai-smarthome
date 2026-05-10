<script lang="ts">
  // Synthex-style 2-position toggle: tall rocker on a recessed plate. The
  // "lit" state shows the orange LED dot above the OFF marker.

  interface Props {
    value: boolean
    label: string
    onchange: (v: boolean) => void
  }
  let { value, label, onchange }: Props = $props()
</script>

<div class="sw" role="group" aria-label={label}>
  <div class="rocker" class:on={value}>
    <button
      type="button"
      class="rocker-btn"
      aria-pressed={value}
      aria-label={label}
      onclick={() => onchange(!value)}
    >
      <span class="led" aria-hidden="true"></span>
      <span class="paddle" aria-hidden="true"></span>
    </button>
  </div>
  <div class="lbl">{label}</div>
</div>

<style>
  .sw {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 0.32rem;
    width: 32px;
  }
  .rocker {
    width: 28px;
    height: 36px;
    position: relative;
    /* Recessed plate the rocker sits in */
    background:
      linear-gradient(180deg, #5e5645 0%, #2a241c 100%);
    border-radius: 3px;
    box-shadow:
      inset 0 1px 2px rgba(0, 0, 0, 0.6),
      0 1px 0 rgba(255, 255, 255, 0.55);
    padding: 3px;
  }
  .rocker-btn {
    width: 100%;
    height: 100%;
    background: transparent;
    border: 0;
    padding: 0;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
  }
  .led {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #6a1a08, #3a0a04 80%);
    box-shadow: inset 0 0 1px rgba(0, 0, 0, 0.7);
    transition: background 80ms ease, box-shadow 80ms ease;
  }
  .rocker.on .led {
    background: radial-gradient(circle at 35% 30%, #ffe8b0 0%, var(--led) 35%, #b01608 100%);
    box-shadow: 0 0 5px var(--led-glow), 0 0 10px var(--led-glow);
  }
  .paddle {
    /* The rocker paddle itself — cream cap, tilts visually */
    width: 100%;
    height: 18px;
    background: linear-gradient(180deg, #f5efdc 0%, #d6cdb1 50%, #b1a587 100%);
    border-radius: 2px;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.6),
      inset 0 -1px 0 rgba(0, 0, 0, 0.25),
      0 1px 1px rgba(0, 0, 0, 0.4);
    transition: transform 80ms ease;
  }
  .rocker.on .paddle {
    /* Slightly raised — top edge highlight */
    transform: translateY(-1px);
  }
  .lbl {
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 600;
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--ink);
    line-height: 1;
  }
</style>
