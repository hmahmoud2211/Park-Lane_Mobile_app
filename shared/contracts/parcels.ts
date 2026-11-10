/** Parcels: GET /api/parcels (residents of the unit); /api/security/parcels… (gate staff and admins). */

export type ParcelStatus = 'waiting' | 'collected' | 'returned';

export interface Parcel {
  id: string;
  reference: string;
  carrier: string | null;
  description: string | null;
  status: ParcelStatus;
  receivedAt: string;
  closedAt: string | null;
}

/** The same, as gate staff see it: with the unit. */
export interface StaffParcel extends Parcel {
  unitId: string;
  unitName: string;
}
