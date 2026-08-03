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

.PHONY: verify golden worklet driver refdump serve guards doctor

# Dev server: no-cache static serving + HVSC download proxy (tools/serve.py).
# Refuses to start a second copy - a stale server on :8471 serving an old
# working tree is a very confusing way to "reproduce" a bug.
serve:
	@curl -s -o /dev/null --max-time 2 http://localhost:8471/ \
		&& echo "serve: already running on :8471" \
		|| python3 tools/serve.py 8471

# Rip regression gate: the whole guard corpus vs its committed baseline.
# `make verify` guards the ENGINE; this guards the RIPPER. Needs `make serve`.
guards:
	tools/rip-guards.sh

# Check the toolchain the rip loop depends on (server, playwright, numpy,
# sidplayfp) and say exactly what to do about anything missing.
doctor:
	tools/rip-doctor.sh
