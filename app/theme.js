// RESQORA design tokens.
// Dark-only, high contrast: an emergency screen has to be readable at a glance,
// at night, at arm's length. Every colour below is checked against Colors.bg.

export const Colors = {
  bg: '#09090B',
  surface: '#131316',
  elevated: '#1C1C21',
  border: 'rgba(255,255,255,0.09)',
  divider: 'rgba(255,255,255,0.06)',
  scrim: 'rgba(0,0,0,0.65)',

  text: '#FAFAFA',    // 18.9:1
  muted: '#A1A1AA',   //  7.4:1
  subtle: '#71717A',  //  4.6:1 — the floor for anything readable

  danger: '#EF4444',
  dangerDeep: '#B91C1C',
  dangerSoft: 'rgba(239,68,68,0.13)',
  safe: '#22C55E',
  safeDeep: '#15803D',
  safeSoft: 'rgba(34,197,94,0.13)',
  info: '#60A5FA',
  infoSoft: 'rgba(96,165,250,0.13)',
  warn: '#F59E0B',
  warnSoft: 'rgba(245,158,11,0.13)',

  onColor: '#FFFFFF',
  map: '#0D1117',
};

// 4pt rhythm.
export const Space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const Radius = { sm: 10, md: 14, lg: 18, xl: 26, pill: 999 };

// Minimum interactive size (Apple 44pt / Material 48dp).
export const HIT = 48;

export const Font = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
};

// Type scale. Body never drops below 15.
export const Type = {
  display: { fontFamily: Font.bold, fontSize: 34, lineHeight: 40, letterSpacing: -0.5 },
  title: { fontFamily: Font.bold, fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  heading: { fontFamily: Font.semibold, fontSize: 17, lineHeight: 23 },
  body: { fontFamily: Font.regular, fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontFamily: Font.medium, fontSize: 15, lineHeight: 22 },
  label: { fontFamily: Font.medium, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: Font.regular, fontSize: 13, lineHeight: 18 },
  overline: { fontFamily: Font.semibold, fontSize: 11, lineHeight: 14, letterSpacing: 1.1 },
  // Timers and distances: tabular figures stop the layout twitching.
  numeric: { fontFamily: Font.bold, fontSize: 26, lineHeight: 32, fontVariant: ['tabular-nums'] },
};

export const Motion = { fast: 140, base: 220, slow: 320 };
