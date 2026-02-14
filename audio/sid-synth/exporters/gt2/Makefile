# Build GT2 player driver and embed into JS module
# Primary target: xa (assembles with xa65)
# Requires: xa65 assembler and Node.js

PLAYER_S := player.s
RELOC_S  := reloc_driver.s
DATA_S   := data_tables.s
BUILD    := build
LABELS   := $(BUILD)/labels.txt

# Default target: build embedded JS module
all: driver/gt2-driver-data.js

$(BUILD):
	@mkdir -p $(BUILD)
	@mkdir -p driver

# Step 1: Convert player.s from Exomizer syntax to xa65 syntax
$(BUILD)/player_xa.s: $(PLAYER_S) tools/convert-to-xa.js | $(BUILD)
	node tools/convert-to-xa.js $(PLAYER_S) $@

# Step 2: Concatenate config + converted player + data tables
$(BUILD)/driver_all.s: $(RELOC_S) $(BUILD)/player_xa.s $(DATA_S) | $(BUILD)
	cat $(RELOC_S) $(BUILD)/player_xa.s $(DATA_S) > $@

# Step 3: Assemble with xa65
$(BUILD)/gt2_driver.prg: $(BUILD)/driver_all.s | $(BUILD)
	xa -o $@ -l $(LABELS) $<

# Step 4: Copy binary + generate metadata
driver/gt2_driver.bin: $(BUILD)/gt2_driver.prg | driver
	cp $< $@

driver/gt2_driver.meta.json: $(LABELS) $(BUILD)/gt2_driver.prg gen_meta_from_xa.js | driver
	node gen_meta_from_xa.js $(LABELS) $(BUILD)/gt2_driver.prg > $@

# Step 5: Embed binary + metadata into JS ES module
driver/gt2-driver-data.js: driver/gt2_driver.bin driver/gt2_driver.meta.json tools/embed-driver.js
	node tools/embed-driver.js

driver:
	@mkdir -p driver

clean:
	rm -rf $(BUILD)
	rm -f driver/gt2_driver.bin driver/gt2_driver.meta.json driver/gt2-driver-data.js

.PHONY: all clean
