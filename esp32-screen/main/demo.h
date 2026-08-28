#pragma once
#include <stdbool.h>
/* Demo mode: if the "demo" data partition holds an energydata.json, the panel renders that
 * instead of talking to the network (prices, hourly kWh, tile states, a fixed clock). Real
 * boards have the partition erased, so this is inert there; the emulator writes the file
 * into flash at the partition offset. */
bool demo_load(void);    /* true if a JSON document was found and parsed */
void demo_apply(void);   /* set the clock, push the data to the UI, take over tile taps */
