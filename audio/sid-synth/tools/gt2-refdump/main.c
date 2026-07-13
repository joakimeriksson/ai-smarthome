//
// gt2dump - headless GoatTracker2 SID register reference dumper
//
// Compiles the ORIGINAL, unmodified gt2-src/gplay.c (playroutine) and
// gt2-src/gsong.c (.sng loader) together with this file, which provides
// stub definitions for the editor/sound/display globals they reference.
//
// Usage: gt2dump <song.sng> [--frames N] [--subtune N]
//
// Output (stdout):
//   {"source":"ref","song":"<basename>","subtune":<n>}
//   {"f":0,"regs":[25 decimal values of sidreg 0x00..0x18]}
//   ... one line per 50Hz frame
//
// Diagnostics go to stderr.
//

#include "goattrk2.h"

// ---------------------------------------------------------------------------
// Globals normally defined in editor/sound modules that gplay.c / gsong.c
// reference. Defaults match goattrk2.c main() (DEFAULT SETTINGS block).
// ---------------------------------------------------------------------------

EDITOR_INFO editorInfo;                    // normally gpattern.c / goattrk2.c
unsigned char sidreg[NUMSIDREGS];          // normally gsid.c
int followplay = 0;                        // normally goattrk2.c
char songfilename[MAX_FILENAME];           // normally goattrk2.c
char loadedsongfilename[MAX_FILENAME];     // normally goattrk2.c
char instrfilename[MAX_FILENAME];          // normally goattrk2.c
INSTR instrcopybuffer;                     // normally ginstr.c
int defaultpatternlength = 64;             // normally goattrk2.c
unsigned char pattused[MAX_PATT];          // normally greloc.c
unsigned char instrused[MAX_INSTR];        // normally greloc.c

// ---------------------------------------------------------------------------
// Function stubs (sound / display / undo / UI - irrelevant headless)
// ---------------------------------------------------------------------------

void sound_suspend(void) {}                // gsound.c
void sound_flush(void) {}                  // gsound.c
void resettime(void) {}                    // gdisplay.c
void incrementtime(void) {}                // gdisplay.c
void undoInitAllAreas(void) {}             // gundo.c
void undoAreaSetCheckForChange(int areaType, int areaIndex, int onOff) {} // gundo.c
void optimizetable(int num) {}             // gtable.c (optimizeeverything only)

// gtable.c: only touches editor view state
void settableview(int num, int pos)
{
  editorInfo.etnum = num;
  editorInfo.etcolumn = 0;
  editorInfo.etpos = pos;
}

// gorder.c songchange(): reset per-channel editor play positions.
// (updateviewtopos/view resets omitted - only PLAY_POS/PLAY_PATTERN use them)
void songchange(void)
{
  int c;
  for (c = 0; c < MAX_CHN; c++)
  {
    editorUndoInfo.editorInfo[c].espos = 0;
    editorUndoInfo.editorInfo[c].esend = 0;
    editorUndoInfo.editorInfo[c].epnum = c;
  }
  stopsong();
}

// ginstr.c clearinstr(): verbatim behavior (default gatetimer/firstwave
// matter: clearsong() runs it for all instruments before loading).
void clearinstr(int num)
{
  memset(&instr[num], 0, sizeof(INSTR));
  if (num)
  {
    if (editorInfo.multiplier)
      instr[num].gatetimer = 2 * editorInfo.multiplier;
    else
      instr[num].gatetimer = 1;

    instr[num].firstwave = 0x9;
  }
}

// gtable.c gettablelen(): verbatim (referenced by savesong, needed to link)
int gettablelen(int num)
{
  int c;

  for (c = MAX_TABLELEN-1; c >= 0; c--)
  {
    if (ltable[num][c] | rtable[num][c]) break;
  }
  return c+1;
}

// gtable.c gettablepartlen(): verbatim
int gettablepartlen(int num, int pos)
{
  int c;

  if (pos < 0) return 0;
  if (num == STBL) return 1;

  for (c = pos; c < MAX_TABLELEN; c++)
  {
    if (ltable[num][c] == 0xff)
    {
      c++;
      break;
    }
  }
  return c-pos;
}

// gtable.c makespeedtable(): verbatim (used by GTS2 legacy import)
int makespeedtable(unsigned data, int mode, int makenew)
{
  int c;
  unsigned char l = 0, r = 0;

  if (!data) return -1;

  switch (mode)
  {
    case MST_NOFINEVIB:
    l = (data & 0xf0) >> 4;
    r = (data & 0x0f) << 4;
    break;

    case MST_FINEVIB:
    l = (data & 0x70) >> 4;
    r = ((data & 0x0f) << 4) | ((data & 0x80) >> 4);
    break;

    case MST_FUNKTEMPO:
    l = (data & 0xf0) >> 4;
    r = data & 0x0f;
    break;

    case MST_PORTAMENTO:
    l = (data << 2) >> 8;
    r = (data << 2) & 0xff;
    break;

    case MST_RAW:
    r = data & 0xff;
    l = data >> 8;
    break;
  }

  if (makenew == 0)
  {
    for (c = 0; c < MAX_TABLELEN; c++)
    {
      if ((ltable[STBL][c] == l) && (rtable[STBL][c] == r))
        return c;
    }
  }

  for (c = 0; c < MAX_TABLELEN; c++)
  {
    if ((!ltable[STBL][c]) && (!rtable[STBL][c]))
    {
      ltable[STBL][c] = l;
      rtable[STBL][c] = r;

      settableview(STBL, c);
      return c;
    }
  }
  return -1;
}

// gtable.c deleteinstrtable(): only reachable via loadinstrument() (.ins
// files), which this tool never calls. No-op stub to satisfy the linker.
void deleteinstrtable(int i)
{
  (void)i;
  fprintf(stderr, "warning: deleteinstrtable() stub called\n");
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

static const char *basename_of(const char *path)
{
  const char *p = strrchr(path, '/');
  return p ? p + 1 : path;
}

int main(int argc, char **argv)
{
  const char *songpath = NULL;
  int frames = 1500;
  int subtune = 0;
  int c, f;

  for (c = 1; c < argc; c++)
  {
    if (!strcmp(argv[c], "--frames") && c+1 < argc)
      frames = atoi(argv[++c]);
    else if (!strcmp(argv[c], "--subtune") && c+1 < argc)
      subtune = atoi(argv[++c]);
    else if (argv[c][0] == '-')
    {
      fprintf(stderr, "unknown option: %s\n", argv[c]);
      fprintf(stderr, "usage: gt2dump <song.sng> [--frames N] [--subtune N]\n");
      return 1;
    }
    else
      songpath = argv[c];
  }

  if (!songpath)
  {
    fprintf(stderr, "usage: gt2dump <song.sng> [--frames N] [--subtune N]\n");
    return 1;
  }
  if (subtune < 0 || subtune >= MAX_SONGS)
  {
    fprintf(stderr, "subtune out of range (0-%d)\n", MAX_SONGS-1);
    return 1;
  }

  // GoatTracker2 default settings (goattrk2.c main(), DEFAULT SETTINGS)
  memset(&editorInfo, 0, sizeof editorInfo);
  editorInfo.adparam = 0x0f00;            // hard restart ADSR parameter
  editorInfo.multiplier = 1;              // 1x (50Hz PAL) speed
  editorInfo.ntsc = 0;
  editorInfo.sidmodel = 1;
  editorInfo.finevibrato = 1;
  editorInfo.optimizepulse = 1;
  editorInfo.optimizerealtime = 1;
  editorInfo.esmarkchn = -1;
  editorInfo.epmarkchn = -1;
  editorInfo.etmarknum = -1;
  editorInfo.etlock = 1;

  initchannels();

  if (strlen(songpath) >= MAX_FILENAME)
  {
    fprintf(stderr, "song path too long\n");
    return 1;
  }
  strcpy(songfilename, songpath);
  loadsong();
  if (!loadedsongfilename[0])
  {
    fprintf(stderr, "failed to load song: %s\n", songpath);
    return 1;
  }
  fprintf(stderr, "loaded \"%s\" by %s (%s), highest pattern %d, highest instr %d\n",
          songname, authorname, copyrightname, highestusedpattern, highestusedinstr);
  fprintf(stderr, "subtune %d orderlist lengths: %d/%d/%d\n", subtune,
          songlen[subtune][0], songlen[subtune][1], songlen[subtune][2]);

  if ((!songlen[subtune][0]) || (!songlen[subtune][1]) || (!songlen[subtune][2]))
  {
    fprintf(stderr, "subtune %d has a zero-length orderlist\n", subtune);
    return 1;
  }

  memset(sidreg, 0, sizeof sidreg);
  initsong(subtune, PLAY_BEGINNING);

  // First playroutine() call consumes songinit: it resets channel state and
  // runs the sequencer, but writes no SID registers (exactly as in GT2,
  // where this init happens inside one call of the 50Hz playback callback).
  playroutine();
  if (!isplaying())
  {
    fprintf(stderr, "song did not start playing\n");
    return 1;
  }

  printf("{\"source\":\"ref\",\"song\":\"%s\",\"subtune\":%d}\n",
         basename_of(songpath), subtune);

  for (f = 0; f < frames; f++)
  {
    playroutine();
    if (!isplaying())
    {
      fprintf(stderr, "song stopped at frame %d\n", f);
      break;
    }
    printf("{\"f\":%d,\"regs\":[", f);
    for (c = 0; c < NUMSIDREGS; c++)
      printf(c ? ",%d" : "%d", sidreg[c]);
    printf("]}\n");
  }

  fprintf(stderr, "dumped %d frames\n", f);
  return 0;
}
