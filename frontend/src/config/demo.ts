/**
 * Sign-in is real (the EMS account), but these parts of the app do not read that account
 * yet, so three demo identities stand in for "the signed-in resident". They are separate
 * on purpose, each matching the data of the system it talks to:
 *
 * - The resident the screens show (Ahmed Hassan, Unit A-302): data/demoResident.ts.
 * - The parking demo's resident, `res-ahmed` in the parking seed data
 *   (features/parking/services/site.ts, DEMO_RESIDENT_ID): the same person, in the
 *   on-device parking store.
 * - The Parklane Assistant's resident, below: a real record on the hosted assistant
 *   backend, which only knows its own demo residents.
 *
 * TODO(auth): replace all three with the signed-in user as these parts get real data.
 */

/**
 * Who the assistant answers for. The backend's demo residents are 1001 (Youssef, H-601)
 * and 1002 (Ali, B-305); the assistant's menu switches between them. `null` asks as a guest.
 */
export const DEMO_ASSISTANT_RESIDENT_ID: number | null = 1001;
