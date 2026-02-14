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
