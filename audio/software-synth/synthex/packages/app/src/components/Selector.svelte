<script lang="ts" generics="T extends string | number">
  // Vintage push-button row. The active position depresses into the panel
  // and lights its LED indicator.

  let { value, options, label, onchange }: {
    value: T
    options: { value: T; label: string }[]
    label: string
    onchange: (v: T) => void
  } = $props()
</script>

<div class="sel" role="group" aria-label={label}>
  <div class="opts">
    {#each options as opt (opt.value)}
      {@const active = opt.value === value}
      <button
        class:active
        onclick={() => onchange(opt.value)}
        type="button"
        aria-pressed={active}
      >
        <span class="led" aria-hidden="true"></span>
        <span class="cap">{opt.label}</span>
      </button>
    {/each}
  </div>
  <div class="lbl">{label}</div>
</div>

<style>
  .sel {
    display: inline-flex;
    flex-direction: column;
    gap: 0.3rem;
    align-items: center;
  }
  .opts {
    display: flex;
    gap: 2px;
    background: linear-gradient(180deg, #5e5645, #2a241c);
    padding: 3px;
    border-radius: 3px;
    box-shadow:
      inset 0 1px 2px rgba(0, 0, 0, 0.55),
      0 1px 0 rgba(255, 255, 255, 0.5);
  }
  button {
    background: linear-gradient(180deg, #f5efdc 0%, #d8ceb2 60%, #b3a786 100%);
    border: 0;
    color: var(--ink);
    padding: 0.32rem 0.55rem 0.28rem;
    font: inherit;
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 600;
    font-size: 0.7rem;
    letter-spacing: 0.06em;
    cursor: pointer;
    border-radius: 2px;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.55),
      inset 0 -1px 0 rgba(0, 0, 0, 0.25);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    line-height: 1;
    transition: background 80ms ease, transform 60ms ease, box-shadow 80ms ease;
  }
  button:hover {
    background: linear-gradient(180deg, #fffaeb 0%, #e3dabc 60%, #b8ac8a 100%);
  }
  /* Active position depressed into the bezel + lit LED */
  button.active {
    background: linear-gradient(180deg, #c95820 0%, #ee6e2a 60%, #c7501a 100%);
    color: #fff5e0;
    text-shadow: 0 -1px 0 rgba(0, 0, 0, 0.35);
    box-shadow:
      inset 0 1px 2px rgba(0, 0, 0, 0.4),
      0 0 0 1px rgba(0, 0, 0, 0.2);
    transform: translateY(1px);
  }
  .led {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #5a1a08, #2a0604 80%);
    box-shadow: inset 0 0 1px rgba(0, 0, 0, 0.6);
  }
  button.active .led {
    background: radial-gradient(circle at 35% 30%, #ffe6b0 0%, var(--led) 40%, #a01408 100%);
    box-shadow: 0 0 4px var(--led-glow);
  }
  .cap { line-height: 1; text-transform: uppercase; }

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
