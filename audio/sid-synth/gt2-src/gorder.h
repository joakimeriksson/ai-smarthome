#ifndef GORDER_H
#define GORDER_H

#ifndef GORDER_C
//extern int espos[MAX_CHN];
//extern int esend[MAX_CHN];
//extern int editorInfo.eseditpos;
//extern int editorInfo.esview;
//extern int editorInfo.escolumn;
//extern int editorInfo.eschn;
//extern int editorInfo.esnum;
//extern int editorInfo.esmarkchn;
//extern int editorInfo.esmarkstart;
//extern int editorInfo.esmarkend;
//extern int editorInfo.enpos;
#endif

void updateviewtopos(void);
void orderlistcommands(void);
void namecommands(void);
void nextsong(void);
void prevsong(void);
void songchange(void);
void orderleft(void);
void orderright(void);
void deleteorder(void);
void insertorder(unsigned char byte);

#endif
