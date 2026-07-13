; Data tables appended after player.s code
; All pre-allocated at fixed sizes for JS binary patching
; This file is concatenated AFTER player.s

; --- Orderlists (3 pointers per song, up to NUMSONGS=32 songs) ---
mt_songtbllo:
  .dsb 96, 0
mt_songtblhi:
  .dsb 96, 0

; --- Pattern pointer tables ---
mt_patttbllo:
  .dsb 256, 0
mt_patttblhi:
  .dsb 256, 0

; --- Instrument data (9 parallel arrays, 64 entries each) ---
mt_insad:
  .dsb 64, $00
mt_inssr:
  .dsb 64, $F0
mt_inswaveptr:
  .dsb 64, 0
mt_inspulseptr:
  .dsb 64, 0
mt_insfiltptr:
  .dsb 64, 0
mt_insvibparam:
  .dsb 64, 0
mt_insvibdelay:
  .dsb 64, 0
mt_insgatetimer:
  .dsb 64, 2
mt_insfirstwave:
  .dsb 64, $11

; --- Wavetable (255 entries) ---
mt_wavetbl:
  .dsb 255, 0

; --- Pulse table (255 entries each) ---
mt_pulsetimetbl:
  .dsb 255, 0
mt_pulsespdtbl:
  .dsb 255, 0

; --- Filter table (255 entries each) ---
mt_filttimetbl:
  .dsb 255, 0
mt_filtspdtbl:
  .dsb 255, 0

; --- Speed table (255 entries each) ---
mt_speedlefttbl:
  .dsb 255, 0
mt_speedrighttbl:
  .dsb 255, 0

; --- Frequency table (96 entries) ---
mt_freqtbllo:
  .dsb 96, 0
mt_freqtblhi:
  .dsb 96, 0

; --- Note table (256 entries) ---
mt_notetbl:
  .dsb 256, 0
