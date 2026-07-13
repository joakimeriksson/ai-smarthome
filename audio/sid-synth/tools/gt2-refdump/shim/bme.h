// Shim replacing gt2-src/bme/bme.h for the headless reference dumper.
// The real bme.h pulls in SDL and the full BME engine; the playroutine and
// song loader only need the endian-safe file I/O helpers (fread8 etc.).
#ifndef BME_H
#define BME_H

#include <stdio.h>
#include "bme_end.h"   // resolved from gt2-src/bme via include path

#endif
