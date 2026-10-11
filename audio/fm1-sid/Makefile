# Host build of the SID model: self tests, demo WAVs, the bench hash.
#   make test | make wav | make hash | make bench
# The FM-1 (pi32v2) build of the bench: fm1/build.sh, fm1/run.py
CC ?= cc
CFLAGS ?= -O2 -Wall -Wextra -Wno-unused-function -ffp-contract=off
SRC = src/sid.c src/sidsynth.c host/demo.c

build/sid_demo: $(SRC) src/sid.h src/sidsynth.h fm1/workload.h
	@mkdir -p build
	$(CC) $(CFLAGS) -o $@ $(SRC)

test: build/sid_demo
	build/sid_demo test

wav: build/sid_demo
	build/sid_demo wav build

hash: build/sid_demo
	build/sid_demo hash

bench: build/sid_demo
	build/sid_demo bench

clean:
	rm -rf build

.PHONY: test wav hash bench clean
