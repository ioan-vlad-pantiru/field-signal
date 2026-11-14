import type { Crop, FieldRequest, LatLon } from "@/lib/contracts";

/** Most fields analysed together, so one run stays quick and gentle on the API. */
export const MAX_FIELDS = 10;

/** One field in the intake: what was drawn and its rotation. Priorities are shared by all fields. */
export interface DraftField {
  boundary: LatLon[];
  /** Further pieces of the same field: parcels picked together that do not touch the boundary. */
  parts?: LatLon[][];
  /** Centroid, rounded; the API answers for this point. */
  point: LatLon;
  rotation: Crop[];
  /** Commune picked in the search, from the feed link or the saved field. */
  place: string | null;
  /** Set when the field comes from (or was saved to) My fields. */
  accountId: string | null;
  /** The farmer's name for it, from My fields. */
  name: string | null;
}

/** A field ready to analyse. */
export interface SubmittedField {
  request: FieldRequest;
  boundary: LatLon[];
  parts?: LatLon[][];
  place: string | null;
  accountId: string | null;
  name: string | null;
}

export function toDraft(field: SubmittedField): DraftField {
  return {
    boundary: field.boundary,
    parts: field.parts,
    point: field.request.location,
    rotation: [...field.request.current_rotation],
    place: field.place,
    accountId: field.accountId,
    name: field.name,
  };
}
