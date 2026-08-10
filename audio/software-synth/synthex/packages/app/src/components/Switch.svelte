<script lang="ts">
  // Synthex pushbutton — same style as Selector buttons.
  // Label above, plain white square with red LED dot.

  interface Props {
    value: boolean
    label: string
    onchange: (v: boolean) => void
  }
  let { value, label, onchange }: Props = $props()
</script>

<div class="sw" role="group" aria-label={label}>
  <div class="lbl">{label}</div>
  <button
    type="button"
    class:on={value}
    aria-pressed={value}
    aria-label={label}
    onclick={() => onchange(!value)}
  >
    <span class="led-area"><span class="led" aria-hidden="true"></span></span>
    <span class="body"></span>
  </button>
</div>

<style>
  .sw {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
    flex-shrink: 0;
    width: 20px;
  }
  .lbl {
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 600;
    font-size: 0.48rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink);
    line-height: 1;
    text-align: center;
    white-space: nowrap;
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
  button.on {
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.2);
    transform: translateY(1px);
  }
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
    transition: background 80ms ease, box-shadow 80ms ease;
  }
  button.on .led {
    background: radial-gradient(circle at 35% 30%, #ff6050 0%, #ff2010 50%, #c01008 100%);
    box-shadow: 0 0 3px rgba(255, 40, 20, 0.6), 0 0 6px rgba(255, 40, 20, 0.3);
  }
  .body {
    padding: 5px 0;
    background: linear-gradient(180deg, #ede8e0 0%, #ddd8d0 100%);
  }
</style>
