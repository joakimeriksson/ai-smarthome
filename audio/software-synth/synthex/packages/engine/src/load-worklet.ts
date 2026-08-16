// The Synthex voice worklet must be loaded from a URL the host app provides
// (`new Synth({ workletUrl })`), pointing at the prebuilt
// `synthex-voice-processor.js` that engine/scripts/build-worklet.mjs emits
// into each app's public/ dir.
//
// There is deliberately no fallback that resolves the .ts source. Vite can
// serve that in dev but a production build inlines it as a base64 data URL of
// untranspiled TypeScript, which addModule() rejects — the app then renders
// perfectly and makes no sound, with nothing failing at build time. A loud
// error here is worth far more than a convenience path that only breaks in
// production.

export async function loadVoiceWorklet(_ctx: BaseAudioContext): Promise<never> {
  throw new Error(
    'Synth requires `workletUrl`: pass the URL of the prebuilt ' +
    'synthex-voice-processor.js (see engine/scripts/build-worklet.mjs). ' +
    'Loading the worklet from TypeScript source only works in dev.',
  )
}
