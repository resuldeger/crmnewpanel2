import { parsePhoneNumberFromString, getCountryCallingCode, CountryCode } from 'libphonenumber-js';

/**
 * Resolves country code with User-First Priority:
 * 1. User's device timezone / location (e.g. Istanbul -> 'TR', London -> 'GB', Berlin -> 'DE', America -> 'US')
 * 2. Studio / booking location country code (e.g. 'US' or 'TR')
 * 3. Default fallback ('US')
 */
let studioCountryCode: CountryCode | null = null;

export const getStudioCountry = (): CountryCode => {
  try {
    // 1. ÖNCE KULLANICI: Cihaz saat dilimi
    const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || '').toLowerCase();
    if (tz.includes('istanbul') || tz.includes('turkey')) return 'TR';
    if (tz.includes('london') || tz.includes('belfast')) return 'GB';
    if (tz.includes('berlin')) return 'DE';
    if (tz.includes('paris')) return 'FR';
    if (tz.includes('rome')) return 'IT';
    if (tz.includes('madrid')) return 'ES';
    if (tz.includes('amsterdam')) return 'NL';
    if (tz.includes('dubai')) return 'AE';
    if (tz.includes('riyadh')) return 'SA';
    if (tz.includes('toronto') || tz.includes('vancouver')) return 'CA';
    if (tz.includes('sydney') || tz.includes('melbourne')) return 'AU';
    if (tz.includes('america') || tz.includes('new_york') || tz.includes('chicago') || tz.includes('los_angeles') || tz.includes('denver') || tz.includes('phoenix')) return 'US';
  } catch {}

  // 2. Fall back to the studio's own country, published by the config API
  //    (this used to read a `window.__BOOKING_LOCATION__` global that only
  //    existed when Laravel rendered the page).
  if (studioCountryCode) return studioCountryCode;

  return 'US';
};

/** Set once, as soon as /api/booking/config resolves. */
export const setStudioCountry = (code: string | null | undefined): void => {
  studioCountryCode = code ? (code.toUpperCase() as CountryCode) : null;
};

/**
 * Pure Deterministic E.164 Phone Normalizer:
 * 1. If explicit '+' or '00': Strips parentheses, dashes, spaces and formats cleanly.
 * 2. If national number: Strips all non-digits and uses studioCountry (NO guessing).
 */
export const toE164Phone = (val: string, studioCountry: CountryCode = getStudioCountry()): string => {
  if (!val) return '';
  const str = val.trim();

  // 1. Explicit '+' or '00'
  if (str.startsWith('+') || str.startsWith('00')) {
    const raw = str.startsWith('00') ? str.slice(2) : str;
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '+';
    
    const withPlus = '+' + digits;
    const p = parsePhoneNumberFromString(withPlus);
    if (p && p.isValid()) {
      return p.format('E.164');
    }
    return withPlus;
  }

  // 2. National number -> Use ONLY the studioCountry (NO character length guessing)
  const clean = str.replace(/\D/g, '');
  if (!clean) return str;

  const pStudio = parsePhoneNumberFromString(clean, studioCountry);
  if (pStudio && pStudio.isValid()) {
    return pStudio.format('E.164');
  }

  const dial = '+' + getCountryCallingCode(studioCountry);
  return dial + clean;
};

export const normalizePhoneForForm = (phone: string): string => {
  return toE164Phone(phone);
};

export const formatLivePhone = (val: string, studioCountry: CountryCode = getStudioCountry()): string => {
  return toE164Phone(val, studioCountry);
};

/**
 * Strict Phone Validation
 */
export const isValidPhone = (phone: string, studioCountry: CountryCode = getStudioCountry()): boolean => {
  if (!phone || phone.trim().length < 3) return false;
  const str = phone.trim();

  if (str.startsWith('+') || str.startsWith('00')) {
    const raw = str.startsWith('00') ? '+' + str.slice(2) : str;
    const digits = raw.replace(/\D/g, '');
    const p = parsePhoneNumberFromString('+' + digits);
    return p?.isValid() ?? false;
  }

  const clean = str.replace(/\D/g, '');
  const pStudio = parsePhoneNumberFromString(clean, studioCountry);
  return pStudio?.isValid() ?? false;
};

export const isValidFullName = (name: string): boolean => name.trim().length >= 2;
export const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
