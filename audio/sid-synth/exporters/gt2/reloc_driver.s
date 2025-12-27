; Relocation header for GoatTracker V2 playroutine (xa syntax)
; This file is concatenated before player.s and assembled with xa.

; Core addresses
base      = $1000        ; load address for PRG
SIDBASE   = $D400        ; SID register base
zpbase    = $FB          ; 2-byte ZP scratch base used by player when ZPGHOSTREGS=0

; Feature configuration (0 enables the code blocks in original source)
ZPGHOSTREGS   = 0        ; use real SID regs, not ghost ZP
SOUNDSUPPORT  = 0
VOLSUPPORT    = 0
NOAUTHORINFO  = 1
NOFILTER      = 0        ; enable filters in driver
NOFILTERMOD   = 0
NOWAVECMD     = 0
NOWAVEDELAY   = 0
NOPULSE       = 0
NOPULSEMOD    = 0
NUMCHANNELS   = 3
NUMSONGS      = 1
DEFAULTTEMPO  = 6        ; ticks per row baseline
FIRSTNOTE     = $80      ; internal encoding base used by GT2

; --- Song data labels the player expects (to be patched by JS) ---
; Orderlists (per channel). For single-song driver, 3 entries (one per voice)
mt_songtbllo:
  .BYTE 0,0,0
mt_songtblhi:
  .BYTE 0,0,0

; Pattern pointer tables (lo/hi for up to 256 patterns)
mt_patttbllo:
  .DSB 256, 0
mt_patttblhi:
  .DSB 256, 0

; Wavetable / Pulsetable / Filtertable (basic defaults, may be replaced)
; Minimal wave: triangle+gate ($11), then loop
mt_wavetbl:
  .BYTE $11, $FF

; Pulse: set $0800 once, then loop
mt_pulsetimetbl:
  .BYTE $80, $FF
mt_pulsespdtbl:
  .BYTE <($0800), >($0800)

; Filter: set cutoff 0, then loop; control defaults patched in playroutine
mt_filttimetbl:
  .BYTE $00, $FF
mt_filtspdtbl:
  .BYTE $00

; Speed and frequency tables (to be filled/overwritten by JS)
mt_speedlefttbl:
  .DSB 32, 6
mt_speedrighttbl:
  .DSB 32, 0

; 96-entry frequency table (PAL) — JS will patch true values
mt_freqtbllo:
  .DSB 96, 0
mt_freqtblhi:
  .DSB 96, 0

; Notetbl used by wavetable jumps (kept zero for now)
mt_notetbl:
  .DSB 256, 0

