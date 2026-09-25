import { parsePhoneNumberFromString, getCountryCallingCode, CountryCode } from 'libphonenumber-js';

/**
 * Default country for the phone field.
 *
 * The studio wins. A booking page for Atlanta must offer +1, whatever
 * timezone the visitor happens to be browsing from — the previous order
 * put the visitor's device first, so anyone in Istanbul looking at an
 * Atlanta studio got +90 and a US number typed as 4045559876 was stored
 * as +904045559876: unreachable, and no SMS would ever arrive.
 *
 * The visitor can still change the country from the flag dropdown; this
 * only decides what is selected before they touch it.
 *
 *   1. studio country, from /api/booking/config
 *   2. region of the browser locale (tr-TR → TR)
 *   3. 'US'
 */
let studioCountryCode: CountryCode | null = null;

/** "tr-TR" → "TR". Ignores a bare "tr", which names no region. */
const regionFromNavigator = (): CountryCode | null => {
  try {
    const tag = typeof navigator !== 'undefined' ? navigator.language : '';
    const region = tag?.split('-')[1]?.toUpperCase();
    return region && /^[A-Z]{2}$/.test(region) ? (region as CountryCode) : null;
  } catch {
    return null;
  }
};

export const getStudioCountry = (): CountryCode => {
  if (studioCountryCode) return studioCountryCode;
  return regionFromNavigator() ?? 'US';
};

/** Set as soon as /api/booking/config resolves, before the field renders. */
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
