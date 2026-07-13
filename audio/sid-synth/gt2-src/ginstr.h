#ifndef GINSTR_H
#define GINSTR_H

#ifndef GINSTR_C
//extern int editorInfo.einum;
//extern int editorInfo.eipos;
//extern int editorInfo.eicolumn;
extern INSTR instrcopybuffer;
#endif

void instrumentcommands(void);
void nextinstr(void);
void previnstr(void);
void clearinstr(int num);
void gotoinstr(int i);
void showinstrtable(void);

#endif
