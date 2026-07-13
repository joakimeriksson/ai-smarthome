//
// GOATTRACKER v2 orderlist & songname editor
//

#define GORDER_C

#include "goattrk2.h"

unsigned char trackcopybuffer[MAX_SONGLEN+2];
int trackcopyrows = 0;
int trackcopywhole;
int trackcopyrpos;

//int espos[MAX_CHN];
//int esend[MAX_CHN];
//int editorInfo.eseditpos;
//int editorInfo.esview;
//int editorInfo.escolumn;
//int editorInfo.eschn;
//int editorInfo.esnum;
//int editorInfo.esmarkchn = -1;
//int editorInfo.esmarkstart;
//int editorInfo.esmarkend;
//int editorInfo.enpos;

void orderlistcommands(void);
void namecommands(void);

void orderlistcommands(void)
{
  int c, scrrep;

  if (hexnybble >= 0)
  {
    if (editorInfo.eseditpos != songlen[editorInfo.esnum][editorInfo.eschn])
    {
      switch(editorInfo.escolumn)
      {
        case 0:
        songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos] &= 0x0f;
        songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos] |= hexnybble << 4;
        if (editorInfo.eseditpos < songlen[editorInfo.esnum][editorInfo.eschn])
        {
          if (songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos] >= MAX_PATT)
            songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos] = MAX_PATT - 1;
        }
        else
        {
          if (songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos] >= MAX_SONGLEN)
            songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos] = MAX_SONGLEN - 1;
        }
        break;

        case 1:
        songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos] &= 0xf0;
        if ((songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos] & 0xf0) == 0xd0)
        {
          hexnybble--;
          if (hexnybble < 0) hexnybble = 0xf;
        }
        if ((songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos] & 0xf0) == 0xe0)
        {
          hexnybble = 16 - hexnybble;
          hexnybble &= 0xf;
        }
        songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos] |= hexnybble;

        if (editorInfo.eseditpos < songlen[editorInfo.esnum][editorInfo.eschn])
        {
          if (songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos] == LOOPSONG)
            songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos] = LOOPSONG-1;
          if (songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos] == TRANSDOWN)
            songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos] = TRANSDOWN+0x0f;
        }
        else
        {
          if (songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos] >= MAX_SONGLEN)
            songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos] = MAX_SONGLEN - 1;
        }
        break;
      }
      editorInfo.escolumn++;
      if (editorInfo.escolumn > 1)
      {
        editorInfo.escolumn = 0;
        if (editorInfo.eseditpos < (songlen[editorInfo.esnum][editorInfo.eschn]+1))
        {
          editorInfo.eseditpos++;
          if (editorInfo.eseditpos == songlen[editorInfo.esnum][editorInfo.eschn]) editorInfo.eseditpos++;
        }
      }
    }
  }

  switch(key)
  {
    case 'R':
    if (editorInfo.eseditpos < songlen[editorInfo.esnum][editorInfo.eschn])
    {
      songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos] = REPEAT + 0x01;
      editorInfo.escolumn = 1;
    }
    break;

    case '+':
    if (editorInfo.eseditpos < songlen[editorInfo.esnum][editorInfo.eschn])
    {
      songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos] = TRANSUP;
      editorInfo.escolumn = 1;
    }
    break;

    case '-':
    if (editorInfo.eseditpos < songlen[editorInfo.esnum][editorInfo.eschn])
    {
      songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos] = TRANSDOWN + 0x0F;
      editorInfo.escolumn = 1;
    }
    break;

    case '>':
    case ')':
    case ']':
    nextsong();
    break;

    case '<':
    case '(':
    case '[':
    prevsong();
    break;
  }
  switch(rawkey)
  {
    case KEY_1:
    case KEY_2:
    case KEY_3:
    if (shiftpressed)
    {
      int schn = editorInfo.eschn;
      int tchn = 0;

      editorInfo.esmarkchn = -1;
      if (rawkey == KEY_1) tchn = 0;
      if (rawkey == KEY_2) tchn = 1;
      if (rawkey == KEY_3) tchn = 2;
      if (schn != tchn)
      {
        int lentemp = songlen[editorInfo.esnum][schn];
        songlen[editorInfo.esnum][schn] = songlen[editorInfo.esnum][tchn];
        songlen[editorInfo.esnum][tchn] = lentemp;

        for (c = 0; c < MAX_SONGLEN+2; c++)
        {
          unsigned char temp = songorder[editorInfo.esnum][schn][c];
          songorder[editorInfo.esnum][schn][c] = songorder[editorInfo.esnum][tchn][c];
          songorder[editorInfo.esnum][tchn][c] = temp;
        }
      }
    }
    break;

    case KEY_X:
    if (shiftpressed)
    {
      if (editorInfo.esmarkchn != -1)
      {
        int d = 0;

        editorInfo.eschn = editorInfo.esmarkchn;
        if (editorInfo.esmarkstart <= editorInfo.esmarkend)
        {
          editorInfo.eseditpos = editorInfo.esmarkstart;
          for (c = editorInfo.esmarkstart; c <= editorInfo.esmarkend; c++)
            trackcopybuffer[d++] = songorder[editorInfo.esnum][editorInfo.eschn][c];
          trackcopyrows = d;
        }
        else
        {
          editorInfo.eseditpos = editorInfo.esmarkend;
          for (c = editorInfo.esmarkend; c <= editorInfo.esmarkstart; c++)
            trackcopybuffer[d++] = songorder[editorInfo.esnum][editorInfo.eschn][c];
          trackcopyrows = d;
        }
        if (trackcopyrows == songlen[editorInfo.esnum][editorInfo.eschn])
        {
          trackcopywhole = 1;
          trackcopyrpos = songorder[editorInfo.esnum][editorInfo.eschn][songlen[editorInfo.esnum][editorInfo.eschn]+1];
        }
        else trackcopywhole = 0;
        for (c = 0; c < trackcopyrows; c++) deleteorder();
        editorInfo.esmarkchn = -1;
      }
    }
    break;

    case KEY_C:
    if (shiftpressed)
    {
      if (editorInfo.esmarkchn != -1)
      {
        int d = 0;
        if (editorInfo.esmarkstart <= editorInfo.esmarkend)
        {
          for (c = editorInfo.esmarkstart; c <= editorInfo.esmarkend; c++)
            trackcopybuffer[d++] = songorder[editorInfo.esnum][editorInfo.eschn][c];
          trackcopyrows = d;
        }
        else
        {
          for (c = editorInfo.esmarkend; c <= editorInfo.esmarkstart; c++)
            trackcopybuffer[d++] = songorder[editorInfo.esnum][editorInfo.eschn][c];
          trackcopyrows = d;
        }
        if (trackcopyrows == songlen[editorInfo.esnum][editorInfo.eschn])
        {
          trackcopywhole = 1;
          trackcopyrpos = songorder[editorInfo.esnum][editorInfo.eschn][songlen[editorInfo.esnum][editorInfo.eschn]+1];
        }
        else trackcopywhole = 0;
        editorInfo.esmarkchn = -1;
      }
    }
    break;

    case KEY_V:
    if (shiftpressed)
    {
      int oldlen = songlen[editorInfo.esnum][editorInfo.eschn];
      
      if (editorInfo.eseditpos < songlen[editorInfo.esnum][editorInfo.eschn])
      {
        for (c = trackcopyrows-1; c >= 0; c--)
          insertorder(trackcopybuffer[c]);
      }
      else
      {
        for (c = 0; c < trackcopyrows; c++)
          insertorder(trackcopybuffer[c]);
      }
      if ((trackcopywhole) && (!oldlen))
        songorder[editorInfo.esnum][editorInfo.eschn][songlen[editorInfo.esnum][editorInfo.eschn]+1] = trackcopyrpos;
    }
    break;

    case KEY_L:
    if (shiftpressed)
    {
      if (editorInfo.esmarkchn == -1)
      {
        editorInfo.esmarkchn = editorInfo.eschn;
        editorInfo.esmarkstart = 0;
        editorInfo.esmarkend = songlen[editorInfo.esnum][editorInfo.eschn]-1;
      }
      else editorInfo.esmarkchn = -1;
    }
    break;


    case KEY_SPACE:
    if (!shiftpressed)
    {
      if (editorInfo.eseditpos < songlen[editorInfo.esnum][editorInfo.eschn]) editorUndoInfo.editorInfo[editorInfo.eschn].espos = editorInfo.eseditpos;
      if (editorUndoInfo.editorInfo[editorInfo.eschn].esend < editorUndoInfo.editorInfo[editorInfo.eschn].espos)
		  editorUndoInfo.editorInfo[editorInfo.eschn].esend = 0;
    }
    else
    {
      for (c = 0; c < MAX_CHN; c++)
      {
        if (editorInfo.eseditpos < songlen[editorInfo.esnum][c]) editorUndoInfo.editorInfo[c].espos = editorInfo.eseditpos;
        if (editorUndoInfo.editorInfo[c].esend < editorUndoInfo.editorInfo[c].espos)
			editorUndoInfo.editorInfo[c].esend = 0;
      }
    }
    break;

    case KEY_BACKSPACE:
    if (!shiftpressed)
    {
      if ((editorUndoInfo.editorInfo[editorInfo.eschn].esend != editorInfo.eseditpos) && (editorInfo.eseditpos > editorUndoInfo.editorInfo[editorInfo.eschn].espos))
      {
        if (editorInfo.eseditpos < songlen[editorInfo.esnum][editorInfo.eschn]) editorUndoInfo.editorInfo[editorInfo.eschn].esend = editorInfo.eseditpos;
      }
      else editorUndoInfo.editorInfo[editorInfo.eschn].esend = 0;
    }
    else
    {
      if ((editorUndoInfo.editorInfo[editorInfo.eschn].esend != editorInfo.eseditpos) && (editorInfo.eseditpos > editorUndoInfo.editorInfo[editorInfo.eschn].espos))
      {
        for (c = 0; c < MAX_CHN; c++)
        {
          if (editorInfo.eseditpos < songlen[editorInfo.esnum][c]) editorUndoInfo.editorInfo[c].esend = editorInfo.eseditpos;
        }
      }
      else
      {
        for (c = 0; c < MAX_CHN; c++) editorUndoInfo.editorInfo[c].esend = 0;
      }
    }
    break;

    case KEY_ENTER:
    if (editorInfo.eseditpos < songlen[editorInfo.esnum][editorInfo.eschn])
    {
      if (!shiftpressed)
      {
        if (songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos] < MAX_PATT)
			editorUndoInfo.editorInfo[editorInfo.eschn].epnum = songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos];
      }
      else
      {
        int c, d;

        for (c = 0; c < MAX_CHN; c++)
        {
          int start;

          if (editorInfo.eseditpos != editorUndoInfo.editorInfo[editorInfo.eschn].espos) start = editorInfo.eseditpos;
          else start = editorUndoInfo.editorInfo[c].espos;

          for (d = start; d < songlen[editorInfo.esnum][c]; d++)
          {
            if (songorder[editorInfo.esnum][c][d] < MAX_PATT)
            {
				editorUndoInfo.editorInfo[c].epnum = songorder[editorInfo.esnum][c][d];
              break;
            }
          }
        }
      }
      editorInfo.epmarkchn = -1;
    }
    editorInfo.epchn = editorInfo.eschn;
    editorInfo.epcolumn = 0;
    editorInfo.eppos = 0;
    editorInfo.epview = - VISIBLEPATTROWS/2;
    editorInfo.editmode = EDIT_PATTERN;
    if (editorInfo.epchn == editorInfo.epmarkchn) editorInfo.epmarkchn = -1;
    break;

    case KEY_DEL:
    editorInfo.esmarkchn = -1;
    deleteorder();
    break;

    case KEY_INS:
    editorInfo.esmarkchn = -1;
    insertorder(0);
    break;

    case KEY_HOME:
    if (songlen[editorInfo.esnum][editorInfo.eschn])
    {
      while ((editorInfo.eseditpos != 0) || (editorInfo.escolumn != 0)) orderleft();
    }
    break;

    case KEY_END:
    while (editorInfo.eseditpos != songlen[editorInfo.esnum][editorInfo.eschn]+1) orderright();
    break;

    case KEY_PGUP:
    for (scrrep = PGUPDNREPEAT * 2; scrrep; scrrep--)
      orderleft();
    break;

    case KEY_PGDN:
    for (scrrep = PGUPDNREPEAT * 2; scrrep; scrrep--)
      orderright();
    break;

    case KEY_LEFT:
    orderleft();
    break;

    case KEY_RIGHT:
    orderright();
    break;

    case KEY_UP:
    editorInfo.eschn--;
    if (editorInfo.eschn < 0) editorInfo.eschn = MAX_CHN - 1;
    if ((editorInfo.eseditpos == songlen[editorInfo.esnum][editorInfo.eschn]) || (editorInfo.eseditpos > songlen[editorInfo.esnum][editorInfo.eschn]+1))
    {
      editorInfo.eseditpos = songlen[editorInfo.esnum][editorInfo.eschn]+1;
      editorInfo.escolumn = 0;
    }
    if (shiftpressed) editorInfo.esmarkchn = -1;
    break;

    case KEY_DOWN:
    editorInfo.eschn++;
    if (editorInfo.eschn >= MAX_CHN) editorInfo.eschn = 0;
    if ((editorInfo.eseditpos == songlen[editorInfo.esnum][editorInfo.eschn]) || (editorInfo.eseditpos > songlen[editorInfo.esnum][editorInfo.eschn]+1))
    {
      editorInfo.eseditpos = songlen[editorInfo.esnum][editorInfo.eschn]+1;
      editorInfo.escolumn = 0;
    }
    if (shiftpressed) editorInfo.esmarkchn = -1;
    break;
  }
  if (editorInfo.eseditpos - editorInfo.esview < 0)
  {
    editorInfo.esview = editorInfo.eseditpos;
  }
  if (editorInfo.eseditpos - editorInfo.esview >= VISIBLEORDERLIST)
  {
    editorInfo.esview = editorInfo.eseditpos - VISIBLEORDERLIST + 1;
  }
}

void namecommands(void)
{
  switch(rawkey)
  {
    case KEY_DOWN:
    case KEY_ENTER:
    editorInfo.enpos++;
    if (editorInfo.enpos > 2) editorInfo.enpos = 0;
    break;

    case KEY_UP:
    editorInfo.enpos--;
    if (editorInfo.enpos < 0) editorInfo.enpos = 2;
    break;
  }
  switch(editorInfo.enpos)
  {
    case 0:
    editstring(songname, MAX_STR);
    break;

    case 1:
    editstring(authorname, MAX_STR);
    break;

    case 2:
    editstring(copyrightname, MAX_STR);
    break;
  }
}

void insertorder(unsigned char byte)
{
  if ((songlen[editorInfo.esnum][editorInfo.eschn] - editorInfo.eseditpos)-1 >= 0)
  {
    int len;
    if (songlen[editorInfo.esnum][editorInfo.eschn] < MAX_SONGLEN)
    {
      len = songlen[editorInfo.esnum][editorInfo.eschn]+1;
      songorder[editorInfo.esnum][editorInfo.eschn][len+1] =
        songorder[editorInfo.esnum][editorInfo.eschn][len];
      songorder[editorInfo.esnum][editorInfo.eschn][len] = LOOPSONG;
      if (len) songorder[editorInfo.esnum][editorInfo.eschn][len-1] = byte;
      countthispattern();
    }
    memmove(&songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos+1],
      &songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos],
      (songlen[editorInfo.esnum][editorInfo.eschn] - editorInfo.eseditpos)-1);
    songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos] = byte;
    len = songlen[editorInfo.esnum][editorInfo.eschn]+1;
    if ((songorder[editorInfo.esnum][editorInfo.eschn][len] > editorInfo.eseditpos) &&
       (songorder[editorInfo.esnum][editorInfo.eschn][len] < (len-2)))
       songorder[editorInfo.esnum][editorInfo.eschn][len]++;
  }
  else
  {
    if (editorInfo.eseditpos > songlen[editorInfo.esnum][editorInfo.eschn])
    {
      if (songlen[editorInfo.esnum][editorInfo.eschn] < MAX_SONGLEN)
      {
        songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos+1] =
          songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos];
        songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos] = LOOPSONG;
        if (editorInfo.eseditpos) songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos-1] = byte;
        countthispattern();
        editorInfo.eseditpos = songlen[editorInfo.esnum][editorInfo.eschn]+1;
      }
    }
  }
}

void deleteorder(void)
{
  if ((songlen[editorInfo.esnum][editorInfo.eschn] - editorInfo.eseditpos)-1 >= 0)
  {
    int len;
    memmove(&songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos],
      &songorder[editorInfo.esnum][editorInfo.eschn][editorInfo.eseditpos+1],
      (songlen[editorInfo.esnum][editorInfo.eschn] - editorInfo.eseditpos)-1);
    songorder[editorInfo.esnum][editorInfo.eschn][songlen[editorInfo.esnum][editorInfo.eschn]-1] = 0x00;
    if (songlen[editorInfo.esnum][editorInfo.eschn] > 0)
    {
      songorder[editorInfo.esnum][editorInfo.eschn][songlen[editorInfo.esnum][editorInfo.eschn]-1] =
        songorder[editorInfo.esnum][editorInfo.eschn][songlen[editorInfo.esnum][editorInfo.eschn]];
      songorder[editorInfo.esnum][editorInfo.eschn][songlen[editorInfo.esnum][editorInfo.eschn]] =
        songorder[editorInfo.esnum][editorInfo.eschn][songlen[editorInfo.esnum][editorInfo.eschn]+1];
      countthispattern();
    }
    if (editorInfo.eseditpos == songlen[editorInfo.esnum][editorInfo.eschn]) editorInfo.eseditpos++;
    len = songlen[editorInfo.esnum][editorInfo.eschn]+1;
    if ((songorder[editorInfo.esnum][editorInfo.eschn][len] > editorInfo.eseditpos) &&
       (songorder[editorInfo.esnum][editorInfo.eschn][len] > 0))
       songorder[editorInfo.esnum][editorInfo.eschn][len]--;
  }
  else
  {
    if (editorInfo.eseditpos > songlen[editorInfo.esnum][editorInfo.eschn])
    {
      if (songlen[editorInfo.esnum][editorInfo.eschn] > 0)
      {
        songorder[editorInfo.esnum][editorInfo.eschn][songlen[editorInfo.esnum][editorInfo.eschn]-1] =
          songorder[editorInfo.esnum][editorInfo.eschn][songlen[editorInfo.esnum][editorInfo.eschn]];
        songorder[editorInfo.esnum][editorInfo.eschn][songlen[editorInfo.esnum][editorInfo.eschn]] =
          songorder[editorInfo.esnum][editorInfo.eschn][songlen[editorInfo.esnum][editorInfo.eschn]+1];
        countthispattern();
        editorInfo.eseditpos = songlen[editorInfo.esnum][editorInfo.eschn]+1;
      }
    }
  }
}

void orderleft(void)
{
  if ((shiftpressed) && (editorInfo.eseditpos < songlen[editorInfo.esnum][editorInfo.eschn]))
  {
    if ((editorInfo.esmarkchn != editorInfo.eschn) || (editorInfo.eseditpos != editorInfo.esmarkend))
    {
      editorInfo.esmarkchn = editorInfo.eschn;
      editorInfo.esmarkstart = editorInfo.esmarkend = editorInfo.eseditpos;
    }
  }
  editorInfo.escolumn--;
  if (editorInfo.escolumn < 0)
  {
    if (editorInfo.eseditpos > 0)
    {
      editorInfo.eseditpos--;
      if (editorInfo.eseditpos == songlen[editorInfo.esnum][editorInfo.eschn]) editorInfo.eseditpos--;
      editorInfo.escolumn = 1;
      if (editorInfo.eseditpos < 0)
      {
        editorInfo.eseditpos = 1;
        editorInfo.escolumn = 0;
      }
    }
    else editorInfo.escolumn = 0;
  }
  if ((shiftpressed) && (editorInfo.eseditpos < songlen[editorInfo.esnum][editorInfo.eschn])) editorInfo.esmarkend = editorInfo.eseditpos;
}

void orderright(void)
{
  if ((shiftpressed) && (editorInfo.eseditpos < songlen[editorInfo.esnum][editorInfo.eschn]))
  {
    if ((editorInfo.esmarkchn != editorInfo.eschn) || (editorInfo.eseditpos != editorInfo.esmarkend))
    {
      editorInfo.esmarkchn = editorInfo.eschn;
      editorInfo.esmarkstart = editorInfo.esmarkend = editorInfo.eseditpos;
    }
  }
  editorInfo.escolumn++;
  if (editorInfo.escolumn > 1)
  {
    editorInfo.escolumn = 0;
    if (editorInfo.eseditpos < (songlen[editorInfo.esnum][editorInfo.eschn]+1))
    {
      editorInfo.eseditpos++;
      if (editorInfo.eseditpos == songlen[editorInfo.esnum][editorInfo.eschn]) editorInfo.eseditpos++;
    }
    else editorInfo.escolumn = 1;
  }
  if ((shiftpressed) && (editorInfo.eseditpos < songlen[editorInfo.esnum][editorInfo.eschn])) editorInfo.esmarkend = editorInfo.eseditpos;
}

void nextsong(void)
{
  editorInfo.esnum++;
  if (editorInfo.esnum >= MAX_SONGS) editorInfo.esnum = MAX_SONGS - 1;
  songchange();
}

void prevsong(void)
{
  editorInfo.esnum--;
  if (editorInfo.esnum < 0) editorInfo.esnum = 0;
  songchange();
}

void songchange(void)
{
  int c;
  
  for (c = 0; c < MAX_CHN; c++)
  {
	  editorUndoInfo.editorInfo[c].espos = 0;
	  editorUndoInfo.editorInfo[c].esend = 0;
	  editorUndoInfo.editorInfo[c].epnum = c;
  }
  updateviewtopos();

  editorInfo.eppos = 0;
  editorInfo.epview = - VISIBLEPATTROWS/2;
  editorInfo.eseditpos = 0;
  if (editorInfo.eseditpos == songlen[editorInfo.esnum][editorInfo.eschn]) editorInfo.eseditpos++;
  editorInfo.esview = 0;
  editorInfo.epmarkchn = -1;
  editorInfo.esmarkchn = -1;
  stopsong();
}

void updateviewtopos(void)
{
  int c, d;
  for (c = 0; c < MAX_CHN; c++)
  {
    for (d = editorUndoInfo.editorInfo[c].espos; d < songlen[editorInfo.esnum][c]; d++)
    {
      if (songorder[editorInfo.esnum][c][d] < MAX_PATT)
      {
		  editorUndoInfo.editorInfo[c].epnum = songorder[editorInfo.esnum][c][d];
        break;
      }
    }
  }
}
