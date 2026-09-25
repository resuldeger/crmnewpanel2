// src/hooks/useAvailability.ts
import { useState, useEffect } from 'react';

export interface SlotInfo {
  time: string;
  booked: boolean;
}

export interface DayAvailability {
  available: boolean;
  slots: SlotInfo[];
}

export interface AvailabilityData {
  location_id: number;
  month: string;
  timezone: string;
  availability: Record<string, DayAvailability>;
}

export interface UseAvailabilityResult {
  data: AvailabilityData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const availabilityCache = new Map<string, AvailabilityData>();

export function useAvailability(
  locationSlug: string, 
  month: string, 
  timezone?: string
): UseAvailabilityResult {
  const [data, setData] = useState<AvailabilityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const fetchAvailability = async () => {
      if (!locationSlug || !month) return;
      
      const cacheKey = `${locationSlug}_${month}_${timezone ?? 'default'}`;
      
      // Serve from memory cache if available (unless manual refetch tick changed)
      if (availabilityCache.has(cacheKey) && tick === 0) {
        setData(availabilityCache.get(cacheKey)!);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const tzParam = timezone ? `&timezone=${encodeURIComponent(timezone)}` : '';
        const response = await fetch(`/api/booking/availability/${locationSlug}?month=${month}${tzParam}`);
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        availabilityCache.set(cacheKey, result);
        setData(result);
      } catch (err: any) {
        console.error('Failed to fetch availability:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchAvailability();
  }, [locationSlug, month, timezone, tick]);

  const refetch = () => {
    availabilityCache.clear();
    setTick((n) => n + 1);
  };

  return { data, loading, error, refetch };
}
