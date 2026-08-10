<script lang="ts" generics="T extends string | number">
  // Synthex pushbutton row — symbols above, plain white square buttons
  // with red LED dot, all in one dark recessed strip.

  let { value, options, label, onchange, compact = false }: {
    value: T
    options: { value: T; label: string }[]
    label: string
    onchange: (v: T) => void
    compact?: boolean
  } = $props()
</script>

<div class="sel" role="group" aria-label={label}>
  <div class="caps-row" class:compact>
    {#each options as opt (opt.value)}
      <span class="cap">{@html opt.label}</span>
    {/each}
  </div>
  <div class="strip" class:compact>
    {#each options as opt (opt.value)}
      {@const active = opt.value === value}
      <button
        class:active
        onclick={() => onchange(opt.value)}
        type="button"
        aria-pressed={active}
        aria-label={`${label || 'Option'}: ${String(opt.value)}`}
      >
        <span class="led-area"><span class="led" aria-hidden="true"></span></span>
        <span class="body"></span>
      </button>
    {/each}
  </div>
  {#if label}<div class="lbl">{label}</div>{/if}
</div>

<style>
  .sel {
    display: inline-flex;
    flex-direction: column;
    gap: 0.1rem;
    align-items: center;
    flex-shrink: 0;
  }
  .caps-row {
    display: flex;
    gap: 4px;
  }
  .cap {
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.48rem;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--ink);
    text-align: center;
    width: 20px;
    line-height: 1;
    overflow: visible;
    white-space: nowrap;
  }
  .caps-row.compact .cap {
    width: 18px;
    font-size: 0.45rem;
  }
  /* Dark recessed strip holding all buttons */
  .strip {
    display: flex;
    gap: 4px;
    background: #1a1816;
    padding: 4px;
    border-radius: 2px;
    box-shadow:
      inset 0 1px 2px rgba(0, 0, 0, 0.5);
  }
  button {
    width: 20px;
    display: flex;
    flex-direction: column;
    border: 0;
    padding: 0;
    cursor: pointer;
    border-radius: 1px;
    overflow: hidden;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.4),
      0 1px 0 rgba(0, 0, 0, 0.15);
    transition: transform 60ms ease, box-shadow 60ms ease;
  }
  button:hover .body {
    background: linear-gradient(180deg, #f4f0e8 0%, #eae6de 100%);
  }
  button.active {
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.2);
    transform: translateY(1px);
  }
  /* Slightly recessed LED area at top */
  .led-area {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 3px 0;
    background: linear-gradient(180deg, #ccc8c0 0%, #d8d4cc 100%);
    box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.1);
  }
  .led {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: radial-gradient(circle at 40% 35%, #6a2a10, #3a0a04 80%);
    box-shadow: inset 0 0 1px rgba(0, 0, 0, 0.3);
  }
  button.active .led {
    background: radial-gradient(circle at 35% 30%, #ff6050 0%, #ff2010 50%, #c01008 100%);
    box-shadow: 0 0 3px rgba(255, 40, 20, 0.6), 0 0 6px rgba(255, 40, 20, 0.3);
  }
  /* White body area below LED */
  .body {
    padding: 5px 0;
    background: linear-gradient(180deg, #ede8e0 0%, #ddd8d0 100%);
  }

  .strip.compact {
    gap: 3px;
    padding: 3px;
  }
  .strip.compact button {
    width: 18px;
  }
  .strip.compact .led-area {
    padding: 2px 0;
  }
  .strip.compact .body {
    padding: 4px 0;
  }
  .strip.compact .led {
    width: 5px;
    height: 5px;
  }

  .lbl {
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 600;
    font-size: 0.5rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--ink-soft);
    line-height: 1;
  }
</style>
