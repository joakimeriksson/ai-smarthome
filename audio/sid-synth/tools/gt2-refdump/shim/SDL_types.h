// Shim replacing SDL's SDL_types.h so gt2-src/bme/bme_end.c compiles
// without SDL installed. Only the fixed-width typedefs are needed.
#ifndef SDL_TYPES_H_SHIM
#define SDL_TYPES_H_SHIM

#include <stdint.h>

typedef uint8_t  Uint8;
typedef int8_t   Sint8;
typedef uint16_t Uint16;
typedef int16_t  Sint16;
typedef uint32_t Uint32;
typedef int32_t  Sint32;

#endif
