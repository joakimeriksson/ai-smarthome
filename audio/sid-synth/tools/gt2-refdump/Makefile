# gt2dump - headless GoatTracker2 SID register reference dumper
#
# Compiles the ORIGINAL gt2-src/gplay.c and gt2-src/gsong.c (unmodified)
# plus bme_end.c (endian file I/O) with local stubs in main.c.
# shim/ is searched before gt2-src/bme so bme.h / SDL_types.h resolve to
# harmless headless replacements (no SDL required).

CC ?= gcc
GT2SRC = ../../gt2-src
CFLAGS ?= -O2 -Wall -Wno-unused-variable -Wno-unused-but-set-variable
CPPFLAGS = -Ishim -I$(GT2SRC) -I$(GT2SRC)/bme

SRCS = main.c $(GT2SRC)/gplay.c $(GT2SRC)/gsong.c $(GT2SRC)/bme/bme_end.c

gt2dump: $(SRCS) shim/bme.h shim/SDL_types.h
	$(CC) $(CFLAGS) $(CPPFLAGS) -o $@ $(SRCS)

clean:
	rm -f gt2dump

.PHONY: clean
