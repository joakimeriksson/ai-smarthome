// Single chokepoint for loading the voice processor worklet. Uses
// `new URL(..., import.meta.url)` so the bundler (Vite/Rollup) can statically
// resolve the asset and rewrite the URL for both dev and prod builds. Avoids
// the `?url` import in the app, which behaves inconsistently for TS sources
// across workspace packages.

export async function loadVoiceWorklet(ctx: BaseAudioContext): Promise<void> {
  const url = new URL('./worklets/voice-processor.ts', import.meta.url)
  await ctx.audioWorklet.addModule(url.href)
}
