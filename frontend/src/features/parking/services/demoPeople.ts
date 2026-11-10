import type { Entity, Property, PropertyAssociation, Resident, Vehicle } from './types';

/**
 * The offline parking demo's made-up people: two residents, their apartments and cars. Only the demo's seed
 * (seed.ts) and its provider use them; the app's real parking comes from the backend, so the store build never
 * includes this file. Names, phones and plates here are fictional.
 */

type Def<T extends Entity> = Omit<T, 'createdAt' | 'updatedAt' | 'version'>;

/** The demo security desk and invitation address (the backend's real ones come with its snapshot). */
export const DEMO_SECURITY_PHONE = '+20 2 0000 0100';
export const DEMO_INVITE_BASE_URL = 'https://parklane-demo.example';

export const residentDefs: Def<Resident>[] = [
  { id: 'res-ahmed', name: 'Ahmed Hassan', phone: '+20 10 0000 0302', email: 'ahmed.demo@example.com' },
  { id: 'res-laila', name: 'Laila Mansour', phone: '+20 11 0000 0705', email: 'laila.demo@example.com' },
];

export const propertyDefs: Def<Property>[] = [
  { id: 'prop-a302', label: 'Apartment A-302', buildingId: 'bld-a', assignedSpaceId: 'sp-P2-148', mapEntrance: { x: 90, y: 98 } },
  { id: 'prop-b1104', label: 'Apartment B-1104', buildingId: 'bld-b', mapEntrance: { x: 270, y: 98 } },
  { id: 'prop-c0705', label: 'Apartment C-0705', buildingId: 'bld-c', mapEntrance: { x: 90, y: 208 } },
];

export const associationDefs: Def<PropertyAssociation>[] = [
  { id: 'asc-1', residentId: 'res-ahmed', propertyId: 'prop-a302', role: 'owner' },
  { id: 'asc-2', residentId: 'res-ahmed', propertyId: 'prop-b1104', role: 'owner' },
  { id: 'asc-3', residentId: 'res-laila', propertyId: 'prop-c0705', role: 'owner' },
];

export const vehicleDefs: Def<Vehicle>[] = [
  { id: 'veh-bmw', residentId: 'res-ahmed', make: 'BMW', model: 'X5 xDrive', colour: 'Black', plate: 'EGY 5678', plateCountry: 'Egypt' },
  {
    id: 'veh-ioniq',
    residentId: 'res-ahmed',
    make: 'Hyundai',
    model: 'Ioniq 5',
    colour: 'White',
    plate: 'EGY 2468',
    plateCountry: 'Egypt',
    ev: { connectors: ['Type 2', 'CCS2'], maxAcKw: 11, maxDcKw: 220, batteryKwh: 77 },
  },
  {
    id: 'veh-ev6',
    residentId: 'res-laila',
    make: 'Kia',
    model: 'EV6',
    colour: 'Grey',
    plate: 'EGY 1357',
    plateCountry: 'Egypt',
    ev: { connectors: ['Type 2', 'CCS2'], maxAcKw: 11, maxDcKw: 230, batteryKwh: 77 },
  },
];

/** The signed-in resident until the app has real accounts. */
export const DEMO_RESIDENT_ID = 'res-ahmed';
