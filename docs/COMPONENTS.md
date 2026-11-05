# Components

The app's UI is built from shared components in `frontend/src/components/`, each feature's own components in `frontend/src/features/<domain>/components/`, and design tokens in `frontend/src/theme/`. Screens compose them; they hold no business logic.

## Design system

- **Tokens** (`src/theme`): `colors` (palette and semantic roles), `typography` (variants by role, e.g. `screenTitle`, `sectionTitle`, `statValue`, `tileCaption`, `bodySmall`), `spacing`, `borderRadius`, `shadows`, `glass` (the frame's gradient, fills, blur), `layout` (device-class widths, gutters, and `layout.innerScreen`, the inner screens' rhythm), `breakpoints`, `motion`. **No raw colour or font size outside `src/theme`.**
- **The Glass frame**: blur, a 20% `#4F7BFF → #FF5CCB` gradient and a white hairline. It is `common/GlassSurface`, and cards, fields and buttons are built on it.
- **Measurements** in a screen's `.styles.ts` come from its Figma export in `frontend/assets/Screens`. Change them against the reference, not by eye.
- **The inner screens' rhythm** (`theme.layout.innerScreen`): a 16dp gutter (358dp cards at 390dp), the page header drawn for a 35dp gutter, 30dp from header to content, 18dp between cards, panels inset 14dp, 46dp buttons.
- **Type by role**: map text to an existing variant by what it is (heading, row title, caption…). Do not add a variant per screen.
- **Responsive**: phone layouts stay as drawn. Wider screens reflow through `useScreenLayout()`, `ResponsiveColumns` and `ResponsiveGrid`. Size from `useScreenLayout()`, never from the window.

## Inventory

### `components/common`: primitives

| Component | Purpose | Key props |
|---|---|---|
| `AppText` | Text in a typography variant (scaled by a surrounding `TypeScaleContext`) | `variant`, `color`, `align`, `numberOfLines` |
| `AppButton` | Glass button: primary, secondary, gradient | `title`, `variant`, `height`, `radius`, `loading`, `labelVariant`, `leadingIcon` / `trailingIcon` (+ placement), `gradientColors`, `pressEffect` |
| `AppInput` | Glass text field (pill or field) | `label`, `value`, `onChangeText`, `error`, `leftIcon`, `rightIcon`, `height`, `variant` |
| `GlassSurface` | The Glass frame | `radius`, `tinted`, `fillOpacity`, `strokeColors`, `blurred`, `glow`, `glowBottomColors` |
| `AppIcon` | Ionicons / Material icon with optional badge | `set` (`IconSet`), `name`, `size`, `color`, `badge` |
| `ToggleSwitch` | On/off switch | `value`, `onValueChange`, `accessibilityLabel`, `disabled` |
| `BackButton` | Round glass back button | `onPress`, `size`, `title` |
| `GradientText` | Text filled with a gradient | `variant`, `colors` |
| `SlideButton` | Slide to confirm | `title`, `onComplete`, `icon`, `height` |
| `QrScanner` | Camera QR scanner with permission handling | `onScan`, `onClose`, `permissionHint` |
| `AppBackground`, `NeonEdge`, `FadeIn`, `DirectionView`, `BlurTarget` | Building blocks used by the components above | — |

### `components/layout`: page structure

| Component | Purpose | Key props |
|---|---|---|
| `ScreenWrapper` | Safe area and background photo with scrims | `backgroundSource`, `withScrim`, `backgroundOverlay`, `scrollable`, `edges` |
| `InnerScreenFrame` | The whole page of the smart-home and settings screens: background, status bar, one responsive scrolling column, bottom bar | `contentStyle`, `overlay` (a menu), any `ScrollView` prop (`refreshControl`, `keyboardShouldPersistTaps`, default `handled`) |
| `ParkingFrame` | The whole page of the parking and Health Passport flows: what `InnerScreenFrame` does, plus a right-to-left body for Arabic, a pinned footer and side-by-side columns | `title`, `subtitle`, `rtl`, `footer`, `aside`, `bottomBar`, `onBack` |
| `PageHeader` | Wordmark, back button, title and subtitle, menu button | `title`, `subtitle`, `onMenuPress`, `trailing`, `showBack` |
| `ScreenHeader` | Home's header (menu, wordmark, avatar) | `initials`, `onMenuPress`, `onProfilePress` |
| `BottomBar` | The tab bar on phones; `NAV_BAR_CLEARANCE` for scroll padding | `inset` |
| `ResponsiveColumns` | One column on phones, two side by side when there is room | `gap`, `weights`, `align` |
| `ResponsiveGrid` | A grid whose column count follows the width | `data`, `renderItem`, `minItemWidth`, `min/maxColumns`, `gap` |
| `AppShell`, `SideNav`, `BrandLockup` | The side rail on wider screens, and the wordmark | — |

### `components/ui`: composed pieces

| Component | Purpose |
|---|---|
| `NeonPanel` | Neon-edged glass panel, the inner screens' card |
| `Panel` | The parking and Health Passport card: a `NeonPanel` with a heading and a padded body |
| `PanelHeading` | A panel's title row: icon, title, subtitle, "View All", divider |
| `SelectableCard` | A choice in a list (brand, method, found device): glass card, cyan-to-violet stroke, glow when `selected`; `pressedStyle` / `disabledStyle` per screen |
| `StatusChip` | Status pill in six tones |
| `FilterChip` | Selectable chip; `role` `tab` or `radio` |
| `AppMenu` | Anchored dropdown menu (a modal) |
| `ServiceTile`, `LinkCard`, `PhotoCard`, `PromoCard`, `SectionCard` | Tiles and cards of Home, Services, Settings, My Unit |
| `FeatureBanner` | Hero banner of the inner screens |
| `StatItem`, `StatTile`, `DividedRow` | Figure rows (My Unit, Maintenance) |
| `MediaRow`, `VisitorRow` | List rows |
| `ProgressBar`, `ProgressStepper`, `PairingStep` | Progress and step indicators |
| `ParkingButton` | The parking screens' compact button (also QrScanner's and Health Passport's) |
| `Controls` | The parking and Health Passport form parts: chip group, segmented, stepper, field, check row, info row, fact grid |
| `ListRow` | A booking, document or event in a list, with its status |
| `LanguageToggle` | The English and Arabic switch of the visitor pass and Health Passport |
| `WifiCredentialForm` | Home Wi-Fi name and password, validated |
| `ArrowRightIcon`, `Avatar`, `GlowArc`, `NudgingArrow`, `ParkingSign`, `WeatherPill`, `UnitHeroCard`, `UnitSummaryCard`, `VisitorPassCard`, `DeviceConnectionStatus` | Single-purpose pieces of particular screens |

### `components/feedback`

| Component | Purpose | Key props |
|---|---|---|
| `Notice` | Message box in a tone (info, success, warning, error) with optional actions | `tone`, `title`, `actions`, `style` |
| `LoadingState` | A spinner; with `label`, the spinner over a caption | `label`, `labelVariant` (`tileCaption` / `bodySmall`), `inset` (`sm` / `md`), `announce`, `accessibilityLabel` |
| `ErrorNotice` | A failed load with a retry button | `title`, `retryLabel`, `onRetry`, `buttonHeight` (default `layout.innerScreen.buttonHeight`) |

### `components/forms`

| Component | Purpose |
|---|---|
| `formMetrics` | The forms' shared sizes (Visitor Access's): field height, icon, chevron, CTA height and arrow |
| `FormSubmitButton` | A form's send button: four-stop CTA gradient, trailing arrow (`title`, `onPress`, `style`) |

### Feature components

| Folder | Components |
|---|---|
| `features/home/components` | `DeviceCard` (a device from the EMS backend or a gateway: name, room, state, quick toggle), `DeviceControl` (full controls per capability), `LevelSlider` |
| `features/gateway/components` | `GatewayStatusRow`, `NoGatewayNotice`, `BrandBadge`, `RequirementChips` (support level, methods, candidate), `CredentialFields`, `StepList` |
| `features/ems/components` | `EmsAccountPanel` (the account on smart-home screens; the app's sign-in is the Login screen) |
| `features/parking/components` | `Rows` (`PassQr`, `Timeline`), `GuestTrackerCard`, `site-map/*` (`SiteMap`, `MapLayers`, `RouteLayer`) |
| `features/clinic/components` | `DoctorCard`, and `presenters` (status tones and labels) |
| `features/health/components` (the clinic screens use them too) | `HealthFrame` (`ParkingFrame` with Arabic layout and the language switch), `HealthNotifier` (the banner over every screen), `LoadState` (`HealthErrorNotice`, `LoadingPanel`, `ResourceView`), `ConfirmSheet`, `DateField`, `ItemFields`, `ItemRow`, `OriginalFile`, `ZoomableImage`, `SummaryPlayer`, `Sparkline`, `BidiText`, `TextLink` |
| `features/assistant/components` | `AssistantOrb`, `ChatBubble`, `ChatComposer`, `VoiceControls`, `VoiceStatusPill`, `VoiceTranscript`, `ModeSwitch`, `SuggestionChips`, `InsightBadges`, `RichText` and their helpers |

### Hooks for UI

| Hook | Purpose |
|---|---|
| `useAppTheme` | The theme |
| `useScreenLayout` | Device class, frame and column widths, `contentStyle` for the scrolling column |
| `useScreenMenu` / `useLogout` | A header menu's state and its "Log out" item; logging out |
| `useReduceMotion` | The system's reduce-motion setting |

## Look-alikes that stay separate

These look similar but differ visibly, so merging them would change the design:

| Pair | Why separate |
|---|---|
| `components/feedback/Notice` and `LgNotice` (`screens/LgPairingScreen/LgPairingParts`) | The LG wizard's notices are drawn differently, with their own buttons (`PrimaryAction`, `SecondaryAction`, `TextAction`) |
| `features/home/components/DeviceCard` and `SmartHomeDeviceTile` (Smart Home screen) | The tile follows the Smart Home Figma (online dot, icon), the card the device lists (status chip, quick toggle) |
| `ProgressStepper`, `PairingStep`, `StepList`, parking `Timeline`, `GuestTrackerCard` | Each is drawn for its own flow (Maintenance and LG, provisioning, a booking's timeline, a guest's arrival) |
| Parking `Controls.Segmented`, assistant `ModeSwitch`, `FilterChip` tabs, Smart Home room tabs | Different sizes and fills per design |
| Parking `Controls.Field` and `AppInput` | Parking draws a plain field on its darker panels |
| `AppButton` and `ParkingButton` | `ParkingButton` is a compact preset of `AppButton` for the parking screens |

## Composition

A typical inner screen:

```tsx
export function ExampleScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { menuOpen, setMenuOpen, menuItems } = useScreenMenu();
  const { items, error, reload } = useExampleItems();

  return (
    <InnerScreenFrame contentStyle={styles.content} overlay={<AppMenu visible={menuOpen} onClose={() => setMenuOpen(false)} items={menuItems} align="right" />}>
      <PageHeader title={copy.title} subtitle={copy.subtitle} onMenuPress={() => setMenuOpen(true)} style={styles.header} />
      <NeonPanel style={styles.panel}>
        <PanelHeading title={copy.listTitle} iconSet="ionicons" iconName="list-outline" divider />
        {error ? (
          <ErrorNotice title={copy.loadFailed} retryLabel={copy.retry} onRetry={reload}>{error}</ErrorNotice>
        ) : !items ? (
          <LoadingState accessibilityLabel="Loading" />
        ) : (
          items.map((item) => (
            <SelectableCard key={item.id} accessibilityLabel={item.name} onPress={() => open(item)} pressedStyle={styles.pressed} style={styles.card}>
              <AppText variant="statValue">{item.name}</AppText>
            </SelectableCard>
          ))
        )}
      </NeonPanel>
    </InnerScreenFrame>
  );
}
```

- Put screen-specific measurements in the screen's `.styles.ts`, from `theme` and `layout.innerScreen`.
- Put copy and mock content in `.data.ts`.
- Reach data through a feature hook, never `fetch`.

**Where a new component goes**:
- Used by one screen only: next to the screen (e.g. `screens/CommunityScreen/PollOptionRow.tsx`).
- Used by one domain: `features/<domain>/components`.
- Used across domains: `components/`, in the folder that matches it (`common` primitive, `ui` composed piece, `layout` page structure, `feedback`, `forms`).

## Checking a visual change

`frontend/scripts/visual-regression.mjs` captures every screen, and the header menus' open states, from a web build. Comparing two captures shows whether anything moved by even a pixel; see [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md#visual-regression).
