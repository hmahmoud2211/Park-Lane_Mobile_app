# Visitor Parking, Gate Access and EV Charging: Demo Handover

An interactive demo of visitor parking reservations, QR entry and exit, directions to the exact bay, and EV charging reservations, built into the existing Parking section of the app. All data is fictional and stored on the device. Gates, sensors and chargers are simulated.

## What was built

### Screens

| Screen | Who uses it | Route (web path) |
| --- | --- | --- |
| Parking home (updated) | Resident | `Parking` (`/parking`) |
| Reserve Guest Parking / Reserve EV Charging in two steps, also used for edits | Resident | `ReserveParking` (`/parking/reserve`) |
| Reservation details: guest tracker, pass, WhatsApp, share, edit, extend, cancel, history | Resident | `ReservationDetails` (`/parking/reservation/:id`) |
| Reservation history | Resident | `ReservationHistory` (`/parking/history`) |
| Guest pass in English or Arabic, with Save QR; no account needed | Visitor | `GuestPass` (`/pass/:inviteToken`, `?lang=ar` for Arabic) |
| Site map with step-by-step directions to the bay (Arabic from an Arabic pass) | Resident and visitor | `ParkingMap` (`/parking/map`) |
| Charging session | Resident | `ChargingSession` (`/parking/charging/:id`) |
| Security console, with expected arrivals | Security (demo role) | `SecurityConsole` (`/parking/security`) |
| Demo controls | Presenter only | `DemoControls` (`/parking/demo`) |

Changes to existing screens:

- **Parking home.** Every figure comes from the store. The tiles now read "Available now", "Guest bays free now", "Chargers free now" and "Occupied now", with a note that booking checks the exact time chosen. "Request Guest Parking" is now **Reserve Guest Parking**, because bookings confirm automatically. "Register New Vehicle" did nothing, so it is replaced by **Reserve EV Charging**. Below the actions are two sections: Guest Parking Requests, whose status chips show overdue visits and bookings needing action, and Parking Activity. The resident's own EV bookings are under View All (Reservation history).
- **Booking flow.** Two steps. Step 1 is one page with the guest, plate (or "Visitor will add vehicle details"), parking type, date, arrival and stay length; quick 1h to 8h chips set the length, and mobile and email sit behind "Add mobile or email". Step 2, "Choose a space", opens on the map: a summary card with Edit, List / Map, equal-width level tabs (Ground, B1 · EV Hub, B2 · Residents), and the plan drawn as a lit garage. A free bay glows green, an occupied one glows red around a parked car, a bay booked during your time is hatched, and the chosen bay is cyan. Warm wall lights run along the walls, there is a bolt under each EV bay in its charger's colour, and the route runs from the gate. The level switch is one segmented control, and the map card is headed with the level and its count ("Basement 1 · EV Hub, 1 available spot"). The legend reads Available, Occupied, Reserved, Selected and Route. The other maps use the same bay drawing. Tapping a free bay selects it; tapping a taken one says why. A pinned card at the bottom shows the selected bay ("V-014 · Ground · Near Building A") with the Confirm button, so it is always in reach. The List view keeps the three nearest bays with "Show more". The booking flow hides the bottom bar, pins its main button, and the header's back arrow steps back from step 2 to step 1.
- **Less scrolling, most important first.** Each fact appears once.
  - **Reservation page:** until the pass is sent, "Send the pass" (WhatsApp, Share, Copy link, Preview) leads. Next comes one card with the time, bay, entrance and vehicle in a grid, plus a one-row guest tracker. Directions are one button to the map page, the log sits behind Activity, and Edit / Replace QR / Cancel / Extend share one compact card.
  - **Guest pass:** the plate prompt (when needed) comes first, then one pass card with the QR and four key facts. Directions follow, with the "park" step as the subtitle and the full steps folded. Once the guest is inside, charging moves above directions.
  - **Map page:** just the glowing map, the "Navigate to gate" button and one note.
  - **Parking home:** shows three requests with one-line times. Its activity list no longer repeats bookings listed above it.
- **Visitor Access.** The parking card now opens the booking flow.
- **Navigation.** The bottom bar no longer covers content, and the new screens use larger type (13dp body, 11dp labels).
- **Demo controls.** Reached from the Parking menu or a dashed "Demo" strip at the bottom of the Parking screen. They are kept apart from resident actions.

### Code layout

The booking logic has no UI or React dependencies, so it also runs in Node.

| Path | Responsibility |
| --- | --- |
| `src/services/parking/types.ts` | Data model: properties, residents, vehicles, zones, spaces, gates, reservations, invitations, QR credentials, parking sessions, scan events, occupancy events, chargers, connectors, charging allocations and sessions, notifications, audit events |
| `policy.ts` | Configurable rules: turnover buffer (10 min), late-arrival grace (20 min), early arrival (30 min), 2 guests at once per property, 8 h visitor stay, 14-day horizon, EV limits |
| `time.ts` | Africa/Cairo input and display. Storage is UTC. Egypt's daylight-saving rule is implemented directly, so results are identical on Hermes, browsers and Node |
| `availability.ts` | Half-open `[start, end)` intervals, blocking rules, bay and connector checks, charger concurrency, search and recommendation |
| `reservations.ts` | Create, edit, extend, cancel, replace pass, reassign bay, visitor plate entry, help requests |
| `gate.ts` | Entry and exit validation, idempotent repeat scans, logged operator overrides |
| `charging.ts` | Plug-in, simulated energy, completion, charger faults, "moved out of EV bay" |
| `scheduler.ts` | No-show expiry, overdue alerts, flagging bookings that need another bay, charging progress |
| `repository.ts` | Persistent store with serialized, atomic transactions |
| `service.ts` | The only API the screens call; one transaction per method |
| `selectors.ts` | Derived dashboard counts, display statuses, activity, directions |
| `tracking.ts` | The owner's guest tracker and security's expected arrivals, both read from stored records (booking, share, gate scans, bay, charging) |
| `i18n.ts` | English and Arabic for the guest's pages: Arabic-Indic digits, Cairo dates and times in Arabic, site names, and route steps written from each step's structured facts |
| `site.ts` | Fictional compound: three levels (Ground, B1 EV Hub, B2 Residents), named roads and one-way aisles as a graph, ramps, lifts, buildings with entrances, bays and chargers |
| `routing.ts` | Turn-by-turn routes from each bay's gate, computed from the road graph (Dijkstra; left and right from the geometry), plus the walk to the building entrance or lift. Stored on each bay at seed time |
| `seed.ts` | Seed data relative to the demo clock |
| `checks.ts`, `run-checks.ts` | Acceptance checks |

UI pieces are in `src/components/parking/`: frame, panel, notice, buttons, chips, stepper, fields, list rows, QR, timeline, turn-by-turn steps, the guest tracker card, the language toggle, the camera scanner, and the site map in `site-map/` (its wording is in `site-map/mapStrings.ts`). Outside that folder:

- `src/components/common/DirectionView.tsx` lays a page out right to left for Arabic: Yoga's `direction` style on iOS and Android, the HTML `dir` attribute on web, where react-native-web has no `direction` style. `AppText` inside it follows the same direction, so a line that starts with a plate or bay code still starts at the right.
- `src/utils/share.ts` builds the WhatsApp (`wa.me`) link and turns a local number such as 0100 123 4567 into +20 100 123 4567.
- `src/utils/passImage.web.ts` draws the saved pass card on a canvas; `src/utils/passImage.ts` is the iOS and Android version.

### The site map

The map (`src/components/parking/site-map/`) is drawn in SVG from `site.ts`, so a real site replaces the data, not the code.

- **Levels.** Ground, Basement 1 (EV Hub) and Basement 2 (Residents) each have their own plan, chosen with tabs. On the directions screen the map switches level by itself as the route goes down a ramp. Tapping a ramp also switches level.
- **Structure.** The compound wall, named roads with kerbs and lane markings, one-way aisle arrows underground, buildings with their entrances, the clubhouse and pool, gardens, ramps, lifts, columns, zone outlines, a compass, and the gates (Gate 3 marked "exit only").
- **Directions.** There are no written turn-by-turn steps; the map guides by itself. The route is computed from the road graph and drawn only as glowing dots that stream along it in the direction of travel, with a brighter wave running ahead through them: cyan for the drive, green for the walk to the building entrance or lift. The map opens at the gate. "You enter here" marks the gate, and a pulse at the ramp shows the route continues below (tap the ramp or the level tab). "From South Road" marks the arrival underground, and a pulsing marker shows the bay. With reduced motion turned on, the dots stand still. The written steps remain only as the map's screen-reader description.
- **Live status.** Bays are coloured free, occupied, reserved, closed or unknown. Chargers show available, in use or fault, with lines to the bays they reach. Zone cards show free counts and jump to that zone.
- **Interaction.** Zoom in and out, fit the whole level, and drag to pan when zoomed. Tapping a bay or charger opens its details. Toggles control the walking route and bay numbers. In the booking flow, free bays are tappable to choose them.
- **Privacy.** On a visitor's pass, other bays have no numbers or status and only the levels on the visitor's own route are offered.
- **Accessibility.** Animation stops when the system's reduce-motion setting is on, and every tappable element has a screen-reader label. `src/context/ParkingDemoContext.tsx` owns the store, the clock and the 30-second rule sweep.

### Sending the pass and following the visit

- **WhatsApp.** The reservation page has a "Send on WhatsApp" button. It opens WhatsApp with the invitation already written (greeting, date and time, bay, entrance gate, what to do at the gate, and the pass link) and addressed to the guest's number if one was saved. The resident presses send. The app never says "sent" or "delivered": it records that the pass was handed to WhatsApp, and the feedback says delivery can't be confirmed. Share Pass and Copy Link are still there and are recorded the same way.
- **Message and pass language.** English or العربية, chosen above the buttons. Arabic writes the message in Arabic and adds `?lang=ar` to the link, so the pass opens in Arabic. Open Pass previews the pass in the chosen language.
- **Guest tracker.** On every guest booking: a headline ("Omar Khaled is expected at 5:50 PM", "… is on site, in V-011", "… is running late", "… left at 6:30 PM") over the milestones Booked, Pass shared, Arrived, Parked and Left. Each milestone comes from a stored record: the booking, the share, the gate scan, the bay and the exit. Late arrivals, overstays, no-shows and cancellations show as problems. It never shows the guest's location. "Pass not shared yet" appears only before the visit; a guest who came in had the pass somehow.
- **History.** The reservation's history is collapsed behind Show history, and now includes each share.
- **Arabic pass.** The visitor's pass, its directions and its map are fully in Arabic and laid out right to left, with Arabic-Indic digits and Arabic times (٥:٥٠ م). Bay codes, plates and building letters stay as they are signed on site. The map's drawing stays left to right, because it is a plan of the site. The guest can switch language with the EN / عربي button in the header; with no choice in the link, the phone's language decides.
- **Save QR.** On the pass, under the code. On web it saves a phone-sized pass card (compound, guest, time, the code on its white margin, bay, entrance, plate and pass number) as a PNG: a phone opens the share sheet, where Save Image puts it in the photos, and a computer downloads it. On iOS and Android it saves the code itself and opens the share sheet. The saved code works at the gate without internet, until the host issues a new code. The saved image was decoded in Chrome and matches the pass's live token.
- **Expected arrivals.** The security console lists bookings due in the next hour and late guests still within their 20-minute grace, soonest first, with name, plate (or "plate to come"), bay, gate, and when: Due (entry opens 30 minutes before), Entry open, Late, or Needs bay. Tapping one selects its gate and the entry lane and offers "Scan their pass at Gate 1".

## Run, reset and check

```bash
npm install
npx expo start --web          # then open http://localhost:8081/parking
npm run check:parking         # acceptance checks in Node, using a private in-memory store
```

You can also reach the demo through the app itself: First screen → Sign in → Home → Parking.

- **Reset.** Open Demo controls and choose Reset demo data. This reseeds everything at the current time and returns the clock to real time. Clearing the site's data in the browser has the same effect.
- **Clock.** Demo controls → +15 min, +1 hour, +4 hours or +1 day. One clock drives every rule. It only moves forward.
- **Checks in the app.** Demo controls → Run acceptance checks. These run on a private copy and do not touch the demo data.

## Demo script

Seed times are relative to when the data was seeded. "Now" means the demo clock.

1. **Book a guest.** On Parking, tap Reserve Guest Parking. Apartment A-302 is preselected; the resident owns two properties. Enter a guest name and plate, pick a stay length, and tap Find a space. Step 2 lists the three nearest free bays with the nearest selected, and the site map shows the same choice in colour. Tap Confirm.
2. **Send the pass.** Open Omar Khaled's booking (under Guest Parking Requests). The Guest tracker says he is expected and the pass is not shared yet. Tap WhatsApp: WhatsApp opens with the message ready (on a computer, WhatsApp Web) and the tracker now shows Pass shared, "Delivery isn't confirmed". Choose العربية and tap WhatsApp again for the Arabic message. Open Pass shows what the visitor sees: QR, Save QR, space, building, entrance gate, directions, Contact security, and Space occupied.
3. **Arabic pass.** On the pass, tap عربي (or open the link with `?lang=ar`). Everything turns Arabic and right to left. Tap حفظ رمز QR to save the pass card, then open the map: the legend and labels are in Arabic.
4. **Directions.** Open the site map from the reservation, or Open the map from the visitor's pass. Glowing dots stream from the gate the way to drive. For an EV bay, the ramp pulses: tap it (or B1) to follow the route underground to the bay, then the green walk to the lift. Zoom in, drag around, and tap a charger or a bay for its details. The visitor's map hides other bays' numbers and the residents' basement.
5. **Gate checks.** Open Security console, choose Gate 2 and scan the new guest's pass: Wrong gate. Choose Gate 1 and scan again: the gate opens, with early arrival allowed up to 30 minutes before the booking. Scan again: Already checked in, with no new event. Paste the invitation link: Not a gate pass.
6. **Expected arrivals.** The console lists Tarek Nabil as Late, Mohamed Ali as Needs bay and the resident's Ioniq as Due. Tap Tarek, then "Scan their pass at Gate 1": the barrier opens, he leaves the list, and his booking's tracker shows Arrived at Gate 1 and Parked in V-015.
7. **Late arrival and no-show.** If you let Tarek in during step 6, reset the demo data first. Tarek Nabil is seeded 10 minutes late. Demo controls → +15 min. He becomes a no-show, his bay is released, his pass is refused at the gate, and the tracker says he didn't arrive.
8. **Overstay.** Hany Fawzy is overdue in V-024. The bay stays occupied and blocked. Mohamed Ali's later booking there shows Action needed and is not cancelled. Exit Hany at Gate 3, which is exit-only, to show that an overdue visitor can always leave. A repeat exit returns Already checked out.
9. **EV charging.** Rana Fathy is charging on Charger B. Advance 15 minutes: charging completes, the driver is told to move, and the bay stays occupied. Use "Moved out of EV bay" to release the bay without recording a compound exit.
10. **Your own EV.** The Hyundai Ioniq 5 is booked on EV-01 from about one hour after seeding; it is under View All on the Parking page. Advance 30 minutes and Simulate entry; it enters early. Open session: plug-in stays disabled until the slot starts. Advance 30 minutes, plug in, and advance one hour to see simulated progress. Simulate charger fault on Charger A: the session is interrupted with its energy recorded, and the bay stays reserved.
11. **Charger fault on a future booking.** Ziad Kamal's booking is on faulted Charger C. Open it and choose "Move to the nearest free bay". The bay and connector move together, or nothing changes if no compatible charger is free.
12. **Charger concurrency.** Charger B has a CCS2 plug at EV-03 and a CHAdeMO plug at EV-04 but charges one car at a time. While Rana charges, EV-04 is not offered for CHAdeMO bookings.
13. **Guest limit.** Apartment B-1104 has two guests overlapping for part of today. A third guest during that overlap is refused. Back-to-back visits do not count as simultaneous.
14. **Refresh.** Reload the page. Every booking, scan and alert is still there.

## What is simulated

- **Barriers and scanners.** "Gate opened" is a result on screen. The console's camera scanning is real: expo-camera reads QR codes on web and native once permission is granted. Pasting a code and choosing a demo pass are fallbacks.
- **Bay occupancy.** Entry marks the assigned bay occupied, and exit or "moved out" frees it. A gate scan only proves the car entered the parking area; a real site would confirm the bay with sensors or a guard.
- **Charging.** Energy is calculated from the charger rating, the car's acceptance (assumed 11 kW AC and 50 kW DC for visitors) and a flat 0.9 factor. All figures are labelled as demo values and estimates.
- **Notifications.** These are in-app only: owner alerts, the operator exception queue, and visitor notices on the pass. The app sends no SMS, push or email itself.
- **Sharing.** WhatsApp opens with the message written; the system share sheet and Copy Link remain. Nothing is reported as "sent" or "delivered": the app only knows the pass was handed to WhatsApp, the share sheet or the clipboard.
- **Tracking.** The tracker follows records, not people: the share, gate scans, bay occupancy and charging. There is no location tracking.
- **Site and maps.** The compound layout, gate coordinates and security phone number are fictional. "Navigate to gate" opens Google Maps at the demo coordinates.
- **Not modelled.** Payments.

## Persistence and cross-device limits

- **Web.** Data is stored in `localStorage` for that browser profile. **Native.** It is a JSON file in the app's document directory.
- **There is no shared backend.** To make the WhatsApp flow work across phones anyway, the pass link carries the booking itself (`d=` in the link; `src/services/parking/passLink.ts`): guest name, times, bay, plate, reference, the QR code and any charging slot. On the guest's phone, the pass and its map are rebuilt from the link and the site plan, which ships with the app. A link is about 230 characters.
  - **Demo only.** Nothing signs these links, so anyone could write one. Later edits or cancellations by the host never reach a link already sent (the pass says so). Plate entry and help requests are hidden on a pass opened this way. The gate check still happens only on the device that holds the booking.
  - **Production** removes `d=` and looks the invitation up on the server.
  - **Native app:** links built in the native app use `siteInfo.nativeInviteBaseUrl` (`policy.ts`), a placeholder. Set it to the deployed web address.
- **Concurrency.** Writes are serialized in one queue, and each transaction re-reads storage first, so two simultaneous confirmations cannot both succeed (check 2). Two browser tabs committing at the same instant can still race, because `localStorage` has no lock. A server is needed for that guarantee.
- **QR tokens.** Credentials are looked up by SHA-256 hash, as a server would do. For this single-device demo the raw token is also kept on the record so the QR can be redrawn. A backend would store only the hash.

## Where real integrations connect

| Integration | Replace or connect |
| --- | --- |
| Database and API | Keep the `ParkingService` method signatures and turn each into an API call. The server runs the same rules inside a database transaction, for example PostgreSQL with `EXCLUDE USING gist (space_id WITH =, tstzrange(start, end, '[)') WITH &&)` on bay holds and row locks on chargers. It returns updated records. `ParkingRepository` and the storage adapters then go away. |
| Gate readers or ANPR | `gate.ts` `scanPass` becomes the server endpoint the reader calls. Hash the token, decide, then send the barrier-open command only on `accepted`. Never authorise from the phone's state. |
| Bay sensors | Post sensor changes to `setOccupancy`, recorded as occupancy events with their source. |
| EV chargers | Use an OCPP central system. StartTransaction and MeterValues replace `projectSession` and the charging sweep. StatusNotification `Faulted` calls `faultCharger`. Remote stop backs "Stop charging & unplug". |
| Messaging | Deliver `notifications` records through push, SMS or WhatsApp. Sending the pass from a server (for example the WhatsApp Business Platform, with an approved template in English and Arabic) adds delivery and read receipts; the tracker's "Pass shared" step would then show Delivered and Read from the webhooks. |
| Scheduled jobs | `runScheduledRules` becomes a server job running every minute. The same check also runs at every decision, as it does here. |
| Accounts and roles | Replace `DEMO_RESIDENT_ID` (`site.ts`) with the signed-in resident. The security console and demo controls need operator and admin roles. |
| Site data | `site.ts` is replaced by the compound's asset register: bays, zones, gates, coordinates, map positions and route text. |

## Acceptance checks

All 23 pass, both in Node (`npm run check:parking`) and in the app.

1. Creating a reservation removes that space from conflicting search results.
2. Simultaneous conflicting requests produce only one confirmed reservation.
3. The guest pass and internal directions show the assigned space, and an EV bay's route goes down the ramp to Basement 1.
4. Valid QR entry updates the session and occupancy.
5. Duplicate entry has no duplicate effects.
6. Wrong-gate, revoked, premature and no-show passes are rejected with clear reasons.
7. Early exit releases the remaining interval after the buffer.
8. Passing the end while still inside creates an overstay, not a false vacancy.
9. An overdue visitor can still exit.
10. Duplicate exit is harmless.
11. A completed pass cannot be reused.
12. EV booking checks both bay availability and charging capacity.
13. Incompatible or faulted chargers cannot be booked.
14. Charging completion does not imply physical vacancy.
15. Failed edits and extensions preserve the original booking, including stale edits.
16. Refreshing the app preserves state.
17. All dashboard totals reflect the same underlying data.
18. A charger fault reassigns an upcoming EV booking atomically.
19. The guest limit counts guests parked at the same moment, not back-to-back visits.
20. The owner's tracker follows the visit from booking to exit, never claims delivery, and drops "not shared yet" once the guest is in.
21. Security's expected arrivals cover the next hour and late guests still in grace, soonest first.
22. Arabic directions are written from the same route as the English ones.
23. Demo pass links carry the booking, so a guest's own phone can show the pass; damaged links are refused.

The walkthrough was also exercised end to end in Chrome at phone size: booking, sharing, the visitor pass with plate entry and help request, the gate console, the camera scanner opening, clock jumps, charging, a charger fault, reassignment, cancellation, editing and extending, and refresh persistence. This round added: the WhatsApp links in both languages (number and text checked), the tracker before and after sharing and entry, the Arabic pass, map and EV pass, Save QR in both languages (the saved code decodes to the live token), and expected arrivals through to an accepted scan.

## Notes for the next developer

- **Native not yet run.** iOS and Android were not run on a device or simulator; web was. The iOS and Android bundles build (`npx expo export --platform all`). `expo-clipboard`, `expo-crypto` and `expo-sharing` are new dependencies and all ship in Expo Go. Things to check on a phone: WhatsApp opening from the app, the share sheet for Save QR, and the Arabic layout.
- **Arabic type.** Inter has no Arabic letters, so Arabic is drawn in the system's Arabic face, as the Assistant screen already does. Arabic headings therefore show at the system face's regular weight on web.
- **Adding Arabic names.** Site names are translated by their English name in `i18n.ts` (`AR_NAMES`, `AR_GATES`, `AR_LEVELS`). A new road, zone or gate needs its Arabic name there, or it shows in English.
- **Phone numbers.** WhatsApp needs international numbers. Local Egyptian numbers are converted using `siteInfo.countryCallingCode` (`policy.ts`).
- **Camera permission text.** `app.json` now mentions pass scanning, so native builds need a rebuild to pick it up. `barcodeScannerEnabled: false` was left as it was; for SDK 57 it only applies when expo-camera is built from source on Android.
- **Booking options.** Residents' own bays are fixed assignments and are not bookable. EV energy targets are in kWh; a battery-percentage target is not offered.
