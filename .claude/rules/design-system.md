---
paths:
  - "frontend/src/**/*.{ts,tsx}"
  - "frontend/App.tsx"
  - "frontend/assets/Screens/**"
---

# Design system (app UI)

- Every colour, font size, spacing, radius, shadow and glass value is a token in `src/theme/`.
  Outside that folder: no hex values, no `rgba(...)` strings, no `fontSize: <number>`.
  Use `theme.colors.*` from `useAppTheme()`, `<AppText variant="...">` or `theme.typography.*`,
  `theme.spacing.*`, `layout.*`. If no token fits, add one in `src/theme/`, then use it.
- The Glass look (blur + 20% #4F7BFF→#FF5CCB gradient + white hairline) is
  `src/components/common/GlassSurface.tsx`. Build new cards, fields and buttons on it (or on
  `NeonPanel` / `Panel`), never re-create the effect.
- Screens are measured against their Figma export in `frontend/assets/Screens/`. Numbers in a
  `.styles.ts` are real measurements: name them as constants at the top of the file and change them
  against the reference, not by eye. The inner screens' shared rhythm (16dp gutter, 35dp header
  gutter, 30 / 18 / 14 spacing, 46dp buttons) is `layout.innerScreen` in `src/theme/layout.ts`.
- Phone layouts (< 768dp) stay exactly as drawn. Wider screens reflow through `useScreenLayout()`,
  `ResponsiveColumns` and `ResponsiveGrid`, with breakpoints and widths from
  `src/theme/breakpoints.ts` and `src/theme/layout.ts`. Size from `useScreenLayout()`, never from
  the window.
- After a UI change, compare before/after screenshots with `frontend/scripts/visual-regression.mjs`
  (`docs/DEVELOPMENT_GUIDE.md`).
