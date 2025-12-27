# Simple build to assemble GoatTracker player + glue and wrap into PSID
# Requires: cc65 toolchain (ca65/ld65) and Node.js for psid_wrap.js

PLAYER ?= player.s
GLUE   ?= gt2_glue.s
OUT    ?= song
BUILD  ?= build

# Try to discover cc65 config path; override C64_CFG if needed
CC65_CFG_PATH ?= $(shell cc65-config --cfg-path 2>/dev/null)
ifeq ($(strip $(CC65_CFG_PATH)),)
  C64_CFG ?= /usr/local/share/cc65/cfg/c64-asm.cfg
else
  C64_CFG ?= $(CC65_CFG_PATH)/c64-asm.cfg
endif

all: $(BUILD)/$(OUT).sid

$(BUILD):
	@mkdir -p $(BUILD)
	@mkdir -p driver

$(BUILD)/player.o: $(PLAYER) | $(BUILD)
	ca65 -o $@ $<

$(BUILD)/glue.o: $(GLUE) | $(BUILD)
	ca65 -o $@ $<

$(BUILD)/$(OUT).prg: $(BUILD)/glue.o $(BUILD)/player.o
	ld65 -C $(C64_CFG) -o $@ $^

$(BUILD)/$(OUT).sid: $(BUILD)/$(OUT).prg psid_wrap.js | $(BUILD)
	node psid_wrap.js $(BUILD)/$(OUT).prg --init 0x1000 --play 0x1003 --name "$(OUT)" --author "sid-synth" --out $@

clean:
	rm -rf $(BUILD)

.PHONY: all clean

# --- xa build of prebuilt GT2 driver (no WASM) ---
XA_SRC   := $(BUILD)/driver_all.s
PLAYER_S := player.s
RELOC_S  := reloc_driver.s
LABELS   := $(BUILD)/labels.txt

.PHONY: xa
xa: driver/gt2_driver.bin driver/gt2_driver.meta.json

$(XA_SRC): $(RELOC_S) $(PLAYER_S) | $(BUILD)
	cat $(RELOC_S) $(PLAYER_S) > $(XA_SRC)

driver/gt2_driver.bin: $(XA_SRC)
	xa -o $(BUILD)/gt2_driver.prg -l $(LABELS) $(XA_SRC)
	cp $(BUILD)/gt2_driver.prg $@

driver/gt2_driver.meta.json: $(LABELS) $(BUILD)/gt2_driver.prg gen_meta_from_xa.js | driver
	node gen_meta_from_xa.js $(LABELS) $(BUILD)/gt2_driver.prg > $@

# --- xasm (Exomizer assembler) build alternative ---
# Requires: Exomizer's xasm (not 'xa'). If not found, this target will fail with a message.
.PHONY: xasm
xasm: $(XA_SRC)
	@if ! command -v xasm >/dev/null 2>&1; then \
	  echo "Error: xasm not found. Build from Exomizer source (src/asm) and ensure it's on PATH." >&2; exit 1; \
	fi
	xasm -o $(BUILD)/gt2_driver.prg -l $(LABELS) $(XA_SRC)
	mkdir -p driver
	cp $(BUILD)/gt2_driver.prg driver/gt2_driver.bin
	node gen_meta_from_xa.js $(LABELS) $(BUILD)/gt2_driver.prg > driver/gt2_driver.meta.json
