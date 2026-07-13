//
// GOATTRACKER v2 pattern editor
//

#define GPATTERN_C

#include "goattrk2.h"

EDITOR_INFO editorInfo;

unsigned char notekeytbl1[] = {KEY_Z, KEY_S, KEY_X, KEY_D, KEY_C, KEY_V,
  KEY_G, KEY_B, KEY_H, KEY_N, KEY_J, KEY_M, KEY_COMMA, KEY_L, KEY_COLON};

unsigned char notekeytbl2[] = {KEY_Q, KEY_2, KEY_W, KEY_3, KEY_E, KEY_R,
  KEY_5, KEY_T, KEY_6, KEY_Y, KEY_7, KEY_U, KEY_I, KEY_9, KEY_O, KEY_0, KEY_P};

unsigned char dmckeytbl[] = {KEY_A, KEY_W, KEY_S, KEY_E, KEY_D, KEY_F,
  KEY_T, KEY_G, KEY_Y, KEY_H, KEY_U, KEY_J, KEY_K, KEY_O, KEY_L, KEY_P};

unsigned char jankokeytbl1[] = {KEY_Z, KEY_S, KEY_X, KEY_D, KEY_C, KEY_F, KEY_V,
  KEY_G, KEY_B, KEY_H, KEY_N, KEY_J, KEY_M, KEY_K, KEY_COMMA, KEY_L, KEY_COLON};

unsigned char jankokeytbl2[] = {KEY_Q, KEY_2, KEY_W, KEY_3, KEY_E, KEY_4, KEY_R,
  KEY_5, KEY_T, KEY_6, KEY_Y, KEY_7, KEY_U, KEY_8, KEY_I, KEY_9, KEY_O, KEY_0, KEY_P};

unsigned char patterncopybuffer[MAX_PATTROWS*4+4];
unsigned char cmdcopybuffer[MAX_PATTROWS*4+4];
int patterncopyrows = 0;
int cmdcopyrows = 0;

//int epnum[MAX_CHN];
//int editorInfo.eppos;
//int editorInfo.epview;
//int editorInfo.epcolumn;
//int editorInfo.epchn;
//int editorInfo.epoctave = 2;
//int editorInfo.epmarkchn = -1;
//int editorInfo.epmarkstart;
//int editorInfo.epmarkend;

void patterncommands(void)
{
  int c, scrrep;

  switch(key)
  {
    case '<':
    case '[':
    prevpattern();
    break;

    case '>':
    case ']':
    nextpattern();
    break;
  }
  {
    int newnote = -1;
    if (key)
    {
      switch (keypreset)
      {
        case KEY_TRACKER:
        for (c = 0; c < sizeof(notekeytbl1); c++)
        {
          if ((rawkey == notekeytbl1[c]) && (!editorInfo.epcolumn) && (!shiftpressed))
          {
            newnote = FIRSTNOTE+c+editorInfo.epoctave*12;
          }
        }
        for (c = 0; c < sizeof(notekeytbl2); c++)
        {
          if ((rawkey == notekeytbl2[c]) && (!editorInfo.epcolumn) && (!shiftpressed))
          {
            newnote = FIRSTNOTE+c+(editorInfo.epoctave+1)*12;
          }
        }
        break;

        case KEY_DMC:
        for (c = 0; c < sizeof(dmckeytbl); c++)
        {
          if ((rawkey == dmckeytbl[c]) && (!editorInfo.epcolumn) && (!shiftpressed))
          {
            newnote = FIRSTNOTE+c+editorInfo.epoctave*12;
          }
        }
        break;
        
        case KEY_JANKO:
        for (c = 0; c < sizeof(jankokeytbl1); c++)
        {
          if ((rawkey == jankokeytbl1[c]) && (!editorInfo.epcolumn) && (!shiftpressed))
          {
            newnote = FIRSTNOTE+c+editorInfo.epoctave*12;
          }
        }
        for (c = 0; c < sizeof(jankokeytbl2); c++)
        {
          if ((rawkey == jankokeytbl2[c]) && (!editorInfo.epcolumn) && (!shiftpressed))
          {
            newnote = FIRSTNOTE+c+(editorInfo.epoctave+1)*12;
          }
        }
        break;
      }
    }

    if (newnote > LASTNOTE) newnote = -1;
    if ((rawkey == 0x08) && (!editorInfo.epcolumn)) newnote = REST;
    if ((rawkey == 0x14) && (!editorInfo.epcolumn)) newnote = KEYOFF;
    if (rawkey == KEY_ENTER)
    {
      switch(editorInfo.epcolumn)
      {
        case 0:
        if (shiftpressed)
          newnote = KEYON;
        else
          newnote = KEYOFF;
        break;

        case 1:
        case 2:
        if (pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+1])
        {
          gotoinstr(pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+1]);
          return;
        }
        break;

        default:
        switch (pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+2])
        {
          case CMD_SETWAVEPTR:
          if (pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3])
          {
            gototable(WTBL, pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] - 1);
            return;
          }
          else
          {
            if (shiftpressed)
            {
              int pos = gettablelen(WTBL);
              if (pos >= MAX_TABLELEN-1) pos = MAX_TABLELEN - 1;
              pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] = pos + 1;
              gototable(WTBL, pos);
              return;
            }
          }
          break;

          case CMD_SETPULSEPTR:
          if (pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3])
          {
            gototable(PTBL, pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] - 1);
            return;
          }
          else
          {
            if (shiftpressed)
            {
              int pos = gettablelen(PTBL);
              if (pos >= MAX_TABLELEN-1) pos = MAX_TABLELEN - 1;
              pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] = pos + 1;
              gototable(PTBL, pos);
              return;
            }
          }
          break;

          case CMD_SETFILTERPTR:
          if (pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3])
          {
            gototable(FTBL, pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] - 1);
            return;
          }
          else
          {
            if (shiftpressed)
            {
              int pos = gettablelen(FTBL);
              if (pos >= MAX_TABLELEN-1) pos = MAX_TABLELEN - 1;
              pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] = pos + 1;
              gototable(FTBL, pos);
              return;
            }
          }
          break;

          case CMD_FUNKTEMPO:
          if (pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3])
          {
            if (!shiftpressed)
            {
              gototable(STBL, pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] - 1);
              return;
            }
            else
            {
              int pos = makespeedtable(pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3], MST_FUNKTEMPO, 1);
              pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] = pos + 1;
            }
          }
          else
          {
            if (shiftpressed)
            {
              int pos = findfreespeedtable();
              if (pos >= 0)
              {
                pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] = pos + 1;
                gototable(STBL, pos);
                return;
              }
            }
          }
          break;

          case CMD_PORTAUP:
          case CMD_PORTADOWN:
          case CMD_TONEPORTA:
          if (pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3])
          {
            if (!shiftpressed)
            {
              gototable(STBL, pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] - 1);
              return;
            }
            else
            {
              int pos = makespeedtable(pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3], MST_PORTAMENTO, 1);
              pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] = pos + 1;
            }
          }
          else
          {
            if (shiftpressed)
            {
              int pos = findfreespeedtable();
              if (pos >= 0)
              {
                pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] = pos + 1;
                gototable(STBL, pos);
                return;
              }
            }
          }
          break;

          case CMD_VIBRATO:
          if (pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3])
          {
            if (!shiftpressed)
            {
              gototable(STBL, pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] - 1);
              return;
            }
            else
            {
              int pos = makespeedtable(pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3], editorInfo.finevibrato, 1);
              pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] = pos + 1;
            }
          }
          else
          {
            if (shiftpressed)
            {
              int pos = findfreespeedtable();
              if (pos >= 0)
              {
                pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] = pos + 1;
                gototable(STBL, pos);
                return;
              }
            }
          }
          break;
        }
        break;
      }
      if ((autoadvance < 2) && (editorInfo.epcolumn))
      {
        editorInfo.eppos++;
        if (editorInfo.eppos > pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum])
        {
          editorInfo.eppos = 0;
        }
      }
    }

    if (newnote >= 0)
    {
      if ((recordmode) && (editorInfo.eppos < pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]))
      {
        pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4] = newnote;
        if (newnote < REST)
        {
          pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+1] = editorInfo.einum;
        }
        else
        {
          pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+1] = 0;
        }
        if ((shiftpressed) && (newnote == REST))
        {
          pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+2] = 0;
          pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] = 0;
        }
      }
      if (recordmode)
      {
        if (autoadvance < 2)
        {
          editorInfo.eppos++;
          if (editorInfo.eppos > pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum])
          {
            editorInfo.eppos = 0;
          }
        }
      }
      playtestnote(newnote, editorInfo.einum, editorInfo.epchn);
    }
  }
  switch(rawkey)
  {
    case KEY_O:
    if (shiftpressed) shrinkpattern();
    break;

    case KEY_P:
    if (shiftpressed) expandpattern();
    break;

    case KEY_J:
    if (shiftpressed) joinpattern();
    break;

    case KEY_K:
    if (shiftpressed) splitpattern();
    break;

    case KEY_Z:
    if (shiftonlypressed)
    {
      autoadvance++;
      if (autoadvance > 2) autoadvance = 0;
      if (keypreset == KEY_TRACKER)
      {
        if (autoadvance == 1) autoadvance = 2;
      }
    }
    break;

    case KEY_E:
    if (shiftpressed)
    {
      if (editorInfo.epmarkchn != -1)
      {
        if (editorInfo.epmarkstart < editorInfo.epmarkend)
        {
          int d = 0;
          for (c = editorInfo.epmarkstart; c <= editorInfo.epmarkend; c++)
          {
            if (c >= pattlen[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum]) break;
            cmdcopybuffer[d*4+2] = pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4+2];
            cmdcopybuffer[d*4+3] = pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4+3];
            d++;
          }
          cmdcopyrows = d;
        }
        else
        {
          int d = 0;
          for (c = editorInfo.epmarkend; c <= editorInfo.epmarkstart; c++)
          {
            if (c >= pattlen[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum]) break;
            cmdcopybuffer[d*4+2] = pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4+2];
            cmdcopybuffer[d*4+3] = pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4+3];
            d++;
          }
          cmdcopyrows = d;
        }
        editorInfo.epmarkchn = -1;
      }
      else
      {
        if (editorInfo.eppos < pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum])
        {
          cmdcopybuffer[2] = pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+2];
          cmdcopybuffer[3] = pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3];
          cmdcopyrows = 1;
        }
      }
    }
    break;

    case KEY_R:
    if (shiftpressed)
    {
      for (c = 0; c < cmdcopyrows; c++)
      {
        if (editorInfo.eppos >= pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]) break;
        pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+2] = cmdcopybuffer[c*4+2];
        pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] = cmdcopybuffer[c*4+3];
        editorInfo.eppos++;
      }
    }
    break;

    case KEY_I:
    if (shiftpressed)
    {
      int d, e;
      char temp;
      if (editorInfo.epmarkchn != -1)
      {
        if (editorInfo.epmarkstart <= editorInfo.epmarkend)
        {
          e = editorInfo.epmarkend;
          for (c = editorInfo.epmarkstart; c <= editorInfo.epmarkend; c++)
          {
            if (c >= pattlen[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum]) break;
            for (d = 0; d < 4; d++)
            {
              temp = pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4+d];
              pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4+d] = pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][e*4+d];
              pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][e*4+d] = temp;
            }
            e--;
            if (e < c) break;
          }
        }
        else
        {
          e = editorInfo.epmarkstart;
          for (c = editorInfo.epmarkend; c <= editorInfo.epmarkstart; c++)
          {
            if (c >= pattlen[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum]) break;
            for (d = 0; d < 4; d++)
            {
              temp = pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4+d];
              pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4+d] = pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][e*4+d];
              pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][e*4+d] = temp;
            }
            e--;
            if (e < c) break;
          }
        }
      }
      else
      {
        e = pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum] - 1;
        for (c = 0; c < pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]; c++)
        {
          for (d = 0; d < 4; d++)
          {
            temp = pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4+d];
            pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4+d] = pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][e*4+d];
            pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][e*4+d] = temp;
          }
          e--;
          if (e < c) break;
        }
      }
    }
    break;

    case KEY_Q:
    if (shiftpressed)
    {
      if (editorInfo.epmarkchn != -1)
      {
        if (editorInfo.epmarkstart <= editorInfo.epmarkend)
        {
          for (c = editorInfo.epmarkstart; c <= editorInfo.epmarkend; c++)
          {
            if (c >= pattlen[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum]) break;
            if ((pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] < LASTNOTE) &&
                (pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] >= FIRSTNOTE))
              pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4]++;
          }
        }
        else
        {
          for (c = editorInfo.epmarkend; c <= editorInfo.epmarkstart; c++)
          {
            if (c >= pattlen[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum]) break;
            if ((pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] < LASTNOTE) &&
                (pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] >= FIRSTNOTE))
              pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4]++;
          }
        }
      }
      else
      {
        for (c = 0; c < pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]; c++)
        {
          if ((pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4] < LASTNOTE) &&
              (pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4] >= FIRSTNOTE))
            pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4]++;
        }
      }
    }
    break;

    case KEY_A:
    if (shiftpressed)
    {
      if (editorInfo.epmarkchn != -1)
      {
        if (editorInfo.epmarkstart <= editorInfo.epmarkend)
        {
          for (c = editorInfo.epmarkstart; c <= editorInfo.epmarkend; c++)
          {
            if (c >= pattlen[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum]) break;
            if ((pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] <= LASTNOTE) &&
                (pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] > FIRSTNOTE))
              pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4]--;
          }
        }
        else
        {
          for (c = editorInfo.epmarkend; c <= editorInfo.epmarkstart; c++)
          {
            if (c >= pattlen[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum]) break;
            if ((pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] <= LASTNOTE) &&
                (pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] > FIRSTNOTE))
              pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4]--;
          }
        }
      }
      else
      {
        for (c = 0; c < pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]; c++)
        {
          if ((pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4] <= LASTNOTE) &&
              (pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4] > FIRSTNOTE))
            pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4]--;
        }
      }
    }
    break;

    case KEY_W:
    if (shiftpressed)
    {
      if (editorInfo.epmarkchn != -1)
      {
        if (editorInfo.epmarkstart <= editorInfo.epmarkend)
        {
          for (c = editorInfo.epmarkstart; c <= editorInfo.epmarkend; c++)
          {
            if (c >= pattlen[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum]) break;
            if ((pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] <= LASTNOTE) &&
                (pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] >= FIRSTNOTE))
            {
              pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] += 12;
              if (pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] > LASTNOTE)
                pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] = LASTNOTE;
            }
          }
        }
        else
        {
          for (c = editorInfo.epmarkend; c <= editorInfo.epmarkstart; c++)
          {
            if (c >= pattlen[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum]) break;
            if ((pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] <= LASTNOTE) &&
                (pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] >= FIRSTNOTE))
            {
              pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] += 12;
              if (pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] > LASTNOTE)
                pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] = LASTNOTE;
            }
          }
        }
      }
      else
      {
        for (c = 0; c < pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]; c++)
        {
          if ((pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4] <= LASTNOTE) &&
              (pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4] >= FIRSTNOTE))
          {
            pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4] += 12;
            if (pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4] > LASTNOTE)
              pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4] = LASTNOTE;
          }
        }
      }
    }
    break;

    case KEY_S:
    if (shiftpressed)
    {
      if (editorInfo.epmarkchn != -1)
      {
        if (editorInfo.epmarkstart <= editorInfo.epmarkend)
        {
          for (c = editorInfo.epmarkstart; c <= editorInfo.epmarkend; c++)
          {
            if (c >= pattlen[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum]) break;
            if ((pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] <= LASTNOTE) &&
                (pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] >= FIRSTNOTE))
            {
              pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] -= 12;
              if (pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] < FIRSTNOTE)
                pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] = FIRSTNOTE;
            }
          }
        }
        else
        {
          for (c = editorInfo.epmarkend; c <= editorInfo.epmarkstart; c++)
          {
            if (c >= pattlen[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum]) break;
            if ((pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] <= LASTNOTE) &&
                (pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] >= FIRSTNOTE))
            {
              pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] -= 12;
              if (pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] < FIRSTNOTE)
                pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] = FIRSTNOTE;
            }
          }
        }
      }
      else
      {
        for (c = 0; c < pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]; c++)
        {
          if ((pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4] <= LASTNOTE) &&
              (pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4] >= FIRSTNOTE))
          {
            pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4] -= 12;
            if (pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4] < FIRSTNOTE)
              pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4] = FIRSTNOTE;
          }
        }
      }
    }
    break;

    case KEY_M:
    if (shiftpressed)
    {
      stepsize++;
      if (stepsize > MAX_PATTROWS) stepsize = MAX_PATTROWS;
    }
    break;

    case KEY_N:
    if (shiftpressed)
    {
      stepsize--;
      if (stepsize < 2) stepsize = 2;
    }
    break;

    case KEY_H:
    if (shiftpressed)
    {
      switch (pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+2])
      {
        case CMD_PORTAUP:
        case CMD_PORTADOWN:
        case CMD_VIBRATO:
        case CMD_TONEPORTA:
        if (pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+2] == CMD_TONEPORTA)
          c = editorInfo.eppos-1;
        else
          c = editorInfo.eppos;
        for (; c >= 0; c--)
        {
          if ((pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4] >= FIRSTNOTE) &&
              (pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4] <= LASTNOTE))
          {
            int delta;
            int pitch1;
            int pitch2;
            int pos;
            int note = pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4] - FIRSTNOTE;
            int right = pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] & 0xf;
            int left = pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] >> 4;

            if (note > MAX_NOTES-1) note--;
            pitch1 = freqtbllo[note] | (freqtblhi[note] << 8);
            pitch2 = freqtbllo[note+1] | (freqtblhi[note+1] << 8);
            delta = pitch2 - pitch1;

            while (left--) delta <<= 1;
            while (right--) delta >>= 1;

            if (pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+2] == CMD_VIBRATO)
            {
              if (delta > 0xff) delta = 0xff;
            }
            pos = makespeedtable(delta, MST_RAW, 1);
            pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] = pos + 1;
            break;
          }
        }
        break;
      }
    }
    break;

    case KEY_L:
    if (shiftpressed)
    {
      if (editorInfo.epmarkchn == -1)
      {
        editorInfo.epmarkchn = editorInfo.epchn;
        editorInfo.epmarkstart = 0;
        editorInfo.epmarkend = pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]-1;
      }
      else editorInfo.epmarkchn = -1;
    }
    break;

    case KEY_C:
    case KEY_X:
    if (shiftpressed)
    {
      if (editorInfo.epmarkchn != -1)
      {
        if (editorInfo.epmarkstart <= editorInfo.epmarkend)
        {
          int d = 0;
          for (c = editorInfo.epmarkstart; c <= editorInfo.epmarkend; c++)
          {
            if (c >= pattlen[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum]) break;
            patterncopybuffer[d*4] = pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4];
            patterncopybuffer[d*4+1] = pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4+1];
            patterncopybuffer[d*4+2] = pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4+2];
            patterncopybuffer[d*4+3] = pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4+3];
            if (rawkey == KEY_X)
            {
              pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] = REST;
              pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4+1] = 0;
              pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4+2] = 0;
              pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4+3] = 0;
            }
            d++;
          }
          patterncopyrows = d;
        }
        else
        {
          int d = 0;
          for (c = editorInfo.epmarkend; c <= editorInfo.epmarkstart; c++)
          {
            if (c >= pattlen[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum]) break;
            patterncopybuffer[d*4] = pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4];
            patterncopybuffer[d*4+1] = pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4+1];
            patterncopybuffer[d*4+2] = pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4+2];
            patterncopybuffer[d*4+3] = pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4+3];
            if (rawkey == KEY_X)
            {
              pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4] = REST;
              pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4+1] = 0;
              pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4+2] = 0;
              pattern[editorUndoInfo.editorInfo[editorInfo.epmarkchn].epnum][c*4+3] = 0;
            }
            d++;
          }
          patterncopyrows = d;
        }
        editorInfo.epmarkchn = -1;
      }
      else
      {
        int d = 0;
        for (c = 0; c < pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]; c++)
        {
          patterncopybuffer[d*4] = pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4];
          patterncopybuffer[d*4+1] = pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4+1];
          patterncopybuffer[d*4+2] = pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4+2];
          patterncopybuffer[d*4+3] = pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4+3];
          if (rawkey == KEY_X)
          {
            pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4] = REST;
            pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4+1] = 0;
            pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4+2] = 0;
            pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][c*4+3] = 0;
          }
          d++;
        }
        patterncopyrows = d;
      }
    }
    break;

    case KEY_V:
    if ((shiftpressed) && (patterncopyrows))
    {
      for (c = 0; c < patterncopyrows; c++)
      {
        if (editorInfo.eppos >= pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]) break;
        pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4] = patterncopybuffer[c*4];
        pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+1] = patterncopybuffer[c*4+1];
        pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+2] = patterncopybuffer[c*4+2];
        pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] = patterncopybuffer[c*4+3];
        editorInfo.eppos++;
      }
    }
    break;

    case KEY_DEL:
    if (editorInfo.epmarkchn == editorInfo.epchn) editorInfo.epmarkchn = -1;
    if ((pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]-editorInfo.eppos)*4-4 >= 0)
    {
      memmove(&pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4],
        &pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+4],
        (pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]-editorInfo.eppos)*4-4);
      pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]*4-4] = REST;
      pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]*4-3] = 0x00;
      pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]*4-2] = 0x00;
      pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]*4-1] = 0x00;
    }
    else
    {
      if (editorInfo.eppos == pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum])
      {
        if (pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum] > 1)
        {
          pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]*4-4] = ENDPATT;
          pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]*4-3] = 0x00;
          pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]*4-2] = 0x00;
          pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]*4-1] = 0x00;
          countthispattern();
          editorInfo.eppos = pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum];
        }
      }
    }
    break;

    case KEY_INS:
    if (editorInfo.epmarkchn == editorInfo.epchn) editorInfo.epmarkchn = -1;
    if ((pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]-editorInfo.eppos)*4-4 >= 0)
    {
      memmove(&pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+4],
        &pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4],
        (pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]-editorInfo.eppos)*4-4);
      pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4] = REST;
      pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+1] = 0x00;
      pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+2] = 0x00;
      pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] = 0x00;
    }
    else
    {
      if (editorInfo.eppos == pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum])
      {
        if (pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum] < MAX_PATTROWS)
        {
          pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4] = REST;
          pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+1] = 0x00;
          pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+2] = 0x00;
          pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] = 0x00;
          pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+4] = ENDPATT;
          pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+5] = 0x00;
          pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+6] = 0x00;
          pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+7] = 0x00;
          countthispattern();
          editorInfo.eppos = pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum];
        }
      }
    }
    break;

    case KEY_SPACE:
    if (!shiftpressed)
      recordmode ^= 1;
    else
    {
      if (lastsonginit != PLAY_PATTERN)
      {
        if (editorInfo.eseditpos != editorUndoInfo.editorInfo[editorInfo.eschn].espos)
        {
          int c;

          for (c = 0; c < MAX_CHN; c++)
          {
            if (editorInfo.eseditpos < songlen[editorInfo.esnum][c]) editorUndoInfo.editorInfo[c].espos = editorInfo.eseditpos;
            if (editorUndoInfo.editorInfo[c].esend <= editorUndoInfo.editorInfo[c].espos) editorUndoInfo.editorInfo[c].esend = 0;
          }
        }
        initsongpos(editorInfo.esnum, PLAY_POS, editorInfo.eppos);
      }
      else initsongpos(editorInfo.esnum, PLAY_PATTERN, editorInfo.eppos);
      followplay = 0;
    }
    break;

    case KEY_RIGHT:
    if (!shiftpressed)
    {
      editorInfo.epcolumn++;
      if (editorInfo.epcolumn >= 6)
      {
        editorInfo.epcolumn = 0;
        editorInfo.epchn++;
        if (editorInfo.epchn >= MAX_CHN) editorInfo.epchn = 0;
        if (editorInfo.eppos > pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]) editorInfo.eppos = pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum];
      }
    }
    else
    {
      if (editorUndoInfo.editorInfo[editorInfo.epchn].epnum < MAX_PATT-1)
      {
        editorUndoInfo.editorInfo[editorInfo.epchn].epnum++;
        if (editorInfo.eppos > pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]) editorInfo.eppos = pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum];
      }
      if (editorInfo.epchn == editorInfo.epmarkchn) editorInfo.epmarkchn = -1;
    }
    break;

    case KEY_LEFT:
    if (!shiftpressed)
    {
      editorInfo.epcolumn--;
      if (editorInfo.epcolumn < 0)
      {
        editorInfo.epcolumn = 5;
        editorInfo.epchn--;
        if (editorInfo.epchn < 0) editorInfo.epchn = MAX_CHN-1;
        if (editorInfo.eppos > pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]) editorInfo.eppos = pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum];
      }
    }
    else
    {
      if (editorUndoInfo.editorInfo[editorInfo.epchn].epnum > 0)
      {
        editorUndoInfo.editorInfo[editorInfo.epchn].epnum--;
        if (editorInfo.eppos > pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]) editorInfo.eppos = pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum];
      }
      if (editorInfo.epchn == editorInfo.epmarkchn) editorInfo.epmarkchn = -1;
    }
    break;

    case KEY_HOME:
    while (editorInfo.eppos != 0) patternup();
    break;

    case KEY_END:
    while (editorInfo.eppos != pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]) patterndown();
    break;

    case KEY_PGUP:
    for (scrrep = PGUPDNREPEAT; scrrep; scrrep--)
      patternup();
    break;

    case KEY_PGDN:
    for (scrrep = PGUPDNREPEAT; scrrep; scrrep--)
      patterndown();
    break;

    case KEY_UP:
    patternup();
    break;

    case KEY_DOWN:
    patterndown();
    break;

    case KEY_APOST2:
    if (!shiftpressed)
    {
      editorInfo.epchn++;
      if (editorInfo.epchn >= MAX_CHN) editorInfo.epchn = 0;
      if (editorInfo.eppos > pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]) editorInfo.eppos = pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum];
    }
    else
    {
      editorInfo.epchn--;
      if (editorInfo.epchn < 0) editorInfo.epchn = MAX_CHN-1;
      if (editorInfo.eppos > pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]) editorInfo.eppos = pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum];
    }
    break;
    
    case KEY_1:
    case KEY_2:
    case KEY_3:
    if (shiftpressed)
      mutechannel(rawkey - KEY_1);
    break;
  }
  if ((keypreset == KEY_DMC) && (hexnybble >= 0) && (hexnybble <= 7) && (!editorInfo.epcolumn))
  {
    int oldbyte = pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4];
    editorInfo.epoctave = hexnybble;
    if ((oldbyte >= FIRSTNOTE) && (oldbyte <= LASTNOTE))
    {
      int newbyte;
      int oldnote = (oldbyte - FIRSTNOTE) %12;

      if (recordmode)
      {
        newbyte = oldnote+editorInfo.epoctave*12 + FIRSTNOTE;
        if (newbyte <= LASTNOTE)
        {
          pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4] = newbyte;
        }
      }
      if ((recordmode) && (autoadvance < 1))
      {
        editorInfo.eppos++;
        if (editorInfo.eppos > pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum])
        {
          editorInfo.eppos = 0;
        }
      }
    }
  }

  if ((hexnybble >= 0) && (editorInfo.epcolumn) && (recordmode))
  {
    if (editorInfo.eppos < pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum])
    {
      switch(editorInfo.epcolumn)
      {
        case 1:
        pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+1] &= 0x0f;
        pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+1] |= hexnybble << 4;
        pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+1] &= (MAX_INSTR - 1);
        break;

        case 2:
        pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+1] &= 0xf0;
        pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+1] |= hexnybble;
        pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+1] &= (MAX_INSTR - 1);
        break;

        case 3:
        pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+2] = hexnybble;
        if (!pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+2])
          pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] = 0;
        break;

        case 4:
        pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] &= 0x0f;
        pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] |= hexnybble << 4;
        if (!pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+2])
          pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] = 0;
        break;

        case 5:
        pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] &= 0xf0;
        pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] |= hexnybble;
        if (!pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+2])
          pattern[editorUndoInfo.editorInfo[editorInfo.epchn].epnum][editorInfo.eppos*4+3] = 0;
        break;
      }
    }
    if (autoadvance < 2)
    {
      editorInfo.eppos++;
      if (editorInfo.eppos > pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum])
      {
        editorInfo.eppos = 0;
      }
    }
  }
  editorInfo.epview = editorInfo.eppos-VISIBLEPATTROWS/2;
}


void patterndown(void)
{
  if (shiftpressed)
  {
    if ((editorInfo.epmarkchn != editorInfo.epchn) || (editorInfo.eppos != editorInfo.epmarkend))
    {
      editorInfo.epmarkchn = editorInfo.epchn;
      editorInfo.epmarkstart = editorInfo.epmarkend = editorInfo.eppos;
    }
  }
  editorInfo.eppos++;
  if (editorInfo.eppos > pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum])
  {
    editorInfo.eppos = 0;
  }
  if (shiftpressed) editorInfo.epmarkend = editorInfo.eppos;
}

void patternup(void)
{
  if (shiftpressed)
  {
    if ((editorInfo.epmarkchn != editorInfo.epchn) || (editorInfo.eppos != editorInfo.epmarkend))
    {
      editorInfo.epmarkchn = editorInfo.epchn;
      editorInfo.epmarkstart = editorInfo.epmarkend = editorInfo.eppos;
    }
  }
  editorInfo.eppos--;
  if (editorInfo.eppos < 0)
  {
    editorInfo.eppos = pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum];
  }
  if (shiftpressed) editorInfo.epmarkend = editorInfo.eppos;
}

void prevpattern(void)
{
  if (editorUndoInfo.editorInfo[editorInfo.epchn].epnum > 0)
  {
    editorUndoInfo.editorInfo[editorInfo.epchn].epnum--;
    if (editorInfo.eppos > pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]) editorInfo.eppos = pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum];
  }
  if (editorInfo.epchn == editorInfo.epmarkchn) editorInfo.epmarkchn = -1;
}

void nextpattern(void)
{
  if (editorUndoInfo.editorInfo[editorInfo.epchn].epnum < MAX_PATT-1)
  {
    editorUndoInfo.editorInfo[editorInfo.epchn].epnum++;
    if (editorInfo.eppos > pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum]) editorInfo.eppos = pattlen[editorUndoInfo.editorInfo[editorInfo.epchn].epnum];
  }
  if (editorInfo.epchn == editorInfo.epmarkchn) editorInfo.epmarkchn = -1;
}

void shrinkpattern(void)
{
  int c = editorUndoInfo.editorInfo[editorInfo.epchn].epnum;
  int l = pattlen[c];
  int nl = l/2;
  int d;

  if (pattlen[c] < 2) return;

  stopsong();

  for (d = 0; d < nl; d++)
  {
    pattern[c][d*4] = pattern[c][d*2*4];
    pattern[c][d*4+1] = pattern[c][d*2*4+1];
    pattern[c][d*4+2] = pattern[c][d*2*4+2];
    pattern[c][d*4+3] = pattern[c][d*2*4+3];
  }

  pattern[c][nl*4] = ENDPATT;
  pattern[c][nl*4+1] = 0;
  pattern[c][nl*4+2] = 0;
  pattern[c][nl*4+3] = 0;

  editorInfo.eppos /= 2;

  countthispattern();
}

void expandpattern(void)
{
  int c = editorUndoInfo.editorInfo[editorInfo.epchn].epnum;
  int l = pattlen[c];
  int nl = l*2;
  int d;
  unsigned char temp[MAX_PATTROWS*4+4];

  if (nl > MAX_PATTROWS) return;
  memset(temp, 0, sizeof temp);

  stopsong();

  for (d = 0; d <= nl; d++)
  {
    if (d & 1)
    {
      temp[d*4] = REST;
      temp[d*4+1] = 0;
      temp[d*4+2] = 0;
      temp[d*4+3] = 0;
    }
    else
    {
      temp[d*4] = pattern[c][d*2];
      temp[d*4+1] = pattern[c][d*2+1];
      temp[d*4+2] = pattern[c][d*2+2];
      temp[d*4+3] = pattern[c][d*2+3];
    }
  }

  memcpy(pattern[c], temp, (nl+1)*4);

  editorInfo.eppos *= 2;

  countthispattern();
}

void splitpattern(void)
{
  int c = editorUndoInfo.editorInfo[editorInfo.epchn].epnum;
  int l = pattlen[c];
  int d;

  if (editorInfo.eppos == 0) return;
  if (editorInfo.eppos == l) return;
  
  stopsong();

  updateUndoBuffer(UNDO_AREA_CHANNEL_EDITOR_INFO);
  undoAreaSetCheckForChange(UNDO_AREA_CHANNEL_EDITOR_INFO, 0, UNDO_AREA_DIRTY_CHECK);

  if (insertpattern(c))
  {
    int oldesnum = editorInfo.esnum;
    int oldeschn = editorInfo.eschn;
    int oldeseditpos = editorInfo.eseditpos;

    for (d = editorInfo.eppos; d <= l; d++)
    {
      pattern[c+1][(d-editorInfo.eppos)*4] = pattern[c][d*4];
      pattern[c+1][(d-editorInfo.eppos)*4+1] = pattern[c][d*4+1];
      pattern[c+1][(d-editorInfo.eppos)*4+2] = pattern[c][d*4+2];
      pattern[c+1][(d-editorInfo.eppos)*4+3] = pattern[c][d*4+3];
    }
    pattern[c][editorInfo.eppos*4] = ENDPATT;
    pattern[c][editorInfo.eppos*4+1] = 0;
    pattern[c][editorInfo.eppos*4+2] = 0;
    pattern[c][editorInfo.eppos*4+3] = 0;

    countpatternlengths();

    for (editorInfo.esnum = 0; editorInfo.esnum < MAX_SONGS; editorInfo.esnum++)
    {
      for (editorInfo.eschn = 0; editorInfo.eschn < MAX_CHN; editorInfo.eschn++)
      {
        for (editorInfo.eseditpos = 0; editorInfo.eseditpos < songlen[editorInfo.esnum][editorInfo.eschn]; editorInfo.eseditpos++)
        {
          if (songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos] == c)
          {
            songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos] = c+1;
            insertorder(c);
          }
        }
      }
    }
    editorInfo.eschn = oldeschn;
    editorInfo.eseditpos = oldeseditpos;
    editorInfo.esnum = oldesnum;
  }
}

void joinpattern(void)
{
  int c = editorUndoInfo.editorInfo[editorInfo.epchn].epnum;
  int d;

  if (editorInfo.eschn != editorInfo.epchn) return;
  if (songorder[editorInfo.esnum][editorInfo.epchn][editorInfo.eseditpos] != c) return;
  d = songorder[editorInfo.esnum][editorInfo.epchn][editorInfo.eseditpos + 1];
  if (d >= MAX_PATT) return;
  if (pattlen[c] + pattlen[d] > MAX_PATTROWS) return;

  stopsong();

  updateUndoBuffer(UNDO_AREA_CHANNEL_EDITOR_INFO);
  undoAreaSetCheckForChange(UNDO_AREA_CHANNEL_EDITOR_INFO, 0, UNDO_AREA_DIRTY_CHECK);

  if (insertpattern(c))
  {
    int oldesnum = editorInfo.esnum;
    int oldeschn = editorInfo.eschn;
    int oldeseditpos = editorInfo.eseditpos;
    int e, f;
    d++;

    for (e = 0; e < pattlen[c]; e++)
    {
      pattern[c+1][e*4] = pattern[c][e*4];
      pattern[c+1][e*4+1] = pattern[c][e*4+1];
      pattern[c+1][e*4+2] = pattern[c][e*4+2];
      pattern[c+1][e*4+3] = pattern[c][e*4+3];
    }
    for (f = 0; f < pattlen[d]; f++)
    {
      pattern[c+1][e*4] = pattern[d][f*4];
      pattern[c+1][e*4+1] = pattern[d][f*4+1];
       pattern[c+1][e*4+2] = pattern[d][f*4+2];
       pattern[c+1][e*4+3] = pattern[d][f*4+3];
       e++;
    }
    pattern[c+1][e*4] = ENDPATT;
    pattern[c+1][e*4+1] = 0;
    pattern[c+1][e*4+2] = 0;
    pattern[c+1][e*4+3] = 0;

    countpatternlengths();

    for (editorInfo.esnum = 0; editorInfo.esnum < MAX_SONGS; editorInfo.esnum++)
    {
      for (editorInfo.eschn = 0; editorInfo.eschn < MAX_CHN; editorInfo.eschn++)
      {
        for (editorInfo.eseditpos = 0; editorInfo.eseditpos < songlen[editorInfo.esnum][editorInfo.eschn]; editorInfo.eseditpos++)
        {
          if ((songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos] == c) && (songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos+1] == d))
          {
            deleteorder();
            songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos] = c+1;
          }
        }
      }
    }
    editorInfo.eschn = oldeschn;
    editorInfo.eseditpos = oldeseditpos;
    editorInfo.esnum = oldesnum;

    findusedpatterns();
    {
      int del1 = pattused[c];
      int del2 = pattused[d];

      if (!del1)
      {
        deletepattern(c);
        if (d > c) d--;
      }
      if (!del2) 
        deletepattern(d);
    }
  }
}


