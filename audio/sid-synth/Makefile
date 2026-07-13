# SID Tracker top-level targets

# Run the GT2 parity regression suite: native gplay.c reference vs the
# AudioWorklet engine vs exported .SID files, register-by-register.
verify:
	tools/verify.sh

# Refresh the golden reference dumps (tests/golden/) from the native gt2dump.
# Golden dumps let `make verify` run without gcc and catch reference drift.
golden:
	tools/verify.sh --update-golden

# Rebuild the AudioWorklet bundle (jsSID + worklet body)
worklet:
	tools/build-worklet.sh

# Rebuild the GT2 6502 driver used by the .SID exporter (requires xa65)
driver:
	$(MAKE) -C exporters/gt2

# Rebuild the native gplay.c reference dumper
refdump:
	$(MAKE) -C tools/gt2-refdump

.PHONY: verify golden worklet driver refdump
