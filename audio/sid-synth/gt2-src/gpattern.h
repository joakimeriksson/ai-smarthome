#ifndef GPATTERN_H
#define GPATTERN_H

#ifndef GPATTERN_C


//extern int epnum[MAX_CHN];
//extern int editorInfo.eppos;
//extern int editorInfo.epview;
//extern int editorInfo.epcolumn;
//extern int editorInfo.epchn;
//extern int editorInfo.epoctave;
//extern int editorInfo.epmarkchn;
//extern int editorInfo.epmarkstart;
//extern int editorInfo.epmarkend;
#endif

typedef struct {
	// From gtstereo.c

	unsigned int eacolumn;
	unsigned int multiplier;
	unsigned int sidmodel;
	unsigned int adparam;

	unsigned int finevibrato;
	unsigned int optimizepulse;
	unsigned int optimizerealtime;
	unsigned int ntsc;
	// unsigned int usefinevib;

	int editmode;

	// From order.c
	int eseditpos;
	int esview;
	int escolumn;
	int eschn;
	int esnum;
	int esmarkchn;	// = -1;
	int esmarkstart;
	int esmarkend;
	int enpos;

	// From pattern.c
	int eppos;
	int epview;
	int epcolumn;
	int epchn;
	int epoctave;
	int epmarkchn;
	int epmarkstart;
	int epmarkend;

	// From ginstr.c
	int einum;
	int eipos;
	int eicolumn;

	// From gtable.c
	int etview[MAX_TABLES];
	int etnum;
	int etpos;
	int etcolumn;
	int etlock;	// = 1;
	int etmarknum;	// = -1;
	int etmarkstart;
	int etmarkend;

}EDITOR_INFO;

extern EDITOR_INFO editorInfo;

void patterncommands(void);
void nextpattern(void);
void prevpattern(void);
void patternup(void);
void patterndown(void);
void shrinkpattern(void);
void expandpattern(void);
void splitpattern(void);
void joinpattern(void);

#endif
