<script lang="ts">
  // Two-position rocker switch (Synthex STEREO/MONO style): label above,
  // label below, dark rocker in a recessed slot. Clicking toggles.
  interface Props {
    topLabel: string
    bottomLabel: string
    value: boolean          // true = top position
    onchange: (v: boolean) => void
  }
  let { topLabel, bottomLabel, value, onchange }: Props = $props()
</script>

<div class="rocker">
  <div class="lbl">{topLabel}</div>
  <button
    type="button"
    class:top={value}
    aria-pressed={value}
    aria-label="{topLabel} / {bottomLabel}"
    onclick={() => onchange(!value)}
  >
    <span class="paddle"></span>
  </button>
  <div class="lbl">{bottomLabel}</div>
</div>

<style>
  .rocker {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    flex-shrink: 0;
  }
  .lbl {
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.5rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink);
    line-height: 1;
  }
  button {
    width: 18px;
    height: 34px;
    background: #14120f;
    border: 0;
    border-radius: 2px;
    padding: 2px;
    cursor: pointer;
    position: relative;
    box-shadow:
      inset 0 1px 3px rgba(0, 0, 0, 0.7),
      0 1px 0 rgba(255, 255, 255, 0.05);
  }
  .paddle {
    position: absolute;
    left: 2px;
    right: 2px;
    height: 18px;
    border-radius: 1px;
    background: linear-gradient(180deg, #4a4644 0%, #322f2c 55%, #201e1c 100%);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.2),
      0 1px 2px rgba(0, 0, 0, 0.5);
    transition: top 80ms ease, bottom 80ms ease, background 80ms ease;
    top: 12px;
  }
  button.top .paddle {
    top: 2px;
    background: linear-gradient(180deg, #201e1c 0%, #322f2c 45%, #4a4644 100%);
  }
</style>
