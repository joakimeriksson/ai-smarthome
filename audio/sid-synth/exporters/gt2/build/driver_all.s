; Configuration header for GoatTracker V2 playroutine (xa syntax)
; This file is concatenated BEFORE player.s and assembled with xa.
; Contains ONLY defines - no data allocation (data goes after player code).

; Core addresses
base      = $1000        ; load address for PRG
SIDBASE   = $D400        ; SID register base
zpbase    = $FB          ; 2-byte ZP scratch base

; ---------- Feature configuration ----------
; 0 = feature ENABLED, nonzero = DISABLED
ZPGHOSTREGS        = 0
SOUNDSUPPORT       = 0
VOLSUPPORT         = 0
NOAUTHORINFO       = 1
BUFFEREDWRITES     = 0
SIMPLEPULSE        = 0

NOEFFECTS          = 0
NOINSTRVIB         = 0
NOVIB              = 0
NOTONEPORTA        = 0
NOPORTAMENTO       = 0
NOSETAD            = 0
NOSETSR            = 0
NOSETWAVE          = 0
NOSETWAVEPTR       = 0
NOSETPULSEPTR      = 0
NOSETFILTPTR       = 0
NOSETFILTCTRL      = 0
NOSETFILTCUTOFF    = 0
NOSETMASTERVOL     = 0
NOFUNKTEMPO        = 0
NOCHANNELTEMPO     = 0
NOGLOBALTEMPO      = 0
NOFILTER           = 0
NOFILTERMOD        = 0
NOWAVECMD          = 0
NOWAVEDELAY        = 0
NOPULSE            = 0
NOPULSEMOD         = 0
NOTRANS            = 0
NOREPEAT           = 0
NOGATE             = 0
NOFIRSTWAVECMD     = 0

NOCALCULATEDSPEED  = 0
NONORMALSPEED      = 0
NOZEROSPEED        = 0

REALTIMEOPTIMIZATION = 0
PULSEOPTIMIZATION    = 0

; ---------- Song parameters ----------
NUMCHANNELS   = 3
NUMSONGS      = 1
DEFAULTTEMPO  = 6
FIRSTNOTE     = $00

; ---------- Instrument parameters ----------
FIXEDPARAMS   = 0

NUMHRINSTR        = 64
NUMNOHRINSTR      = 0
NUMLEGATOINSTR    = 0
FIRSTNOHRINSTR    = 65
FIRSTLEGATOINSTR  = 65
SRPARAM           = $00
ADPARAM           = $00
;-------------------------------------------------------------------------------
; GoatTracker V2.68 playroutine
;
; NOTE - This playroutine source code does not fall under the GPL license!
; Use it, or song binaries created from it freely for any purpose, commercial
; or noncommercial.
;
; NOTE 2 - This code is in the format of Magnus Lind's assembler from Exomizer.
; Does not directly compile on DASM etc.
;-------------------------------------------------------------------------------

        ;Defines will be inserted by the relocator here

#if (ZPGHOSTREGS == 0)
mt_temp1        = zpbase+0
mt_temp2        = zpbase+1
#else
ghostfreqlo     = zpbase+0
ghostfreqhi     = zpbase+1
ghostpulselo    = zpbase+2
ghostpulsehi    = zpbase+3
ghostwave       = zpbase+4
ghostad         = zpbase+5
ghostsr         = zpbase+6
ghostfiltcutlow = zpbase+21
ghostfiltcutoff = zpbase+22
ghostfiltctrl   = zpbase+23
ghostfilttype   = zpbase+24
mt_temp1        = zpbase+25
mt_temp2        = zpbase+26
#endif

        ;Defines for the music data
        ;Patterndata notes

ENDPATT         = $00
INS             = $00
FX              = $40
FXONLY          = $50
NOTE            = $60
REST            = $bd
KEYOFF          = $be
KEYON           = $bf
FIRSTPACKEDREST = $c0
PACKEDREST      = $00

        ;Effects

DONOTHING       = $00
PORTAUP         = $01
PORTADOWN       = $02
TONEPORTA       = $03
VIBRATO         = $04
SETAD           = $05
SETSR           = $06
SETWAVE         = $07
SETWAVEPTR      = $08
SETPULSEPTR     = $09
SETFILTPTR      = $0a
SETFILTCTRL     = $0b
SETFILTCUTOFF   = $0c
SETMASTERVOL    = $0d
SETFUNKTEMPO    = $0e
SETTEMPO        = $0f

        ;Orderlist commands

REPEAT          = $d0
TRANSDOWN       = $e0
TRANS           = $f0
TRANSUP         = $f0
LOOPSONG        = $ff

        ;Wave,pulse,filttable comands

LOOPWAVE        = $ff
LOOPPULSE       = $ff
LOOPFILT        = $ff
SETPULSE        = $80
SETFILTER       = $80
SETCUTOFF       = $00

                .ORG (base)

        ;Jump table

                jmp mt_init
                jmp mt_play
#if (SOUNDSUPPORT != 0)
                jmp mt_playsfx
#endif
#if (VOLSUPPORT != 0)
                jmp mt_setmastervol
#endif

        ;Author info

#if (NOAUTHORINFO == 0)

authorinfopos   = base + $20
checkpos1:
#if ((authorinfopos - checkpos1) > 15)
mt_tick0jumptbl:
                .byte (mt_tick0_0 & 255)
                .byte (mt_tick0_12 & 255)
                .byte (mt_tick0_12 & 255)
                .byte (mt_tick0_34 & 255)
                .byte (mt_tick0_34 & 255)
                .byte (mt_tick0_5 & 255)
                .byte (mt_tick0_6 & 255)
                .byte (mt_tick0_7 & 255)
                .byte (mt_tick0_8 & 255)
                .byte (mt_tick0_9 & 255)
                .byte (mt_tick0_a & 255)
                .byte (mt_tick0_b & 255)
                .byte (mt_tick0_c & 255)
                .byte (mt_tick0_d & 255)
                .byte (mt_tick0_e & 255)
                .byte (mt_tick0_f & 255)
#endif

checkpos2:
#if ((authorinfopos - checkpos2) > 4)
mt_effectjumptbl:
                .byte (mt_effect_0 & 255)
                .byte (mt_effect_12 & 255)
                .byte (mt_effect_12 & 255)
                .byte (mt_effect_3 & 255)
                .byte (mt_effect_4 & 255)
#endif

checkpos3:
#if ((authorinfopos - checkpos3) > 1)
mt_funktempotbl:
                .byte 8,5
#endif

        ;This is pretty stupid way of filling left-out space, but .ORG
        ;seemed to bug

checkpos4:
#if ((authorinfopos - checkpos4) > 0)
.byte 0
#endif
checkpos5:
#if ((authorinfopos - checkpos5) > 0)
.byte 0
#endif
checkpos6:
#if ((authorinfopos - checkpos6) > 0)
.byte 0
#endif

mt_author:

                .byte 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
                .byte 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
#endif

        ;0 Instrument vibrato

mt_tick0_0:
#if (NOEFFECTS == 0)
#if (NOINSTRVIB == 0)
                lda mt_insvibparam-1,y
                jmp mt_tick0_34
#else
#if (NOVIB == 0)
                jmp mt_tick0_34
#endif
#endif
#endif

        ;1,2 Portamentos


mt_tick0_12:
#if (NOVIB == 0)
                tay
                lda #$00
                sta mt_chnvibtime,x
                tya
#endif

        ;3,4 Toneportamento, Vibrato

mt_tick0_34:
#if (NOEFFECTS == 0)
#if ((NOTONEPORTA == 0) || (NOPORTAMENTO == 0) || (NOVIB == 0))
                sta mt_chnparam,x
                lda mt_chnnewfx,x
                sta mt_chnfx,x
#endif
                rts
#endif

        ;5 Set AD

mt_tick0_5:
#if (NOSETAD == 0)
#if (BUFFEREDWRITES == 0)
                sta SIDBASE+$05,x
#else
#if (ZPGHOSTREGS == 0)
                sta mt_chnad,x
#else
                sta <ghostad,x
#endif
#endif
                rts
#endif

        ;6 Set Sustain/Release

mt_tick0_6:
#if (NOSETSR == 0)
#if (BUFFEREDWRITES == 0)
                sta SIDBASE+$06,x
#else
#if (ZPGHOSTREGS == 0)
                sta mt_chnsr,x
#else
                sta <ghostsr,x
#endif
#endif
                rts
#endif

        ;7 Set waveform

mt_tick0_7:
#if (NOSETWAVE == 0)
                sta mt_chnwave,x
                rts
#endif

        ;8 Set wavepointer

mt_tick0_8:
#if (NOSETWAVEPTR == 0)
                sta mt_chnwaveptr,x
#if (NOWAVEDELAY == 0)
                lda #$00                        ;Make sure possible delayed
                sta mt_chnwavetime,x            ;waveform execution goes
#endif
                rts
#endif

        ;9 Set pulsepointer

mt_tick0_9:
#if (NOSETPULSEPTR == 0)
                sta mt_chnpulseptr,x
                lda #$00                        ;Reset pulse step duration
                sta mt_chnpulsetime,x
                rts
#endif

        ;a Set filtpointer

mt_tick0_a:
#if (NOSETFILTPTR == 0)
#if (NOFILTERMOD == 0)
                ldy #$00
                sty mt_filttime+1
#endif
mt_tick0_a_step:
                sta mt_filtstep+1
                rts
#endif

        ;b Set filtcontrol (channels & resonance)

mt_tick0_b:
#if (NOSETFILTCTRL == 0)
                sta mt_filtctrl+1
#if (NOSETFILTPTR == 0)
                beq mt_tick0_a_step          ;If 0, stop also step-programming
#else
                bne mt_tick0_b_noset
                sta mt_filtstep+1
mt_tick0_b_noset:
#endif
                rts
#endif

        ;c Set cutoff

mt_tick0_c:
#if (NOSETFILTCUTOFF == 0)
                sta mt_filtcutoff+1
                rts
#endif

        ;d Set mastervolume / timing mark

mt_tick0_d:
#if (NOSETMASTERVOL == 0)
#if (NOAUTHORINFO == 0)
                cmp #$10
                bcs mt_tick0_d_timing
#endif
mt_setmastervol:
                sta mt_masterfader+1
                rts
#if (NOAUTHORINFO == 0)
mt_tick0_d_timing:
                sta mt_author+31
                rts
#endif
#endif

        ;e Funktempo

mt_tick0_e:
#if (NOFUNKTEMPO == 0)
                tay
                lda mt_speedlefttbl-1,y
                sta mt_funktempotbl
                lda mt_speedrighttbl-1,y
                sta mt_funktempotbl+1
                lda #$00
#if (NOCHANNELTEMPO == 0)
                beq mt_tick0_f_setglobaltempo
#endif
#endif

        ;f Set Tempo

mt_tick0_f:
#if ((NOCHANNELTEMPO == 0) && (NOGLOBALTEMPO == 0))
                bmi mt_tick0_f_setchantempo     ;Channel or global tempo?
#endif
mt_tick0_f_setglobaltempo:
#if (NOGLOBALTEMPO == 0)
                sta mt_chntempo
#if (NUMCHANNELS > 1)
                sta mt_chntempo+7
#endif
#if (NUMCHANNELS > 2)
                sta mt_chntempo+14
#endif
                rts
#endif
mt_tick0_f_setchantempo:
#if (NOCHANNELTEMPO == 0)
                and #$7f
                sta mt_chntempo,x
                rts
#endif

        ;Continuous effect code

        ;0 Instrument vibrato

#if (NOINSTRVIB == 0)
mt_effect_0_delay:
                dec mt_chnvibdelay,x
mt_effect_0_donothing:
                jmp mt_done
mt_effect_0:    beq mt_effect_0_donothing         ;Speed 0 = no vibrato at all
                lda mt_chnvibdelay,x
                bne mt_effect_0_delay
#else
mt_effect_0:
mt_effect_0_donothing:
                jmp mt_done
#endif

        ;4 Vibrato

mt_effect_4:
#if (NOVIB == 0)
#if (NOCALCULATEDSPEED == 0)
                lda mt_speedlefttbl-1,y
#if (NONORMALSPEED == 0)
                bmi mt_effect_4_nohibyteclear
                ldy #$00                        ;Clear speed highbyte
                sty <mt_temp2
#endif
mt_effect_4_nohibyteclear:
                and #$7f
                sta mt_effect_4_speedcmp+1
#else
                lda #$00                        ;Clear speed highbyte
                sta <mt_temp2
#endif
                lda mt_chnvibtime,x
                bmi mt_effect_4_nodir
#if (NOCALCULATEDSPEED != 0)
                cmp mt_speedlefttbl-1,y
#else
mt_effect_4_speedcmp:
                cmp #$00
#endif
                bcc mt_effect_4_nodir2
                beq mt_effect_4_nodir
                eor #$ff
mt_effect_4_nodir:
                clc
mt_effect_4_nodir2:
                adc #$02
mt_vibdone:
                sta mt_chnvibtime,x
                lsr
                bcc mt_freqadd
                bcs mt_freqsub
#endif

        ;1,2,3 Portamentos

mt_effect_3:
#if (NOTONEPORTA == 0)
                tya
                beq mt_effect_3_found           ;Speed $00 = tie note
#endif
mt_effect_12:
#if ((NOTONEPORTA == 0) || (NOPORTAMENTO == 0))
#if (NOCALCULATEDSPEED != 0)
                lda mt_speedlefttbl-1,y
                sta <mt_temp2
#endif
#endif
#if (NOPORTAMENTO == 0)

#if (NOWAVECMD != 0)
                lda mt_chnfx,x
#else
mt_effectnum:
                lda #$00
#endif
                cmp #$02
                bcc mt_freqadd
                beq mt_freqsub
#else
#if (NOTONEPORTA == 0)
                sec
#endif
#endif
#if (NOTONEPORTA == 0)
                ldy mt_chnnote,x
#if (ZPGHOSTREGS == 0)
                lda mt_chnfreqlo,x              ;Calculate offset to the
                sbc mt_freqtbllo-FIRSTNOTE,y    ;right frequency
                pha
                lda mt_chnfreqhi,x
#else
                lda <ghostfreqlo,x              ;Calculate offset to the
                sbc mt_freqtbllo-FIRSTNOTE,y    ;right frequency
                pha
                lda <ghostfreqhi,x
#endif
                sbc mt_freqtblhi-FIRSTNOTE,y
                tay
                pla
                bcs mt_effect_3_down            ;If positive, have to go down

mt_effect_3_up:
                adc <mt_temp1                   ;Add speed to offset
                tya                             ;If changes sign, we're done
                adc <mt_temp2
                bpl mt_effect_3_found
#endif


#if ((NOTONEPORTA == 0) || (NOPORTAMENTO == 0) || (NOVIB == 0))
mt_freqadd:
#if (ZPGHOSTREGS == 0)
                lda mt_chnfreqlo,x
                adc <mt_temp1
                sta mt_chnfreqlo,x
                lda mt_chnfreqhi,x
#else
                lda <ghostfreqlo,x
                adc <mt_temp1
                sta <ghostfreqlo,x
                lda <ghostfreqhi,x
#endif
                adc <mt_temp2
                jmp mt_storefreqhi
#endif

#if (NOTONEPORTA == 0)
mt_effect_3_down:
                sbc <mt_temp1                   ;Subtract speed from offset
                tya                             ;If changes sign, we're done
                sbc <mt_temp2
                bmi mt_effect_3_found
#endif

#if ((NOTONEPORTA == 0) || (NOPORTAMENTO == 0) || (NOVIB == 0))
mt_freqsub:
#if (ZPGHOSTREGS == 0)
                lda mt_chnfreqlo,x
                sbc <mt_temp1
                sta mt_chnfreqlo,x
                lda mt_chnfreqhi,x
#else
                lda <ghostfreqlo,x
                sbc <mt_temp1
                sta <ghostfreqlo,x
                lda <ghostfreqhi,x
#endif
                sbc <mt_temp2
                jmp mt_storefreqhi
#endif

mt_effect_3_found:
#if (NOTONEPORTA == 0)
#if (NOCALCULATEDSPEED == 0)
                lda mt_chnnote,x
                jmp mt_wavenoteabs
#else
                ldy mt_chnnote,x
                jmp mt_wavenote
#endif
#endif

        ;Init routine

mt_init:
#if (NUMSONGS > 1)
                sta mt_init+5
                asl
                adc #$00
#endif
                sta mt_initsongnum+1
                rts

        ;Play soundeffect -routine

#if (SOUNDSUPPORT != 0)
        ;Sound FX init routine

mt_playsfx:     sta mt_playsfxlo+1
                sty mt_playsfxhi+1
                lda mt_chnsfx,x                   ;Need a priority check?
                beq mt_playsfxok
                tya                               ;Check address highbyte
                cmp mt_chnsfxhi,x
                bcc mt_playsfxskip                ;Lower than current -> skip
                bne mt_playsfxok                  ;Higher than current -> OK
                lda mt_playsfxlo+1                ;Check address lowbyte
                cmp mt_chnsfxlo,x
                bcc mt_playsfxskip                ;Lower than current -> skip
mt_playsfxok:   lda #$01
                sta mt_chnsfx,x
mt_playsfxlo:   lda #$00
                sta mt_chnsfxlo,x
mt_playsfxhi:   lda #$00
                sta mt_chnsfxhi,x
mt_playsfxskip: rts
#endif

        ;Set mastervolume -routine

#if ((VOLSUPPORT != 0) && (NOSETMASTERVOL != 0))
mt_setmastervol:
                sta mt_masterfader+1
                rts
#endif

        ;Playroutine

mt_play:        ldx #$00                        ;Channel index

        ;Song initialization

mt_initsongnum:
                ldy #$00
                bmi mt_filtstep
                txa
                ldx #NUMCHANNELS * 14 - 1
mt_resetloop:
                sta mt_chnsongptr,x             ;Reset sequencer + voice
                dex                             ;variables on all channels
                bpl mt_resetloop
#if (ZPGHOSTREGS == 0)
#if (NUMCHANNELS == 2)
                sta SIDBASE+$12
#endif
#if (NUMCHANNELS == 1)
                sta SIDBASE+$0b
                sta SIDBASE+$12
#endif
                sta SIDBASE+$15                       ;Reset filter cutoff lowbyte
#else
                sta <ghostfiltcutlow
#endif
                sta mt_filtctrl+1             ;Switch filter off & reset
#if (NOFILTER == 0)
                sta mt_filtstep+1             ;step-programming
#endif
                stx mt_initsongnum+1          ;Reset initflag
                tax
#if (NUMCHANNELS == 3)
                jsr mt_initchn
                ldx #$07
                jsr mt_initchn
                ldx #$0e
#endif
#if (NUMCHANNELS == 2)
                jsr mt_initchn
                ldx #$07
#endif
mt_initchn:
#if (NUMSONGS > 1)
                tya
                iny
                sta mt_chnsongnum,x             ;Store index to songtable
#endif
mt_defaulttempo:
                lda #DEFAULTTEMPO               ;Set default tempo
                sta mt_chntempo,x
                lda #$01
                sta mt_chncounter,x             ;Reset counter
                sta mt_chninstr,x               ;Reset instrument
                jmp mt_loadregswaveonly          ;Load waveform

        ;Filter execution

mt_filtstep:
#if (NOFILTER == 0)
                ldy #$00                        ;See if filter stopped
                beq mt_filtdone
#if (NOFILTERMOD == 0)
mt_filttime:
                lda #$00                        ;See if time left for mod.
                bne mt_filtmod                  ;step
#endif
mt_newfiltstep:
                lda mt_filttimetbl-1,y          ;$80-> = set filt parameters
                beq mt_setcutoff                ;$00 = set cutoff
#if (NOFILTERMOD == 0)
                bpl mt_newfiltmod
#endif
mt_setfilt:
                asl                             ;Set passband
                sta mt_filttype+1
                lda mt_filtspdtbl-1,y           ;Set resonance/channel
                sta mt_filtctrl+1
                lda mt_filttimetbl,y            ;Check for cutoff setting
                bne mt_nextfiltstep2            ;following immediately
mt_setcutoff2:
                iny
mt_setcutoff:
                lda mt_filtspdtbl-1,y           ;Take cutoff value
                sta mt_filtcutoff+1
#if (NOFILTERMOD == 0)
                jmp mt_nextfiltstep
mt_newfiltmod:
                sta mt_filttime+1               ;$01-$7f = new modulation step
mt_filtmod:   
                lda mt_filtspdtbl-1,y           ;Take filt speed
                clc
                adc mt_filtcutoff+1
                sta mt_filtcutoff+1
                dec mt_filttime+1
                bne mt_storecutoff
#endif
mt_nextfiltstep:
                lda mt_filttimetbl,y           ;Jump in filttable?
mt_nextfiltstep2:
                cmp #LOOPFILT
                iny
                tya
                bcc mt_nofiltjump
                lda mt_filtspdtbl-1,y          ;Take jump point
mt_nofiltjump:
                sta mt_filtstep+1
mt_filtdone:
mt_filtcutoff:
                lda #$00
mt_storecutoff:
#if (ZPGHOSTREGS == 0)
                sta SIDBASE+$16
#else
                sta <ghostfiltcutoff
#endif
#endif
mt_filtctrl:
                lda #$00
#if (ZPGHOSTREGS == 0)
                sta SIDBASE+$17
#else
                sta <ghostfiltctrl
#endif
mt_filttype:
                lda #$00
mt_masterfader:
                ora #$0f                        ;Master volume fader
#if (ZPGHOSTREGS == 0)
                sta SIDBASE+$18
#else
                sta <ghostfilttype
#endif

#if (NUMCHANNELS == 3)
                jsr mt_execchn
                ldx #$07
                jsr mt_execchn
                ldx #$0e
#endif
#if (NUMCHANNELS == 2)
                jsr mt_execchn
                ldx #$07
#endif

        ;Channel execution

mt_execchn:
                dec mt_chncounter,x               ;See if tick 0
                beq mt_tick0

        ;Ticks 1-n

mt_notick0:
                bpl mt_effects
                lda mt_chntempo,x               ;Reload tempo if negative

#if (NOFUNKTEMPO == 0)
                cmp #$02
                bcs mt_nofunktempo              ;Funktempo - bounce between
                tay                             ;funktable indexes 0,1
                eor #$01
                sta mt_chntempo,x
                lda mt_funktempotbl,y
                sbc #$00
#endif

mt_nofunktempo:
                sta mt_chncounter,x
mt_effects:
                jmp mt_waveexec

        ;Sequencer repeat

mt_repeat:
#if (NOREPEAT == 0)
                sbc #REPEAT
                inc mt_chnrepeat,x
                cmp mt_chnrepeat,x
                bne mt_nonewpatt
mt_repeatdone:
                lda #$00
                sta mt_chnrepeat,x
                beq mt_repeatdone2
#endif

        ;Tick 0

mt_tick0:
#if (NOEFFECTS == 0)
                ldy mt_chnnewfx,x  ;Setup tick 0 FX jumps
                lda mt_tick0jumptbl,y
                sta mt_tick0jump1+1
                sta mt_tick0jump2+1
#endif

        ;Sequencer advance

mt_checknewpatt:
                lda mt_chnpattptr,x             ;Fetch next pattern?
                bne mt_nonewpatt
mt_sequencer:
                ldy mt_chnsongnum,x
                lda mt_songtbllo,y              ;Get address of sequence
                sta <mt_temp1
                lda mt_songtblhi,y
                sta <mt_temp2
                ldy mt_chnsongptr,x
                lda (mt_temp1),y                ;Get pattern from sequence
                cmp #LOOPSONG                   ;Check for loop
                bcc mt_noloop
                iny
                lda (mt_temp1),y
                tay
                lda (mt_temp1),y
mt_noloop:
#if (NOTRANS == 0)
                cmp #TRANSDOWN                  ;Check for transpose
                bcc mt_notrans
                sbc #TRANS
                sta mt_chntrans,x
                iny
                lda (mt_temp1),y
#endif
mt_notrans:
#if (NOREPEAT == 0)
                cmp #REPEAT                     ;Check for repeat
                bcs mt_repeat
#endif
                sta mt_chnpattnum,x             ;Store pattern number
mt_repeatdone2:
                iny
                tya
                sta mt_chnsongptr,x             ;Store songposition

        ;New note start

mt_nonewpatt:
                ldy mt_chninstr,x
#if (FIXEDPARAMS == 0)
                lda mt_insgatetimer-1,y
                sta mt_chngatetimer,x
#endif
                lda mt_chnnewnote,x             ;Test new note init flag
                beq mt_nonewnoteinit
mt_newnoteinit:
                sec
                sbc #NOTE
                sta mt_chnnote,x
                lda #$00
#if (NOEFFECTS == 0)
#if ((NOTONEPORTA == 0) || (NOPORTAMENTO == 0) || (NOVIB == 0))
                sta mt_chnfx,x                  ;Reset effect
#endif
#endif
                sta mt_chnnewnote,x             ;Reset newnote action
#if (NOINSTRVIB == 0)
                lda mt_insvibdelay-1,y          ;Load instrument vibrato
                sta mt_chnvibdelay,x
#if (NOEFFECTS == 0)
                lda mt_insvibparam-1,y
                sta mt_chnparam,x
#endif
#endif
#if (NOTONEPORTA == 0)
                lda mt_chnnewfx,x               ;If toneportamento, skip
                cmp #TONEPORTA                  ;most of note init
                beq mt_nonewnoteinit
#endif

#if (FIXEDPARAMS == 0)
                lda mt_insfirstwave-1,y         ;Load first frame waveform
#if (NOFIRSTWAVECMD == 0)
                beq mt_skipwave
                cmp #$fe
                bcs mt_skipwave2                ;Skip waveform but load gate
#endif
#else
                lda #FIRSTWAVEPARAM
#endif
                sta mt_chnwave,x
#if ((NUMLEGATOINSTR > 0) || (NOFIRSTWAVECMD == 0))
                lda #$ff
mt_skipwave2:
                sta mt_chngate,x                ;Reset gateflag
#else
                inc mt_chngate,x
#endif
mt_skipwave:   

#if (NOPULSE == 0)
                lda mt_inspulseptr-1,y          ;Load pulseptr (if nonzero)
                beq mt_skippulse
                sta mt_chnpulseptr,x
#if (NOPULSEMOD == 0)
                lda #$00                        ;Reset pulse step duration
                sta mt_chnpulsetime,x
#endif
#endif
mt_skippulse:
#if (NOFILTER == 0)
                lda mt_insfiltptr-1,y           ;Load filtptr (if nonzero)
                beq mt_skipfilt
                sta mt_filtstep+1
#if (NOFILTERMOD == 0)
                lda #$00
                sta mt_filttime+1
#endif
#endif
mt_skipfilt:

                lda mt_inswaveptr-1,y           ;Load waveptr
                sta mt_chnwaveptr,x

                lda mt_inssr-1,y                ;Load Sustain/Release
#if (BUFFEREDWRITES == 0)
                sta SIDBASE+$06,x
#else
#if (ZPGHOSTREGS == 0)
                sta mt_chnsr,x
#else
                sta <ghostsr,x
#endif
#endif
                lda mt_insad-1,y                ;Load Attack/Decay
#if (BUFFEREDWRITES == 0)
                sta SIDBASE+$05,x
#else
#if (ZPGHOSTREGS == 0)
                sta mt_chnad,x
#else
                sta <ghostad,x
#endif
#endif

#if (NOEFFECTS == 0)
                lda mt_chnnewparam,x            ;Execute tick 0 FX after
mt_tick0jump1:                                  ;newnote init
                jsr mt_tick0_0
#endif
#if (BUFFEREDWRITES == 0)
                jmp mt_loadregswaveonly
#else
                jmp mt_loadregs
#endif

#if (NOWAVECMD == 0)
mt_wavecmd:
                jmp mt_execwavecmd
#endif

        ;Tick 0 effect execution

mt_nonewnoteinit:
#if (NOEFFECTS == 0)
                lda mt_chnnewparam,x            ;No new note init - exec tick 0
mt_tick0jump2:
                jsr mt_tick0_0                  ;FX, and wavetable afterwards
#endif

        ;Wavetable execution

mt_waveexec:
                ldy mt_chnwaveptr,x
                beq mt_wavedone
                lda mt_wavetbl-1,y
#if (NOWAVEDELAY == 0)
                cmp #$10                        ;0-15 used as delay
                bcs mt_nowavedelay              ;+ no wave change
                cmp mt_chnwavetime,x
                beq mt_nowavechange
                inc mt_chnwavetime,x
                bne mt_wavedone
mt_nowavedelay:
                sbc #$10
#else
                beq mt_nowavechange
#endif
#if (NOWAVECMD == 0)
                cmp #$e0
                bcs mt_nowavechange
#endif
                sta mt_chnwave,x
mt_nowavechange:
                lda mt_wavetbl,y
                cmp #LOOPWAVE                  ;Check for wavetable jump
                iny
                tya
                bcc mt_nowavejump
#if (NOWAVECMD != 0)
                clc
#endif
                lda mt_notetbl-1,y
mt_nowavejump:
                sta mt_chnwaveptr,x
#if (NOWAVEDELAY == 0)
                lda #$00
                sta mt_chnwavetime,x
#endif

#if (NOWAVECMD == 0)
                lda mt_wavetbl-2,y
                cmp #$e0
                bcs mt_wavecmd
#endif

                lda mt_notetbl-2,y

#if ((NOTONEPORTA == 0) || (NOPORTAMENTO == 0) || (NOVIB == 0))
                bne mt_wavefreq                 ;No frequency-change?

        ;No frequency-change / continuous effect execution

mt_wavedone:
#if (REALTIMEOPTIMIZATION != 0)
                lda mt_chncounter,x             ;No continuous effects on tick0
#if (PULSEOPTIMIZATION != 0)
                beq mt_gatetimer
#else
                beq mt_done
#endif
#endif
#if (NOEFFECTS == 0)
                ldy mt_chnfx,x
#if (NOWAVECMD == 0)
#if (1)
                sty mt_effectnum+1
#endif
#endif
                lda mt_effectjumptbl,y
                sta mt_effectjump+1
                ldy mt_chnparam,x
#else
                ldy mt_chninstr,x
                lda mt_insvibparam-1,y
                tay
#endif
mt_setspeedparam:
#if (NOCALCULATEDSPEED != 0)
                lda mt_speedrighttbl-1,y
                sta <mt_temp1
#else
#if (NONORMALSPEED == 0)
                lda mt_speedlefttbl-1,y
                bmi mt_calculatedspeed
mt_normalspeed:
                sta <mt_temp2
                lda mt_speedrighttbl-1,y
                sta <mt_temp1
                jmp mt_effectjump
#else
#if (NOZEROSPEED == 0)
                bne mt_calculatedspeed
mt_zerospeed:
                sty <mt_temp1
                sty <mt_temp2
                beq mt_effectjump
#endif
#endif
mt_calculatedspeed:
                lda mt_speedrighttbl-1,y
                sta mt_cscount+1
                sty mt_csresty+1
                ldy mt_chnlastnote,x
                lda mt_freqtbllo+1-FIRSTNOTE,y
                sec
                sbc mt_freqtbllo-FIRSTNOTE,y
                sta <mt_temp1
                lda mt_freqtblhi+1-FIRSTNOTE,y
                sbc mt_freqtblhi-FIRSTNOTE,y
mt_cscount:     ldy #$00
                beq mt_csresty
mt_csloop:      lsr
                ror <mt_temp1
                dey
                bne mt_csloop
mt_csresty:     ldy #$00
                sta <mt_temp2
#endif
mt_effectjump:
                jmp mt_effect_0
#else
                beq mt_wavedone
#endif

        ;Setting note frequency

mt_wavefreq:
                bpl mt_wavenoteabs
                adc mt_chnnote,x
                and #$7f
mt_wavenoteabs:
#if (NOCALCULATEDSPEED == 0)
                sta mt_chnlastnote,x
#endif
                tay
mt_wavenote:
#if (NOVIB == 0)
                lda #$00                        ;Reset vibrato phase
                sta mt_chnvibtime,x
#endif
                lda mt_freqtbllo-FIRSTNOTE,y
#if (ZPGHOSTREGS == 0)
                sta mt_chnfreqlo,x
                lda mt_freqtblhi-FIRSTNOTE,y
mt_storefreqhi:
                sta mt_chnfreqhi,x
#else
                sta <ghostfreqlo,x
                lda mt_freqtblhi-FIRSTNOTE,y
mt_storefreqhi:
                sta <ghostfreqhi,x
#endif

        ;Check for new note fetch

#if ((NOTONEPORTA != 0) && (NOPORTAMENTO != 0) && (NOVIB != 0))
mt_wavedone:
#endif
mt_done:
#if (PULSEOPTIMIZATION != 0)
                lda mt_chncounter,x             ;Check for gateoff timer
mt_gatetimer:
#if (FIXEDPARAMS == 0)
                cmp mt_chngatetimer,x
#else
                cmp #GATETIMERPARAM
#endif

                beq mt_getnewnote               ;Fetch new notes if equal
#endif

        ;Pulse execution
#if (NOPULSE == 0)
mt_pulseexec:
                ldy mt_chnpulseptr,x  ;See if pulse stopped
                beq mt_pulseskip
#if (PULSEOPTIMIZATION != 0)
                ora mt_chnpattptr,x             ;Skip when sequencer executed
                beq mt_pulseskip
#endif
#if (NOPULSEMOD == 0)
                lda mt_chnpulsetime,x           ;Pulse step counter time left?
                bne mt_pulsemod
#endif
mt_newpulsestep:
                lda mt_pulsetimetbl-1,y         ;Set pulse, or new modulation
#if (NOPULSEMOD == 0)
                bpl mt_newpulsemod              ;step?
#endif
mt_setpulse:
#if (SIMPLEPULSE == 0)
#if (ZPGHOSTREGS == 0)
                sta mt_chnpulsehi,x             ;Highbyte
#else
                sta <ghostpulsehi,x
#endif
#endif
                lda mt_pulsespdtbl-1,y          ;Lowbyte
#if (ZPGHOSTREGS == 0)
                sta mt_chnpulselo,x
#else
                sta <ghostpulselo,x
#if (SIMPLEPULSE != 0)
                sta <ghostpulsehi,x
#endif
#endif
#if (NOPULSEMOD == 0)
                jmp mt_nextpulsestep
mt_newpulsemod:
                sta mt_chnpulsetime,x
mt_pulsemod:
#if (SIMPLEPULSE == 0)
                lda mt_pulsespdtbl-1,y          ;Take pulse speed
                clc
                bpl mt_pulseup
#if (ZPGHOSTREGS == 0)
                dec mt_chnpulsehi,x
mt_pulseup:
                adc mt_chnpulselo,x             ;Add pulse lowbyte
                sta mt_chnpulselo,x
                bcc mt_pulsenotover
                inc mt_chnpulsehi,x
#else
                dec <ghostpulsehi,x
mt_pulseup:
                adc <ghostpulselo,x             ;Add pulse lowbyte
                sta <ghostpulselo,x
                bcc mt_pulsenotover
                inc <ghostpulsehi,x
#endif
mt_pulsenotover:
#else
#if (ZPGHOSTREGS == 0)
                lda mt_chnpulselo,x
                clc
                adc mt_pulsespdtbl-1,y
                adc #$00
                sta mt_chnpulselo,x
#else
                lda <ghostpulselo,x
                clc
                adc mt_pulsespdtbl-1,y
                adc #$00
                sta <ghostpulselo,x
                sta <ghostpulsehi,x
#endif
#endif
                dec mt_chnpulsetime,x
                bne mt_pulsedone2
#endif

mt_nextpulsestep:
                lda mt_pulsetimetbl,y           ;Jump in pulsetable?
                cmp #LOOPPULSE
                iny
                tya
                bcc mt_nopulsejump
                lda mt_pulsespdtbl-1,y          ;Take jump point
mt_nopulsejump:
                sta mt_chnpulseptr,x
mt_pulsedone:
#if (BUFFEREDWRITES == 0)
                lda mt_chnpulselo,x
#endif
mt_pulsedone2:
#if (BUFFEREDWRITES == 0)
                sta SIDBASE+$02,x
#if (SIMPLEPULSE == 0)
                lda mt_chnpulsehi,x
#endif
                sta SIDBASE+$03,x
#endif
mt_pulseskip:
#endif

#if (PULSEOPTIMIZATION == 0)
                lda mt_chncounter,x             ;Check for gateoff timer
mt_gatetimer:
#if (FIXEDPARAMS == 0)
                cmp mt_chngatetimer,x
#else
                cmp #GATETIMERPARAM
#endif

                beq mt_getnewnote               ;Fetch new notes if equal
#endif

                jmp mt_loadregs

        ;New note fetch

mt_getnewnote:
                ldy mt_chnpattnum,x
                lda mt_patttbllo,y
                sta <mt_temp1
                lda mt_patttblhi,y
                sta <mt_temp2
                ldy mt_chnpattptr,x
                lda (mt_temp1),y
                cmp #FX
                bcc mt_instr                    ;Instr. change
#if (NOEFFECTS == 0)
                cmp #NOTE
                bcc mt_fx                       ;FX
#endif
                cmp #FIRSTPACKEDREST
                bcc mt_note                     ;Note only

        ;Packed rest handling

mt_packedrest:
                lda mt_chnpackedrest,x
                bne mt_packedrestnonew
                lda (mt_temp1),y
mt_packedrestnonew:
                adc #$00
                sta mt_chnpackedrest,x
                beq mt_rest
                bne mt_loadregs

        ;Instrument change

mt_instr:
                sta mt_chninstr,x               ;Instrument change, followed
                iny
                lda (mt_temp1),y                ;by either FX or note

#if (NOEFFECTS == 0)
                cmp #NOTE
                bcs mt_note

        ;Effect change

mt_fx:
                cmp #FXONLY                     ;Note follows?
                and #$0f
                sta mt_chnnewfx,x
                beq mt_fx_noparam               ;Effect 0 - no param.
                iny
                lda (mt_temp1),y
                sta mt_chnnewparam,x
mt_fx_noparam:
                bcs mt_rest
mt_fx_getnote:
                iny
                lda (mt_temp1),y
#endif

        ;Note handling

mt_note:
                cmp #REST                   ;Rest or gateoff/on?
#if (NOGATE == 0)
                bcc mt_normalnote
#endif
                beq mt_rest
mt_gate:
#if (NOGATE == 0)
                ora #$f0
                bne mt_setgate
#endif

        ;Prepare for note start; perform hardrestart

mt_normalnote:
#if (NOTRANS == 0)
                adc mt_chntrans,x
#endif
                sta mt_chnnewnote,x
#if (NOTONEPORTA == 0)
                lda mt_chnnewfx,x           ;If toneportamento, no gateoff
                cmp #TONEPORTA
                beq mt_rest
#endif
#if (((NUMHRINSTR > 0) && (NUMNOHRINSTR > 0)) || (NUMLEGATOINSTR > 0))
                lda mt_chninstr,x
                cmp #FIRSTNOHRINSTR         ;Instrument order -
#if (NUMLEGATOINSTR > 0)
                bcs mt_nohr_legato          ;With HR - no HR - legato
#else
                bcs mt_skiphr
#endif
#endif
#if (NUMHRINSTR > 0)
                lda #SRPARAM                ;Hard restart 
#if (BUFFEREDWRITES == 0)
                sta SIDBASE+$06,x
#else
#if (ZPGHOSTREGS == 0)
                sta mt_chnsr,x
#else
                sta <ghostsr,x
#endif
#endif
                lda #ADPARAM                 
#if (BUFFEREDWRITES == 0)
                sta SIDBASE+$05,x
#else
#if (ZPGHOSTREGS == 0)
                sta mt_chnad,x
#else
                sta <ghostad,x
#endif
#endif
            
#endif
mt_skiphr:
                lda #$fe
mt_setgate:
                sta mt_chngate,x

        ;Check for end of pattern

mt_rest:
                iny
                lda (mt_temp1),y
                beq mt_endpatt
                tya
mt_endpatt:
                sta mt_chnpattptr,x

        ;Load voice registers

mt_loadregs:
#if (BUFFEREDWRITES == 0)
                lda mt_chnfreqlo,x
                sta SIDBASE+$00,x
                lda mt_chnfreqhi,x
                sta SIDBASE+$01,x
mt_loadregswaveonly:
                lda mt_chnwave,x
                and mt_chngate,x
                sta SIDBASE+$04,x
#else
#if (SOUNDSUPPORT != 0)
                ldy mt_chnsfx,x
                bne mt_sfxexec
#endif
#if (ZPGHOSTREGS == 0)
                lda mt_chnpulselo,x
#if (SIMPLEPULSE == 0)
                sta SIDBASE+$02,x
                lda mt_chnpulsehi,x
                sta SIDBASE+$03,x
#else
                sta SIDBASE+$02,x
                sta SIDBASE+$03,x
#endif
                lda mt_chnsr,x
                sta SIDBASE+$06,x              
                lda mt_chnad,x
                sta SIDBASE+$05,x
mt_loadregswavefreq:
                lda mt_chnfreqlo,x
                sta SIDBASE+$00,x
                lda mt_chnfreqhi,x
                sta SIDBASE+$01,x
mt_loadregswaveonly:
                lda mt_chnwave,x
                and mt_chngate,x
                sta SIDBASE+$04,x
#else
mt_loadregswaveonly:
                lda mt_chnwave,x
                and mt_chngate,x
                sta <ghostwave,x
#endif
#endif
                rts

#if (NUMLEGATOINSTR > 0)
mt_nohr_legato:
                cmp #FIRSTLEGATOINSTR
                bcc mt_skiphr
                bcs mt_rest
#endif

        ;Sound FX code

#if (SOUNDSUPPORT != 0)
#if (ZPGHOSTREGS == 0)

        ;Sound FX code without ghostregs

mt_sfxexec:     lda mt_chnsfxlo,x
                sta <mt_temp1
                lda mt_chnsfxhi,x
                sta <mt_temp2
                lda #$fe
                sta mt_chngate,x
                lda #$00
                sta mt_chnwaveptr,x
                inc mt_chnsfx,x
                cpy #$02
                beq mt_sfxexec_frame0
                bcs mt_sfxexec_framen
                sta SIDBASE+$06,x                ;Hardrestart before sound FX
                sta SIDBASE+$05,x                ;begins
                bcc mt_loadregswavefreq
mt_sfxexec_frame0:
                tay
                lda (mt_temp1),y           ;Load ADSR
                sta SIDBASE+$05,x
                iny
                lda (mt_temp1),y
                sta SIDBASE+$06,x
                iny
                lda (mt_temp1),y           ;Load pulse
                sta SIDBASE+$02,x
                sta SIDBASE+$03,x
                lda #$09                   ;Testbit
mt_sfxexec_wavechg:
                sta mt_chnwave,x
                sta SIDBASE+$04,x
mt_sfxexec_done:
                rts
mt_sfxexec_framen:
                lda (mt_temp1),y
                bne mt_sfxexec_noend
mt_sfxexec_end:
                sta mt_chnsfx,x
                beq mt_sfxexec_wavechg
mt_sfxexec_noend:
                tay
                lda mt_freqtbllo-$80,y        ;Get frequency
                sta SIDBASE+$00,x
                lda mt_freqtblhi-$80,y
                sta SIDBASE+$01,x
                ldy mt_chnsfx,x
                lda (mt_temp1),y              ;Then take a look at the next
                beq mt_sfxexec_done           ;byte
                cmp #$82                      ;Is it a waveform or a note?
                bcs mt_sfxexec_done
                inc mt_chnsfx,x
                bcc mt_sfxexec_wavechg

#else

        ;Sound FX code with ghostregs

mt_sfxexec:
                lda mt_chnsfxlo,x
                sta <mt_temp1
                lda mt_chnsfxhi,x
                sta <mt_temp2
                lda #$fe
                sta mt_chngate,x
                lda #$00
                sta mt_chnwaveptr,x
                inc mt_chnsfx,x
                cpy #$02
                bcc mt_sfxexec_fr1                  ;Hardrestart frame?
                beq mt_sfxexec_fr2                  ;First or nth frame?
mt_sfxexec_fr3:
                lda (mt_temp1),y
                bne mt_sfxexec_noend
mt_sfxexec_end:
                sta mt_chnsfx,x
                beq mt_sfxexec_wavechg
mt_sfxexec_noend:
                tay
                lda mt_freqtbllo-$80,y        ;Get frequency
                sta <ghostfreqlo,x
                lda mt_freqtblhi-$80,y
                sta <ghostfreqhi,x
                ldy mt_chnsfx,x
                lda (mt_temp1),y              ;Then take a look at the next
                beq mt_sfxexec_done           ;byte
                cmp #$82                      ;Is it a waveform or a note?
                bcs mt_sfxexec_done
                inc mt_chnsfx,x
mt_sfxexec_wavechg:
                sta mt_chnwave,x
                sta <ghostwave,x
mt_sfxexec_done:
                ldy #$00
                lda (mt_temp1),y             ;Load ADSR
                sta <ghostad,x
                iny
                lda (mt_temp1),y
                sta <ghostsr,x
                iny
                lda (mt_temp1),y             ;Load pulse
                sta <ghostpulselo,x
                sta <ghostpulsehi,x
                rts

mt_sfxexec_fr1:
                sta <ghostad,x               ;Hardrestart before sound FX
                sta <ghostsr,x               ;begins
                bcc mt_loadregswaveonly

mt_sfxexec_fr2:
                lda #$09
                bne mt_sfxexec_wavechg

#endif
#endif

        ;Wavetable command exec

#if (NOWAVECMD == 0)
mt_execwavecmd:
                and #$0f
                sta <mt_temp1
                lda mt_notetbl-2,y
                sta <mt_temp2
                ldy <mt_temp1
#if ((NOTONEPORTA == 0) || (NOPORTAMENTO == 0) || (NOVIB == 0))
                cpy #$05
                bcs mt_execwavetick0
mt_execwavetickn:
#if (1)
                sty mt_effectnum+1
#endif
                lda mt_effectjumptbl,y
                sta mt_effectjump+1
                ldy <mt_temp2
                jmp mt_setspeedparam
#endif
mt_execwavetick0:
                lda mt_tick0jumptbl,y
                sta mt_execwavetick0jump+1
                lda <mt_temp2
mt_execwavetick0jump:
                jsr mt_tick0_0
                jmp mt_done
#endif

#if (NOEFFECTS == 0)
#if (1)
mt_tick0jumptbl:
                .byte (mt_tick0_0 & 255)
                .byte (mt_tick0_12 & 255)
                .byte (mt_tick0_12 & 255)
                .byte (mt_tick0_34 & 255)
                .byte (mt_tick0_34 & 255)
                .byte (mt_tick0_5 & 255)
                .byte (mt_tick0_6 & 255)
                .byte (mt_tick0_7 & 255)
                .byte (mt_tick0_8 & 255)
                .byte (mt_tick0_9 & 255)
                .byte (mt_tick0_a & 255)
                .byte (mt_tick0_b & 255)
                .byte (mt_tick0_c & 255)
                .byte (mt_tick0_d & 255)
                .byte (mt_tick0_e & 255)
                .byte (mt_tick0_f & 255)
#endif
#endif

#if (NOEFFECTS == 0)
#if (1)
#if ((NOTONEPORTA == 0) || (NOPORTAMENTO == 0) || (NOVIB == 0))
mt_effectjumptbl:
                .byte (mt_effect_0 & 255)
                .byte (mt_effect_12 & 255)
                .byte (mt_effect_12 & 255)
                .byte (mt_effect_3 & 255)
                .byte (mt_effect_4 & 255)
#endif
#endif
#endif

#if (1)
#if (NOFUNKTEMPO == 0)
mt_funktempotbl:
                .byte 8,5
#endif
#endif

#if ((NOEFFECTS == 0) || (NOWAVEDELAY == 0) || (NOTRANS == 0) || (NOREPEAT == 0) || (FIXEDPARAMS == 0) || (ZPGHOSTREGS != 0) || (BUFFEREDWRITES != 0) || (NOCALCULATEDSPEED == 0))

              ;Normal channel variables

mt_chnsongptr:
                .byte 0
mt_chntrans:
                .byte 0
mt_chnrepeat:
                .byte 0
mt_chnpattptr:
                .byte 0
mt_chnpackedrest:
                .byte 0
mt_chnnewfx:
                .byte 0
mt_chnnewparam:
                .byte 0

#if (NUMCHANNELS > 1)
                .byte 0,0,0,0,0,0,0
#endif
#if (NUMCHANNELS > 2)
                .byte 0,0,0,0,0,0,0
#endif

mt_chnfx:
                .byte 0
mt_chnparam:
                .byte 0
mt_chnnewnote:
                .byte 0
mt_chnwaveptr:
                .byte 0
mt_chnwave:
                .byte 0
mt_chnpulseptr:
                .byte 0
mt_chnpulsetime:
                .byte 0

#if (NUMCHANNELS > 1)
                .byte 0,0,0,0,0,0,0
#endif
#if (NUMCHANNELS > 2)
                .byte 0,0,0,0,0,0,0
#endif

mt_chnsongnum:
                .byte 0
mt_chnpattnum:
                .byte 0
mt_chntempo:
                .byte 0
mt_chncounter:
                .byte 0
mt_chnnote:
                .byte 0
mt_chninstr:
                .byte 1
mt_chngate:
                .byte $fe

#if (NUMCHANNELS > 1)
                .byte 1,0,0,0,0,1,$fe
#endif
#if (NUMCHANNELS > 2)
                .byte 2,0,0,0,0,1,$fe
#endif

#if ((ZPGHOSTREGS == 0) || (NOCALCULATEDSPEED == 0))

mt_chnvibtime:
                .byte 0
mt_chnvibdelay:
                .byte 0
mt_chnwavetime:
                .byte 0
mt_chnfreqlo:
                .byte 0
mt_chnfreqhi:
                .byte 0
mt_chnpulselo:
                .byte 0
mt_chnpulsehi:
                .byte 0

#if (NUMCHANNELS > 1)
                .byte 0,0,0,0,0,0,0
#endif
#if (NUMCHANNELS > 2)
                .byte 0,0,0,0,0,0,0
#endif

#if ((BUFFEREDWRITES != 0) || (FIXEDPARAMS == 0) || (NOCALCULATEDSPEED == 0))
mt_chnad:
                .byte 0
mt_chnsr:
                .byte 0
mt_chnsfx:
                .byte 0
mt_chnsfxlo:
                .byte 0
mt_chnsfxhi:
                .byte 0
mt_chngatetimer:
                .byte 0
mt_chnlastnote:
                .byte 0

#if (NUMCHANNELS > 1)
                .byte 0,0,0,0,0,0,0
#endif
#if (NUMCHANNELS > 2)
                .byte 0,0,0,0,0,0,0
#endif

#endif

#else

mt_chnvibtime:
                .byte 0
mt_chnvibdelay:
                .byte 0
mt_chnwavetime:
                .byte 0
mt_chnsfx:
                .byte 0
mt_chnsfxlo:
                .byte 0
mt_chnsfxhi:
                .byte 0
mt_chngatetimer:
                .byte 0

#if (NUMCHANNELS > 1)
                .byte 0,0,0,0,0,0,0
#endif
#if (NUMCHANNELS > 2)
                .byte 0,0,0,0,0,0,0
#endif

#endif

#else

              ;Optimized channel variables

mt_chnsongptr:
                .byte 0
mt_chnpattptr:
                .byte 0
mt_chnpackedrest:
                .byte 0
mt_chnnewnote:
                .byte 0
mt_chnwaveptr:
                .byte 0
mt_chnwave:
                .byte 0
mt_chnpulseptr:
                .byte 0

#if (NUMCHANNELS > 1)
                .byte 0,0,0,0,0,0,0
#endif
#if (NUMCHANNELS > 2)
                .byte 0,0,0,0,0,0,0
#endif

mt_chnpulsetime:
                .byte 0
mt_chnpulselo:
                .byte 0
mt_chnpulsehi:
                .byte 0
mt_chnvibtime:
                .byte 0
mt_chnvibdelay:
                .byte 0
mt_chnfreqlo:
                .byte 0
mt_chnfreqhi:
                .byte 0

#if (NUMCHANNELS > 1)
                .byte 0,0,0,0,0,0,0
#endif
#if (NUMCHANNELS > 2)
                .byte 0,0,0,0,0,0,0
#endif

mt_chnsongnum:
                .byte 0
mt_chnpattnum:
                .byte 0
mt_chntempo:
                .byte 0
mt_chncounter:
                .byte 0
mt_chnnote:
                .byte 0
mt_chninstr:
                .byte 1
mt_chngate:
                .byte $fe

#if (NUMCHANNELS > 1)
                .byte 1,0,0,0,0,1,$fe
#endif
#if (NUMCHANNELS > 2)
                .byte 2,0,0,0,0,1,$fe
#endif

#endif

        ;Songdata & frequencytable will be inserted by the relocator here
; Data tables appended after player.s code
; All pre-allocated at fixed sizes for JS binary patching
; This file is concatenated AFTER player.s

; --- Orderlists (per channel, single song) ---
mt_songtbllo:
  .byte 0,0,0
mt_songtblhi:
  .byte 0,0,0

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
