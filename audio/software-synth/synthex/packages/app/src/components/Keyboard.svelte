<script lang="ts">
  // 5-octave on-screen keyboard. Mouse + touch + visual feedback for held
  // notes (whatever the source: clicks, computer keyboard, MIDI).

  interface Props {
    held: Set<number>
    octaves?: number
    startNote?: number
    onnoteon: (note: number, vel: number) => void
    onnoteoff: (note: number) => void
  }
  let { held, octaves = 4, startNote = 36, onnoteon, onnoteoff }: Props = $props()

  const semis = $derived(octaves * 12)
  const notes = $derived.by(() => {
    const arr: { note: number; isBlack: boolean; whiteIdx: number }[] = []
    let whiteIdx = 0
    for (let i = 0; i < semis; i++) {
      const note = startNote + i
      const pc = note % 12
      const isBlack = pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10
      arr.push({ note, isBlack, whiteIdx: isBlack ? -1 : whiteIdx })
      if (!isBlack) whiteIdx++
    }
    return arr
  })
  const whiteCount = $derived(notes.filter(n => !n.isBlack).length)

  let activePointer = -1

  function down(note: number, ev: PointerEvent) {
    activePointer = ev.pointerId
    ;(ev.currentTarget as Element).setPointerCapture(ev.pointerId)
    onnoteon(note, 1)
  }
  function up(note: number, ev: PointerEvent) {
    if (activePointer !== ev.pointerId) return
    onnoteoff(note)
    ;(ev.currentTarget as Element).releasePointerCapture(ev.pointerId)
  }
  function leave(note: number, ev: PointerEvent) {
    // Allow drag-glide between keys: release prev, press new.
    if (held.has(note)) onnoteoff(note)
    void ev
  }
</script>

<div class="kbd" style="--whites:{whiteCount}">
  {#each notes as n (n.note)}
    {#if !n.isBlack}
      <button
        class="white"
        class:held={held.has(n.note)}
        style="grid-column: {n.whiteIdx + 1}"
        onpointerdown={(e) => down(n.note, e)}
        onpointerup={(e) => up(n.note, e)}
        onpointerleave={(e) => leave(n.note, e)}
      >{n.note % 12 === 0 ? 'C' + Math.floor(n.note / 12 - 1) : ''}</button>
    {/if}
  {/each}
  {#each notes as n (n.note + 1000)}
    {#if n.isBlack}
      <!-- Position black keys in a separate overlay -->
      {@const col = notes.find(x => x.note === n.note - 1)?.whiteIdx ?? 0}
      <button
        class="black"
        class:held={held.has(n.note)}
        aria-label="MIDI note {n.note}"
        style="left: calc(({col} + 1) / {whiteCount} * 100% - 0.7rem)"
        onpointerdown={(e) => down(n.note, e)}
        onpointerup={(e) => up(n.note, e)}
        onpointerleave={(e) => leave(n.note, e)}
      ></button>
    {/if}
  {/each}
</div>

<style>
  .kbd {
    position: relative;
    display: grid;
    grid-template-columns: repeat(var(--whites), 1fr);
    gap: 0;
    height: 130px;
    background:
      linear-gradient(180deg, #2a221a 0%, #15110d 100%);
    border: 1px solid #000;
    border-radius: 3px;
    padding: 3px;
    padding-top: 6px;   /* extra room for the black-key shadow */
    user-select: none;
    touch-action: none;
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.7);
  }
  .white {
    background: linear-gradient(180deg, #fefaeb 0%, #f0e7ce 75%, #e0d6b8 100%);
    border: 1px solid rgba(0, 0, 0, 0.4);
    border-top: 1px solid rgba(0, 0, 0, 0.55);
    border-radius: 0 0 3px 3px;
    cursor: pointer;
    position: relative;
    padding: 0 0 8px;
    color: #88806a;
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.62rem;
    letter-spacing: 0.06em;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.7),
      inset -1px 0 0 rgba(0, 0, 0, 0.1),
      inset 0 -3px 4px rgba(0, 0, 0, 0.07);
    transition: background 50ms ease, transform 30ms ease;
  }
  .white:hover { background: linear-gradient(180deg, #fffbe9 0%, #f5ecd3 75%, #e6dcbc 100%); }
  .white.held {
    background: linear-gradient(180deg, var(--orange-bright) 0%, var(--orange) 100%);
    color: var(--cream-light);
    text-shadow: 0 -1px 0 rgba(0, 0, 0, 0.3);
    transform: translateY(1px);
    box-shadow:
      inset 0 1px 2px rgba(0, 0, 0, 0.3),
      inset 0 -2px 3px rgba(0, 0, 0, 0.15);
  }
  .black {
    position: absolute;
    top: 6px;
    width: 1.4rem;
    height: 64%;
    background:
      linear-gradient(180deg, #2a241c 0%, #14110d 60%, #0a0805 100%);
    border: 1px solid #000;
    border-radius: 0 0 3px 3px;
    cursor: pointer;
    z-index: 1;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.18),
      inset 0 -3px 5px rgba(0, 0, 0, 0.6),
      0 2px 4px rgba(0, 0, 0, 0.4);
    transition: background 50ms ease, transform 30ms ease;
  }
  .black:hover { background: linear-gradient(180deg, #3a322a 0%, #1a160f 60%, #0c0905 100%); }
  .black.held {
    background:
      linear-gradient(180deg, var(--orange) 0%, var(--orange-dark) 100%);
    transform: translateY(1px);
    box-shadow:
      inset 0 1px 2px rgba(0, 0, 0, 0.4),
      0 1px 2px rgba(0, 0, 0, 0.3);
  }
</style>
