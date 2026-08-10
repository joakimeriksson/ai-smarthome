<script lang="ts" generics="T extends string">
  // Vertical slide switch with N positions (Synthex UPPER/BOTH/LOWER style).
  // Labels on the right, dark slider knob in a recessed slot.
  interface Props {
    value: T
    options: { value: T; label: string }[]
    onchange: (v: T) => void
  }
  let { value, options, onchange }: Props = $props()

  const idx = $derived(Math.max(0, options.findIndex(o => o.value === value)))

  function step(delta: number) {
    const next = Math.max(0, Math.min(options.length - 1, idx + delta))
    const opt = options[next]
    if (opt && opt.value !== value) onchange(opt.value)
  }
</script>

<div class="sw3">
  <div
    class="slot"
    role="slider"
    aria-label={options.map(o => o.label).join(' / ')}
    aria-valuemin={0}
    aria-valuemax={options.length - 1}
    aria-valuenow={idx}
    tabindex="0"
    onkeydown={(e) => {
      if (e.key === 'ArrowUp') { step(-1); e.preventDefault() }
      if (e.key === 'ArrowDown') { step(1); e.preventDefault() }
    }}
  >
    {#each options as opt, i (opt.value)}
      <button
        class="zone"
        style="top: {(i / options.length) * 100}%; height: {100 / options.length}%"
        aria-label={opt.label}
        onclick={() => onchange(opt.value)}
      ></button>
    {/each}
    <div class="knob" style="top: calc({(idx + 0.5) / options.length} * 100% - 7px)"></div>
  </div>
  <div class="labels">
    {#each options as opt (opt.value)}
      <button class="lab" class:active={opt.value === value} onclick={() => onchange(opt.value)}>
        {opt.label}
      </button>
    {/each}
  </div>
</div>

<style>
  .sw3 {
    display: inline-flex;
    gap: 0.35rem;
    align-items: stretch;
  }
  .slot {
    width: 16px;
    height: 58px;
    background: #14120f;
    border-radius: 2px;
    position: relative;
    cursor: pointer;
    box-shadow:
      inset 0 1px 3px rgba(0, 0, 0, 0.7),
      0 1px 0 rgba(255, 255, 255, 0.05);
    outline: none;
  }
  .slot:focus-visible { box-shadow: 0 0 0 1px var(--orange); }
  .zone {
    position: absolute;
    left: 0;
    right: 0;
    background: transparent;
    border: 0;
    cursor: pointer;
    padding: 0;
  }
  .knob {
    position: absolute;
    left: 2px;
    right: 2px;
    height: 14px;
    border-radius: 1px;
    background: linear-gradient(180deg, #4a4644 0%, #322f2c 55%, #201e1c 100%);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.2),
      0 1px 2px rgba(0, 0, 0, 0.5);
    transition: top 90ms ease;
    pointer-events: none;
  }
  .labels {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 1px 0;
  }
  .lab {
    background: transparent;
    border: 0;
    padding: 0;
    text-align: left;
    cursor: pointer;
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.48rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-soft);
    line-height: 1;
  }
  .lab.active { color: var(--ink); }
</style>
