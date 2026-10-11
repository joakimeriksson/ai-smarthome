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

# ---- engine comparison (host only): reSID 0.16, reSID 1.0 and reSIDfp, all GPL-2.0-or-later,
# fetched into ext/ by tools/fetch_ext.sh (not part of this repo)
R016 = $(addprefix ext/resid-0.16/,sid.cc voice.cc wave.cc envelope.cc filter.cc extfilt.cc pot.cc \
	wave6581_PST.cc wave6581_PS_.cc wave6581_P_T.cc wave6581__ST.cc \
	wave8580_PST.cc wave8580_PS_.cc wave8580_P_T.cc wave8580__ST.cc)
R10 = $(addprefix ext/resid10/,sid.cc voice.cc wave.cc envelope.cc filter.cc extfilt.cc pot.cc dac.cc)
RFP = $(addprefix ext/residfp/src/,Dac.cpp EnvelopeGenerator.cpp ExternalFilter.cpp Filter.cpp \
	Filter6581.cpp Filter8580.cpp FilterModelConfig.cpp FilterModelConfig6581.cpp \
	FilterModelConfig8580.cpp Integrator6581.cpp Integrator8580.cpp OpAmp.cpp SID.cpp Spline.cpp \
	State.cpp WaveformCalculator.cpp WaveformGenerator.cpp resample/SincResampler.cpp)
CXXFLAGS ?= -O2 -w

build/r016/%.o: ext/resid-0.16/%.cc
	@mkdir -p $(dir $@)
	$(CXX) $(CXXFLAGS) -std=c++98 -Iext/resid-0.16 -c $< -o $@
build/r10/%.o: ext/resid10/%.cc
	@mkdir -p $(dir $@)
	$(CXX) $(CXXFLAGS) -Iext/resid10 -c $< -o $@
build/rfp/%.o: ext/residfp/src/%.cpp
	@mkdir -p $(dir $@)
	$(CXX) $(CXXFLAGS) -std=c++17 -Iext/residfp/src -c $< -o $@

ENGOBJ = $(R016:ext/resid-0.16/%.cc=build/r016/%.o) $(R10:ext/resid10/%.cc=build/r10/%.o) \
	$(RFP:ext/residfp/src/%.cpp=build/rfp/%.o)

build/eng_r016.o: host/eng_resid016.cc host/engines.h
	$(CXX) $(CXXFLAGS) -Iext/resid-0.16 -c $< -o $@
build/eng_r10.o: host/eng_resid10.cc host/engines.h
	$(CXX) $(CXXFLAGS) -Iext/resid10 -c $< -o $@
build/eng_rfp.o: host/eng_residfp.cc host/engines.h
	$(CXX) $(CXXFLAGS) -std=c++17 -Iext/residfp/src -c $< -o $@

build/sid_replay: host/replay.cc src/sid.c build/eng_r016.o build/eng_r10.o build/eng_rfp.o $(ENGOBJ)
	$(CC) $(CFLAGS) -c src/sid.c -o build/sid_own.o
	$(CXX) -O2 -std=c++17 -o $@ host/replay.cc build/sid_own.o build/eng_r016.o build/eng_r10.o \
		build/eng_rfp.o $(ENGOBJ) -lpthread

build/sid_record: $(SRC) src/sid.h src/sidsynth.h fm1/workload.h
	@mkdir -p build
	$(CC) $(CFLAGS) -DSID_LOG -o $@ $(SRC)

# the tune logger: libsidplayfp 2.6.0 (ext/, patched by tools/fetch_ext.sh) runs the whole C64
LSP = ext/libsidplayfp-2.6.0
build/sidlogger: host/sidlogger.cpp $(LSP)/src/.libs/libsidplayfp.a
	@mkdir -p build
	$(CXX) -O2 -std=c++14 -I$(LSP)/src -I$(LSP) -o $@ $< $(LSP)/src/.libs/libsidplayfp.a -fopenmp -lpthread

compare: build/sid_record build/sid_replay
	tools/compare.sh

# the PSID player (player/psid.c around floooh's m6502.h, ext/chips) on the host: register stream
# as sidlog v2, to check it against build/sidlogger; and the FM-1 firmware that plays the tunes
build/psidlog: player/psid.c player/psid.h player/psidlog.c ext/chips/m6502.h
	@mkdir -p build
	$(CC) $(CFLAGS) -Iext/chips -Iplayer -o $@ player/psid.c player/psidlog.c

firmware:
	firmware/build.sh

webplayer: firmware
	tools/webplayer.sh

.PHONY: compare firmware webplayer
