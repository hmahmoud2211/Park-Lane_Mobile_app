# How the mobile app works: the paths

This file shows, step by step, where a resident taps in the Parklane app, using the real screen and button names.
**Bold** words are what you see on the phone.

These paths need the app build from Master `be7611d` or later: it has the "Choose a new password" screen and
gateway access through the EMS account.

Before any of this, building management has:
1. created the apartment in the admin dashboard (`/admin`), which also makes its Home Assistant and CUBE gateway,
2. created the owner's account and given the owner their email and temporary password.

See [production.md](production.md#7-create-your-first-apartment-a-pilot).

---

## 1. The owner's first sign-in

```
Open the app
  ↓  tap "Get Started"
"Sign in to your Parklane account"
  ↓  email + the temporary password from building management
"Choose a new password"
  ↓  Temporary password → New password → Confirm new password → "Save and continue"
Home
     (in the background, the app connects to the apartment's gateway by itself)
```

- The new password needs at least 10 characters. It can't be the temporary one or the email.
- Until the owner chooses it, the app shows nothing else.

## 2. Adding a device

```
Home
  ↓  "Smart Home"  (Control your unit)
Smart Home
  ↓  "Add device"           (or "My Devices" → "Add")
"Add Device"  – Choose who made your device
  ↓  tap the brand (search with "Search brands")
"How do you want to connect?"
  ├─ "Pair it from the start"          → through the GATEWAY
  │     ├─ "Find existing device"      (already on your home Wi-Fi)
  │     └─ "Connect new device"        (new or reset device)
  │
  └─ "Manufacturer account (cloud)"    → through HOME ASSISTANT
        ↓ sign in to the brand (Tuya, SmartThings, eWeLink…)
        "Account linked" → the devices appear in "My Devices"
```

- At the bottom of **Add Device**, **"Link a manufacturer account"** opens **"Connect Devices"**. It is the same
  brand-account linking.
- Devices that work only on the home Wi-Fi (Tasmota, ESPHome, TP-Link…) need a tunnel box in the apartment before
  "Pair it from the start" can find them, because the gateway runs on the server.

## 3. The gateway page (owner)

```
Smart Home → "My Devices" → "Gateway settings"
"CUBE Gateway"
  ├─ "Your apartment's gateway"   – connected through "Your account"
  ├─ "Members"                     – everyone in the apartment ("Remove" for owners)
  ├─ "Invite family"               – choose Member or Owner → "Create invite code" → "Share"
  ├─ "Phones"                      – "This phone" and the others ("Remove")
  ├─ "Lost a phone?"               – "Sign out my other phones"
  └─ "Installer setup"             – only for installers (setup codes, QR)
```

| Who | Can do |
|---|---|
| **Owner** | Use the devices, invite and remove people, remove phones, manage the gateway |
| **Member** | Use the devices, sign out their own other phones |

## 4. A family member joins

```
Open the app → "Get Started"
  ↓  creates their own account ("Create your Parklane account") and signs in
Smart Home → "Add device"
  ↓  "Connect your CUBE Gateway first" → "Connect gateway"
"CUBE Gateway" → "Join an apartment"
  ↓  type the "Invite code" from the owner → "Join apartment"
Now a member: the gateway connects by itself and the apartment's devices appear
```

- An invite code works **once** and for **24 hours**.
- Every family member uses **their own account**, never the owner's.

## 5. A lost phone

```
Sign in on another phone
  ↓
Smart Home → "My Devices" → "Gateway settings" → "CUBE Gateway"
  ├─ Owner:  "Phones" → "Remove" next to the lost phone   → access ends at once
  └─ Anyone: "Lost a phone?" → "Sign out my other phones"  → the others lose access within 5 minutes
Then change the password.
```

Removing the phone also ends its sign-in, so it can't connect again.

## 6. Using devices every day

```
Home → "Smart Home" → "My Devices" → tap a device → control it
```

---

## What happens behind the screens

| Step in the app | What happens |
|---|---|
| Sign in | The EMS backend checks the account. A temporary password allows only "Choose a new password". |
| Connecting to the gateway | The app gets a 5-minute pass, signed by the backend. It shows the pass to the apartment's gateway through the relay, and the gateway gives this phone its own key. |
| Every 5 minutes | The gateway asks the backend who still lives in the apartment. It removes the phones of people who left and of sign-ins that ended. |
| A brand account | The apartment's Home Assistant links it, and its devices show up in "My Devices". |
