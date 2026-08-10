<script lang="ts">
  import type { Snippet } from 'svelte'
  interface Props {
    title: string
    accent?: 'orange' | 'ink' | 'red'
    inline?: boolean
    children: Snippet
  }
  let { title, accent = 'orange', inline = false, children }: Props = $props()
</script>

<!-- Synthex panel: thin white border rectangle with title sitting on the
     top border line, matching the real Elka Synthex screen-printed layout. -->
<section class="panel" class:accent-ink={accent === 'ink'} class:accent-red={accent === 'red'}>
  {#if title}
    <div class="title-bar">
      <span class="rule"></span>
      <span class="title">{title}</span>
      <span class="rule"></span>
    </div>
  {/if}
  <div class="body" class:inline class:no-title={!title}>
    {@render children()}
  </div>
</section>

<style>
  .panel {
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 0;
    display: flex;
    flex-direction: column;
    position: relative;
  }

  /* Title sits on the top border — white text with rules extending to edges */
  .title-bar {
    display: flex;
    align-items: center;
    margin-top: -0.45rem;
    margin-left: 0.3rem;
    margin-right: 0.3rem;
  }

  .rule {
    flex: 1;
    height: 0;
  }

  .title {
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.64rem;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink);
    padding: 0 0.5rem;
    background: var(--panel);
    flex: 0 0 auto;
    line-height: 1;
    white-space: nowrap;
  }

  .body {
    padding: 0.55rem 0.5rem 0.5rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem 0.5rem;
    align-items: flex-end;
    /* Fill the panel and distribute wrapped rows — the real Synthex panel
       is dense; content should occupy the box, not pool at the top. */
    flex: 1;
    align-content: space-evenly;
    justify-content: center;
    overflow: hidden;
  }

  .body.no-title {
    padding-top: 0.5rem;
  }

  /* Single horizontal row */
  .body.inline {
    flex-wrap: nowrap;
    justify-content: space-evenly;
    align-items: center;
    gap: 0.3rem;
    padding: 0.45rem 0.4rem 0.4rem;
    overflow: hidden;
  }
</style>
