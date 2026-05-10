<script lang="ts">
  import type { Snippet } from 'svelte'
  interface Props {
    title: string
    accent?: 'orange' | 'ink' | 'red'
    children: Snippet
  }
  let { title, accent = 'orange', children }: Props = $props()
</script>

<section class="panel" class:accent-ink={accent === 'ink'} class:accent-red={accent === 'red'}>
  <header>
    <span class="rule"></span>
    <span class="title">{title}</span>
    <span class="rule"></span>
  </header>
  <div class="body">
    {@render children()}
  </div>
</section>

<style>
  .panel {
    /* Painted-aluminum panel section. The thin orange title band on top
       evokes the screen-printed section bands on the original Synthex. */
    background:
      linear-gradient(180deg, var(--cream-light) 0%, var(--cream) 35%, var(--cream-deep) 100%);
    border: 1px solid rgba(0, 0, 0, 0.18);
    border-radius: 4px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.55),
      inset 0 -1px 0 rgba(0, 0, 0, 0.08),
      0 1px 1px rgba(0, 0, 0, 0.18);
    position: relative;
  }

  /* Screws in the four corners — purely decorative but they sell the
     "this is a real panel" vibe. */
  .panel::before,
  .panel::after {
    content: '';
    position: absolute;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background:
      radial-gradient(circle at 35% 35%, #f5efdc 0%, #b8ac8e 55%, #756c52 100%);
    box-shadow:
      inset -1px -1px 1px rgba(0, 0, 0, 0.4),
      0 1px 1px rgba(0, 0, 0, 0.3);
    pointer-events: none;
  }
  .panel::before { top: 5px;    left: 6px;  }
  .panel::after  { bottom: 5px; right: 6px; }

  header {
    /* Orange section band — the screen-printed strip on the real panel */
    background: var(--orange);
    color: var(--cream-light);
    padding: 0.18rem 0.6rem;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    border-bottom: 1px solid rgba(0, 0, 0, 0.25);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.18),
      inset 0 -1px 0 rgba(0, 0, 0, 0.18);
  }

  .rule {
    flex: 1;
    height: 1px;
    background: rgba(255, 255, 255, 0.4);
  }

  .title {
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 800;
    font-size: 0.7rem;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    text-shadow: 0 1px 0 rgba(0, 0, 0, 0.25);
    flex: 0 0 auto;
  }

  /* Variant accent colors for sub-section bands */
  .accent-ink header { background: #2a241c; color: #f0e8d2; }
  .accent-red header { background: #b03020; }

  .body {
    padding: 1rem 0.7rem 0.85rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.95rem 0.7rem;
    align-items: flex-end;
    justify-content: center;
  }
</style>
