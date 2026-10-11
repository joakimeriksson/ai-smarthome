// The built-in demo songs, for the studio's open menu and scripts/render-song.ts.

import type { Project } from './project.ts'
import { demoProject } from './demo.ts'
import { hiScoreProject } from './demo-hiscore.ts'
import { neonRainProject } from './demo-neon-rain.ts'
import { nightPatrolProject } from './demo-night-patrol.ts'
import { rolloutProject } from './demo-rollout.ts'
import { skylineProject } from './demo-skyline.ts'
import { afterglowProject } from './demo-afterglow.ts'

export const DEMOS: { id: string; build: () => Project }[] = [
  { id: 'night-drive', build: demoProject },   // the one the studio boots into
  { id: 'hi-score', build: hiScoreProject },
  { id: 'neon-rain', build: neonRainProject },
  { id: 'night-patrol', build: nightPatrolProject },
  // Dance tracks written for the scatter pads: busy drums, steady 16ths.
  { id: 'rollout', build: rolloutProject },
  { id: 'skyline', build: skylineProject },
  { id: 'afterglow', build: afterglowProject },
]
