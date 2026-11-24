/** Friendly theme-file names for the CSS variables in tokens.css; one list feeds the schema, the server and the browser. */
export const COLOR_TOKENS = {
  bg: '--bg', surface: '--surface', subtle: '--subtle', border: '--border', hair: '--hair', canvas: '--canvas', track: '--track',
  selection: '--sel', stackRow: '--stackrow', mergedCard: '--merged-card', backdrop: '--backdrop', shadow: '--shadow',
  text: '--text', text2: '--text2', muted: '--muted', accent: '--accent', accentText: '--accent-fg', pill: '--pill', pillText: '--pill-fg',
  blocked: '--c-blocked', waiting: '--c-waiting', ready: '--c-ready', draft: '--c-draft', merged: '--c-merged', behind: '--behind',
  greenBg: '--g-bg', greenText: '--g-fg', amberBg: '--a-bg', amberText: '--a-fg', redBg: '--r-bg', redText: '--r-fg',
  neutralBg: '--n-bg', neutralText: '--n-fg', blueBg: '--b-bg', blueText: '--b-fg',
  edge: '--edge', edgeMerged: '--edge-merged', hatchA: '--hatch-a', hatchB: '--hatch-b',
  avatar0Bg: '--av0-bg', avatar0Text: '--av0-fg', avatar1Bg: '--av1-bg', avatar1Text: '--av1-fg', avatar2Bg: '--av2-bg', avatar2Text: '--av2-fg',
  avatar3Bg: '--av3-bg', avatar3Text: '--av3-fg', avatar4Bg: '--av4-bg', avatar4Text: '--av4-fg',
} as const;

export type ColorToken = keyof typeof COLOR_TOKENS;
export const COLOR_TOKEN_NAMES = Object.keys(COLOR_TOKENS) as ColorToken[];
export type ThemeMode = 'light' | 'dark';
