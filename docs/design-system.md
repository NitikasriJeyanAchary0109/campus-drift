# DriftWatch UI design system

A neutral, professional light theme: slate neutrals, one blue accent, restrained status colours, system font stack, no images or web fonts.
Tokens and components live in `frontend/src/components/ui/pixel/` (the folder and the `Pixel*` component names are historical; the look is the professional theme below).
The earlier pixel-art version of the UI was archived outside the repository (`~/Desktop/DriftWatch-Pixel-UI`).

## Tokens (`tokens.css`, one source; the Tailwind `dw` colours point at it)
| Group | Values |
|---|---|
| Neutrals | page `#f1f5f9`, card `#ffffff`, subtle surface `#f8fafc`, border `#e2e8f0` / `#cbd5e1`, text `#0f172a`, muted text `#475569` |
| Accent | blue `#2563eb` (primary buttons, links, active navigation) |
| Status | green `#16a34a`, amber `#f59e0b`, orange `#ea580c`, red `#dc2626`, dark red `#7f1d1d`; badges use a tinted background with dark text and a 1px border |
| Shape | 8px radius, 1px borders, soft shadows (`--pxl-shadow-1..3`), 4px spacing scale |
| Type | system sans (`ui-sans-serif, system-ui, ...`) for everything, system monospace for configuration text; tables 14px, headers 13px |
| Focus | 2px blue outline with 2px offset on every interactive element |
| Motion | short fades only; all animation is off under `prefers-reduced-motion` |

## Status colours (one table: `ui/pixel/semantic.ts`)
| Label | Colour | Icon and text |
|---|---|---|
| Compliant | green | check, "Compliant" |
| Drift-Authorized | blue | shield-check, "Authorized" |
| Drift-Unauthorized-Low | amber | info, "Low" |
| Drift-Unauthorized-Medium | orange | triangle, "Medium" |
| Drift-Unauthorized-High | red | octagon, "High" |
| Non-Compliant (Critical) | solid dark red | siren, "Critical" |
| NO_BASELINE | grey, dashed outline | dashed circle, "No baseline" |

Every badge carries an icon and text, so colour is never the only signal.

## Components
PixelPanel, PixelCard, PixelRibbon (panel header), PixelButton (primary, secondary, ghost, danger, success; hover, focus, pressed, disabled, loading), PixelInput,
PixelSelect, PixelCheckbox, PixelBadge, PixelStat, PixelTable (+ Thead, Tbody, Tr, Th, Td), PixelTabs, PixelModal, PixelToast (+ PixelToaster, useToast),
PixelTooltip, PixelPagination, PixelSkeleton, PixelEmptyState, PixelProgress (+ PixelSteps), DeviceIcon (lucide icons).
The development route `/dev/ui` shows every component and state; it is compiled out of production builds.

## Checks
`frontend/tests/unit/pixelTokens.test.ts` computes WCAG contrast from `tokens.css` (every tone and text pair at least 4.5:1, boundaries at least 3:1) and checks that no web fonts are loaded;
`frontend/tests/unit/pixel.test.tsx` covers behaviour and aria for each component.
