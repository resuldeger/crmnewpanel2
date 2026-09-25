import { useEffect, useState } from "react";
import { api } from "./env";

export interface StudioSummary {
  id: number;
  slug: string;
  name: string;
  address: string | null;
  city: string;
  state: string | null;
  country: string;
  imageUrl: string | null;
  timezone: string;
  bookingActive: boolean;
}

export function useStudios() {
  const [studios, setStudios] = useState<StudioSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(api("/api/booking/locations"))
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: { locations: StudioSummary[] }) => alive && setStudios(d.locations))
      .catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, []);

  return { studios, error, loading: studios === null && error === null };
}
