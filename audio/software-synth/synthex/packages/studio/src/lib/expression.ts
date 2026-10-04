// Timing of a sequenced note's aftertouch (NoteStep.pressure), shared by
// Track.scheduleStep and scripts/render-song.ts so the offline render leans
// in exactly when the studio does. Fractions of the note's held length.

/** When the player starts to lean in. */
export const PRESSURE_AT = 0.35
/** How long the pressure takes to reach its target. */
export const PRESSURE_RISE = 0.4

/** A scoop (NoteStep.scoop) slides up into the note over this long, in seconds. */
export const SCOOP_TIME = 0.09
/** A guitar-style bend (NoteStep.bendUp) starts here in the note... */
export const BEND_AT = 0.45
/** ...and takes this share of the note to reach its target. */
export const BEND_RISE = 0.2
