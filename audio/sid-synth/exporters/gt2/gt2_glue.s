; Minimal glue around GoatTracker player.s to expose PSID init/play
; Adjust imported symbol names if your player uses different labels.

.export init, play
.import mt_init, mt_play   ; entrypoints in player.s (GT2)

.segment "CODE"

; Called by PSID with A = song number (we set to 1)
init:
    lda #$01        ; start song 1
    jsr mt_init
    rts

; Called by PSID 50 Hz (PAL) or as configured; preserve registers in driver
play:
    jsr mt_play
    rts
