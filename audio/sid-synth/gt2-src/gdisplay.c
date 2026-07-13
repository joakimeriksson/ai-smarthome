//
// GOATTRACKER v2 screen display routines
//

#define GDISPLAY_C

#include "goattrk2.h"

char *notename[] =
 {"C-0", "C#0", "D-0", "D#0", "E-0", "F-0", "F#0", "G-0", "G#0", "A-0", "A#0", "B-0",
  "C-1", "C#1", "D-1", "D#1", "E-1", "F-1", "F#1", "G-1", "G#1", "A-1", "A#1", "B-1",
  "C-2", "C#2", "D-2", "D#2", "E-2", "F-2", "F#2", "G-2", "G#2", "A-2", "A#2", "B-2",
  "C-3", "C#3", "D-3", "D#3", "E-3", "F-3", "F#3", "G-3", "G#3", "A-3", "A#3", "B-3",
  "C-4", "C#4", "D-4", "D#4", "E-4", "F-4", "F#4", "G-4", "G#4", "A-4", "A#4", "B-4",
  "C-5", "C#5", "D-5", "D#5", "E-5", "F-5", "F#5", "G-5", "G#5", "A-5", "A#5", "B-5",
  "C-6", "C#6", "D-6", "D#6", "E-6", "F-6", "F#6", "G-6", "G#6", "A-6", "A#6", "B-6",
  "C-7", "C#7", "D-7", "D#7", "E-7", "F-7", "F#7", "G-7", "G#7", "...", "---", "+++"};

char timechar[] = {':', ' '};

int timemin = 0;
int timesec = 0;
int timeframe = 0;

void printmainscreen(void)
{
  clearscreen();
  printstatus();
  
  printtext(36, 35, 0x07, "Tweaks & fixes by");
  printtext(54, 35, 0x0f, "RaveGuru");
  printtext(55, 35, 0x0a, "aveGur");
  printtext(56, 35, 0x07, "veGu");
  printtext(57, 35, 0x03, "e");
  printtext(58, 35, 0x08, "G");

  printtext(40, 36, 0x07, "Undo by");
  printtext(48, 36, 0x0f, "Jason Page");
  printtext(49, 36, 0x07, "ason Pag");
  printtext(50, 36, 0x08, "son Pa");

  // printtext(39, 36, 1, "1");
  // printtext(40, 36, 2, "2");
  // printtext(41, 36, 3, "3");
  // printtext(42, 36, 4, "4");
  // printtext(43, 36, 5, "5");
  // printtext(44, 36, 6, "6");
  // printtext(45, 36, 7, "7");
  // printtext(46, 36, 8, "8");
  // printtext(47, 36, 9, "9");
  // printtext(48, 36, 10, "A");
  // printtext(49, 36, 11, "B");
  // printtext(50, 36, 12, "C");
  // printtext(51, 36, 13, "D");
  // printtext(52, 36, 14, "E");
  // printtext(53, 36, 15, "F");

  fliptoscreen();
}

void displayupdate(void)
{
  if (cursorflashdelay >= 6)
  {
    cursorflashdelay %= 6;
    cursorflash++;
    cursorflash &= 3;
  }
  printstatus();
  fliptoscreen();
}

void printstatus(void)
{
  int c, d, color, color2;
  int cc = cursorcolortable[cursorflash];
  menu = 0;

  if ((mouseb > MOUSEB_LEFT) && (mousey <= 1) && (!eamode)) menu = 1;

  printblankc(0, 0, 15+16, MAX_COLUMNS);

  if (!menu)
  {
    if (!strlen(loadedsongfilename))
      sprintf(textbuffer, "%s - %s", programname, patchname);
    else
      sprintf(textbuffer, "%s - %s", programname, loadedsongfilename);
    textbuffer[49] = 0;
    printtext(0, 0, 15+16, textbuffer);

    int fg_active = 7;
    int fg_inactive = 8;

    printtext(40+10, 0, fg_inactive+16, "FV PO RO");

    if (editorInfo.finevibrato)
      printtext(40+10, 0, fg_active+16, "FV");

    if (editorInfo.optimizepulse)
      printtext(43+10, 0, fg_active+16, "PO");

    if (editorInfo.optimizerealtime)
      printtext(46+10, 0, fg_active+16, "RO");

    if (editorInfo.ntsc)
      printtext(49+10, 0, fg_active+16, "NTSC");
    else
      printtext(49+10, 0, fg_active+16, " PAL");

    if (!editorInfo.sidmodel)
      printtext(54+10, 0, fg_active+16, "6581");
    else
      printtext(54+10, 0, fg_active+16, "8580");

    sprintf(textbuffer, "HR:%04X", editorInfo.adparam);
    printtext(59+10, 0, fg_active+16, textbuffer);
    if (eamode) printbg(62+10+ editorInfo.eacolumn, 0, cc, 1);

    if (editorInfo.multiplier)
    {
      sprintf(textbuffer, "%2dx", editorInfo.multiplier);
      printtext(67+10, 0, fg_active+16, textbuffer);
    }
    else printtext(67+10, 0, fg_active+16, "25Hz");

    printtext(72+10, 0, fg_inactive+16, "INT FP");

    if (interpolate & 1) {
      printtext(72+10, 0, fg_active+16, "INT");
    }

    if (interpolate & 2) {
      printtext(76+10, 0, fg_active+16, "FP");
    }

    printtext(72+20, 0, 15+16, "F12=HELP");
  }
  else
  {
    printtext(0, 0, 15+16, " PLAY | PLAYPOS | PLAYPATT | STOP | LOAD | SAVE | PACK/RL | HELP | CLEAR | QUIT |");
  }

  if ((followplay) && (isplaying()))
  {
    for (c = 0; c < MAX_CHN; c++)
    {
      int newpos = chn[c].pattptr / 4;
      if (chn[c].advance) editorUndoInfo.editorInfo[c].epnum = chn[c].pattnum;

      if (newpos > pattlen[editorUndoInfo.editorInfo[c].epnum]) newpos = pattlen[editorUndoInfo.editorInfo[c].epnum];

      if (c == editorInfo.epchn)
      {
        editorInfo.eppos = newpos;
        editorInfo.epview = newpos-VISIBLEPATTROWS/2;
      }

      newpos = chn[c].songptr;
      newpos--;
      if (newpos < 0) newpos = 0;
      if (newpos > songlen[editorInfo.esnum][c]) newpos = songlen[editorInfo.esnum][c];

      if ((c == editorInfo.eschn) && (chn[c].advance))
      {
        editorInfo.eseditpos = newpos;
        if (newpos - editorInfo.esview < 0)
        {
          editorInfo.esview = newpos;
        }
        if (newpos - editorInfo.esview >= VISIBLEORDERLIST)
        {
          editorInfo.esview = newpos - VISIBLEORDERLIST + 1;
        }
      }
    }
  }

  for (c = 0; c < MAX_CHN; c++)
  {
    sprintf(textbuffer, "CHN %d PATT.%02X", c+1, editorUndoInfo.editorInfo[c].epnum);
    printtext(2+c*15, 2, CTITLE, textbuffer);

    for (d = 0; d < VISIBLEPATTROWS; d++)
    {
      int p = editorInfo.epview+d;
      color = CNORMAL;
      if ((editorUndoInfo.editorInfo[c].epnum == chn[c].pattnum) && (isplaying()))
      {
        int chnrow = chn[c].pattptr / 4;
        if (chnrow > pattlen[chn[c].pattnum]) chnrow = pattlen[chn[c].pattnum];
        if (chnrow == p) color = CPLAYING;
      }

      if (chn[c].mute) color = CMUTE;
      if (p == editorInfo.eppos) color = CEDIT;
      if ((p < 0) || (p > pattlen[editorUndoInfo.editorInfo[c].epnum]))
      {
        sprintf(textbuffer, "             ");
      }
      else
      {
        if (!(patterndispmode & 1))
        {
          if (p < 100)
            sprintf(textbuffer, " %02d", p);
          else
            sprintf(textbuffer, "%03d", p);
        }
        else
          sprintf(textbuffer, " %02X", p);

        if (pattern[editorUndoInfo.editorInfo[c].epnum][p*4] == ENDPATT)
        {
          sprintf(&textbuffer[3], " PATT. END");
          if (color == CNORMAL) color = CCOMMAND;
        }
        else
        {
          sprintf(&textbuffer[3], " %s %02X%01X%02X",
            notename[pattern[editorUndoInfo.editorInfo[c].epnum][p*4]-FIRSTNOTE],
            pattern[editorUndoInfo.editorInfo[c].epnum][p*4+1],
            pattern[editorUndoInfo.editorInfo[c].epnum][p*4+2],
            pattern[editorUndoInfo.editorInfo[c].epnum][p*4+3]);
          if (patterndispmode & 2)
          {
            if (!pattern[editorUndoInfo.editorInfo[c].epnum][p*4+1])
              memset(&textbuffer[8], '.', 2);
            if (!pattern[editorUndoInfo.editorInfo[c].epnum][p*4+2])
              memset(&textbuffer[10], '.', 3);
          }
        }
      }
      textbuffer[3] = 0;
      if (p%stepsize)
      {
        printtext(2+c*15, 3+d, CNORMAL, textbuffer);
      }
      else
      {
        printtext(2+c*15, 3+d, CCOMMAND, textbuffer);
      }
      if (color == CNORMAL)
        color2 = CCOMMAND;
      else
        color2 = color;
      printtext(6+c*15, 3+d, color2, &textbuffer[4]);
      printtext(10+c*15, 3+d, color, &textbuffer[8]);
      printtext(12+c*15, 3+d, color2, &textbuffer[10]);
      printtext(13+c*15, 3+d, color, &textbuffer[11]);
      if (c == editorInfo.epmarkchn)
      {
        if (editorInfo.epmarkstart <= editorInfo.epmarkend)
        {
          if ((p >= editorInfo.epmarkstart) && (p <= editorInfo.epmarkend))
            printbg(2+c*15+4, 3+d, 1, 9);
        }
        else
        {
          if ((p <= editorInfo.epmarkstart) && (p >= editorInfo.epmarkend))
            printbg(2+c*15+4, 3+d, 1, 9);
        }
      }
      if ((color == CEDIT) && (editorInfo.editmode == EDIT_PATTERN) && (editorInfo.epchn == c))
      {
        switch(editorInfo.epcolumn)
        {
          case 0:
          if (!eamode) printbg(2+c*15+4, 3+d, cc, 3);
          break;

          default:
          if (!eamode) printbg(2+c*15+7+editorInfo.epcolumn, 3+d, cc, 1);
          break;
        }
      }
    }
  }

  sprintf(textbuffer, "CHN ORDERLIST (SUBTUNE %02X, POS %02X)", editorInfo.esnum, editorInfo.eseditpos);
  printtext(40+10, 2, CTITLE, textbuffer);
  for (c = 0; c < MAX_CHN; c++)
  {
    sprintf(textbuffer, " %d ", c+1);
    printtext(40+10, 3+c, 15, textbuffer);
    for (d = 0; d < VISIBLEORDERLIST; d++)
    {
      int p = editorInfo.esview+d;
      color = CNORMAL;
      if (isplaying())
      {
        int chnpos = chn[c].songptr;
        chnpos--;
        if (chnpos < 0) chnpos = 0;
        if ((p == chnpos) && (chn[c].advance)) color = CPLAYING;
      }
      if (p == editorUndoInfo.editorInfo[c].espos) color = CEDIT;
      if ((editorUndoInfo.editorInfo[c].esend) && (p == editorUndoInfo.editorInfo[c].esend)) color = CEDIT;

      if ((p < 0) || (p > (songlen[editorInfo.esnum][c]+1)) || (p > MAX_SONGLEN+1))
      {
        sprintf(textbuffer, "   ");
      }
      else
      {
        if (songorder[editorInfo.esnum][c][p] < LOOPSONG)
        {
          if ((songorder[editorInfo.esnum][c][p] < REPEAT) || (p >= songlen[editorInfo.esnum][c]))
          {
            sprintf(textbuffer, "%02X ", songorder[editorInfo.esnum][c][p]);
            if ((p >= songlen[editorInfo.esnum][c]) && (color == CNORMAL)) color = CCOMMAND;
          }
          else
          {
            if (songorder[editorInfo.esnum][c][p] >= TRANSUP)
            {
              sprintf(textbuffer, "+%01X ", songorder[editorInfo.esnum][c][p]&0xf);
              if (color == CNORMAL) color = CCOMMAND;
            }
            else
            {
              if (songorder[editorInfo.esnum][c][p] >= TRANSDOWN)
              {
                sprintf(textbuffer, "-%01X ", 16-(songorder[editorInfo.esnum][c][p] & 0x0f));
                if (color == CNORMAL) color = CCOMMAND;
              }
              else
              {
                sprintf(textbuffer, "R%01X ", (songorder[editorInfo.esnum][c][p]+1) & 0x0f);
                if (color == CNORMAL) color = CCOMMAND;
              }
            }
          }
        }
        if (songorder[editorInfo.esnum][c][p] == LOOPSONG)
        {
          sprintf(textbuffer, "RST");
          if (color == CNORMAL) color = CCOMMAND;
        }
      }
      printtext(44+10+d*3, 3+c, color, textbuffer);
      if (c == editorInfo.esmarkchn)
      {
        if (editorInfo.esmarkstart <= editorInfo.esmarkend)
        {
          if ((p >= editorInfo.esmarkstart) && (p <= editorInfo.esmarkend))
          {
            if (p != editorInfo.esmarkend)
              printbg(44+10+d*3, 3+c, 1, 3);
            else
              printbg(44+10+d*3, 3+c, 1, 2);
          }
        }
        else
        {
          if ((p <= editorInfo.esmarkstart) && (p >= editorInfo.esmarkend))
          {
            if (p != editorInfo.esmarkstart)
              printbg(44+10+d*3, 3+c, 1, 3);
            else
              printbg(44+10+d*3, 3+c, 1, 2);
          }
        }
      }
      if ((p == editorInfo.eseditpos) && (editorInfo.editmode == EDIT_ORDERLIST) && (editorInfo.eschn == c))
      {
        if (!eamode) printbg(44+10+d*3+editorInfo.escolumn, 3+c, cc, 1);
      }
    }
  }

  sprintf(textbuffer, "INSTRUMENT NUM. %02X  %-16s", editorInfo.einum, instr[editorInfo.einum].name);
  printtext(40+10, 7, CTITLE, textbuffer);

  sprintf(textbuffer, "Attack/Decay    %02X", instr[editorInfo.einum].ad);
  if (editorInfo.eipos == 0) color = CEDIT; else color = CNORMAL;
  printtext(40+10, 8, color, textbuffer);

  sprintf(textbuffer, "Sustain/Release %02X", instr[editorInfo.einum].sr);
  if (editorInfo.eipos == 1) color = CEDIT; else color = CNORMAL;
  printtext(40+10, 9, color, textbuffer);

  sprintf(textbuffer, "Wavetable Pos   %02X", instr[editorInfo.einum].ptr[WTBL]);
  if (editorInfo.eipos == 2) color = CEDIT; else color = CNORMAL;
  printtext(40+10, 10, color, textbuffer);

  sprintf(textbuffer, "Pulsetable Pos  %02X", instr[editorInfo.einum].ptr[PTBL]);
  if (editorInfo.eipos == 3) color = CEDIT; else color = CNORMAL;
  printtext(40+10, 11, color, textbuffer);

  sprintf(textbuffer, "Filtertable Pos %02X", instr[editorInfo.einum].ptr[FTBL]);
  if (editorInfo.eipos == 4) color = CEDIT; else color = CNORMAL;
  printtext(40+10, 12, color, textbuffer);

  sprintf(textbuffer, "Vibrato Param   %02X", instr[editorInfo.einum].ptr[STBL]);
  if (editorInfo.eipos == 5) color = CEDIT; else color = CNORMAL;
  printtext(60+10, 8, color, textbuffer);

  sprintf(textbuffer, "Vibrato Delay   %02X", instr[editorInfo.einum].vibdelay);
  if (editorInfo.eipos == 6) color = CEDIT; else color = CNORMAL;
  printtext(60+10, 9, color, textbuffer);

  sprintf(textbuffer, "HR/Gate Timer   %02X", instr[editorInfo.einum].gatetimer);
  if (editorInfo.eipos == 7) color = CEDIT; else color = CNORMAL;
  printtext(60+10, 10, color, textbuffer);

  sprintf(textbuffer, "1stFrame Wave   %02X", instr[editorInfo.einum].firstwave);
  if (editorInfo.eipos == 8) color = CEDIT; else color = CNORMAL;
  printtext(60+10, 11, color, textbuffer);

  if (editorInfo.editmode == EDIT_INSTRUMENT)
  {
    if (editorInfo.eipos < 9)
    {
      if (!eamode) printbg(56+10+editorInfo.eicolumn+20*(editorInfo.eipos/5), 8+(editorInfo.eipos%5), cc, 1);
    }
    else
    {
      if (!eamode) printbg(60+10+strlen(instr[editorInfo.einum].name), 7, cc, 1);
    }
  }

  sprintf(textbuffer, "WAVE TBL  PULSETBL  FILT.TBL  SPEEDTBL");
  printtext(40+10, 14, CTITLE, textbuffer);

  for (c = 0; c < MAX_TABLES; c++)
  {
    for (d = 0; d < VISIBLETABLEROWS; d++)
    {
      int p = editorInfo.etview[c]+d;

      color = CNORMAL;
      switch (c)
      {
        case WTBL:
        if (ltable[c][p] >= WAVECMD) color = CCOMMAND;
        break;

        case PTBL:
        if (ltable[c][p] >= 0x80) color = CCOMMAND;
        break;

        case FTBL:
        if ((ltable[c][p] >= 0x80) || ((!ltable[c][p]) && (rtable[c][p]))) color = CCOMMAND;
        break;
      }
      if ((p == editorInfo.etpos) && (editorInfo.etnum == c)) color = CEDIT;
      sprintf(textbuffer, "%02X:%02X %02X", p+1, ltable[c][p], rtable[c][p]);
      printtext(40+10+10*c, 15+d, color, textbuffer);

      if (editorInfo.etmarknum == c)
      {
        if (editorInfo.etmarkstart <= editorInfo.etmarkend)
        {
          if ((p >= editorInfo.etmarkstart) && (p <= editorInfo.etmarkend))
            printbg(40+10+10*c+3, 15+d, 1, 5);
        }
        else
        {
          if ((p <= editorInfo.etmarkstart) && (p >= editorInfo.etmarkend))
            printbg(40+10+10*c+3, 15+d, 1, 5);
        }
      }
    }
  }

  if (editorInfo.editmode == EDIT_TABLES)
  {
    if (!eamode) printbg(43+10+editorInfo.etnum*10+(editorInfo.etcolumn & 1)+(editorInfo.etcolumn/2)*3, 15+editorInfo.etpos-editorInfo.etview[editorInfo.etnum], cc, 1);
  }

  printtext(40+10, 31, CTITLE, "NAME   ");
  sprintf(textbuffer, "%-32s", songname);
  printtext(47+10, 31, CEDIT, textbuffer);

  printtext(40+10, 32, CTITLE, "AUTHOR ");
  sprintf(textbuffer, "%-32s", authorname);
  printtext(47+10, 32, CEDIT, textbuffer);

  printtext(40+10, 33, CTITLE, "COPYR. ");
  sprintf(textbuffer, "%-32s", copyrightname);
  printtext(47+10, 33, CEDIT, textbuffer);

  if ((editorInfo.editmode == EDIT_NAMES) && (!eamode))
  {
    switch(editorInfo.enpos)
    {
      case 0:
      printbg(47+10+strlen(songname), 31, cc, 1);
      break;
      case 1:
      printbg(47+10+strlen(authorname), 32, cc, 1);
      break;
      case 2:
      printbg(47+10+strlen(copyrightname), 33, cc, 1);
      break;
    }
  }
  sprintf(textbuffer, "OCTAVE %d", editorInfo.epoctave);
  printtext(0, 35, CTITLE, textbuffer);

  switch(autoadvance)
  {
    case 0:
    color = 10;
    break;

    case 1:
    color = 14;
    break;

    case 2:
    color = 12;
    break;
  }

  if (recordmode) printtext(0, 36, color, "EDITMODE");
  else printtext(0, 36, color, "JAM MODE");

  if (isplaying()) printtext(10, 35, CTITLE, "PLAYING");
  else printtext(10, 35, CTITLE, "STOPPED");
  if (editorInfo.multiplier)
  {
    if (!editorInfo.ntsc)
      sprintf(textbuffer, " %02d%c%02d ", timemin, timechar[timeframe/(25* editorInfo.multiplier) & 1], timesec);
    else
      sprintf(textbuffer, " %02d%c%02d ", timemin, timechar[timeframe/(30* editorInfo.multiplier) & 1], timesec);
  }
  else
  {
    if (!editorInfo.ntsc)
      sprintf(textbuffer, " %02d%c%02d ", timemin, timechar[(timeframe/13) & 1], timesec);
    else
      sprintf(textbuffer, " %02d%c%02d ", timemin, timechar[(timeframe/15) & 1], timesec);
  }

//  sprintf(textbuffer, "%d,%d", editorInfo.epchn, editorUndoInfo.editorInfo[editorInfo.epchn].epnum);

  printtext(10, 36, CEDIT, textbuffer);

  printtext(80, 35, CTITLE, " CHN1   CHN2   CHN3 ");
  for (c = 0; c < MAX_CHN; c++)
  {
    int chnpos = chn[c].songptr;
    int chnrow = chn[c].pattptr/4;
    chnpos--;
    if (chnpos < 0) chnpos = 0;
    if (chnrow > pattlen[chn[c].pattnum]) chnrow = pattlen[chn[c].pattnum];
    if (chnrow >= 100) chnrow -= 100;

    sprintf(textbuffer, "%03d/%02d",
      chnpos,chnrow);
    printtext(80+7*c, 36, CEDIT, textbuffer);
  }

  if (editorInfo.etlock) printtext(78, 36, CTITLE, " ");
    else printtext(78, 36, CTITLE, "U");
}


void resettime(void)
{
  timemin = 0;
  timesec = 0;
  timeframe = 0;
}

void incrementtime(void)
{
  {
    timeframe++;
    if (!editorInfo.ntsc)
    {
      if (((editorInfo.multiplier) && (timeframe >= PALFRAMERATE* editorInfo.multiplier))
          || ((!editorInfo.multiplier) && (timeframe >= PALFRAMERATE/2)))
      {
        timeframe = 0;
        timesec++;
      }
    }
    else
    {
      if (((editorInfo.multiplier) && (timeframe >= NTSCFRAMERATE* editorInfo.multiplier))
          || ((!editorInfo.multiplier) && (timeframe >= NTSCFRAMERATE/2)))
      {
        timeframe = 0;
        timesec++;
      }
    }
    if (timesec == 60)
    {
      timesec = 0;
      timemin++;
      timemin %= 60;
    }
  }
}

