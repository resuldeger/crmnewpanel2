"use client";

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { parsePhoneNumberFromString, getCountries, getCountryCallingCode, CountryCode } from 'libphonenumber-js';
import { getStudioCountry } from '../utils/validation';
import { t } from '../hooks/useBookingConfig';

export interface CountryItem {
  code: CountryCode;
  name: string;
  dial: string;
  flag: string;
}

function getFlagEmoji(countryCode: string): string {
  if (countryCode === 'TA') return '🏴󠁧󠁢󠁥󠁮󠁧󠁿';
  try {
    const codePoints = countryCode
      .toUpperCase()
      .split('')
      .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
  } catch {
    return '🌐';
  }
}

// Build static localized country list
const displayNames = typeof Intl !== 'undefined' && Intl.DisplayNames ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;

export const ALL_COUNTRIES: CountryItem[] = getCountries().map((code): CountryItem => {
  let name: string = code;
  try {
    name = displayNames?.of(code) ?? code;
  } catch {
    /* Intl has no entry for this region — fall back to the ISO code */
  }
  let dial = '';
  try {
    dial = '+' + getCountryCallingCode(code);
  } catch {}
  return {
    code,
    name,
    dial,
    flag: getFlagEmoji(code),
  };
}).filter(c => Boolean(c.dial)).sort((a, b) => a.name.localeCompare(b.name));

// Priority quick-access countries
const PRIORITY_CODES: CountryCode[] = ['US', 'TR', 'GB', 'DE', 'FR', 'NL', 'ES', 'IT', 'AE', 'CA', 'AU'];
const PRIORITY_COUNTRIES = PRIORITY_CODES.map(c => ALL_COUNTRIES.find(item => item.code === c)).filter(Boolean) as CountryItem[];

// Countries sorted by longest dial code first for robust matching
const COUNTRIES_BY_DIAL_LENGTH = [...ALL_COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);

export const matchCountryFromPlus = (withPlus: string): CountryCode | null => {
  if (!withPlus.startsWith('+')) return null;

  // Exact known top dial prefixes
  if (withPlus.startsWith('+1')) return 'US';
  if (withPlus.startsWith('+90')) return 'TR';
  if (withPlus.startsWith('+44')) return 'GB';
  if (withPlus.startsWith('+49')) return 'DE';
  if (withPlus.startsWith('+33')) return 'FR';
  if (withPlus.startsWith('+39')) return 'IT';
  if (withPlus.startsWith('+34')) return 'ES';
  if (withPlus.startsWith('+31')) return 'NL';
  if (withPlus.startsWith('+971')) return 'AE';
  if (withPlus.startsWith('+966')) return 'SA';
  if (withPlus.startsWith('+61')) return 'AU';

  // Generic match by longest dial prefix
  const match = COUNTRIES_BY_DIAL_LENGTH.find(c => withPlus.startsWith(c.dial));
  return match ? match.code : null;
};

export const detectCountryFromPhone = (phone: string, fallbackCountry: CountryCode = getStudioCountry()): CountryCode => {
  if (!phone) return fallbackCountry;
  const str = phone.trim();

  // Explicit '+' or '00' international dialing
  if (str.startsWith('+') || str.startsWith('00')) {
    const raw = str.startsWith('00') ? '+' + str.slice(2).replace(/\D/g, '') : '+' + str.replace(/\D/g, '');
    const matched = matchCountryFromPlus(raw);
    if (matched) return matched;

    const p = parsePhoneNumberFromString(raw);
    if (p && p.country) {
      if (['GG', 'JE', 'IM'].includes(p.country)) return 'GB';
      return p.country;
    }
  }

  return fallbackCountry;
};

// Dynamic national format placeholders per country
const COUNTRY_NATIONAL_PLACEHOLDERS: Record<string, string> = {
  TR: '5XX XXX XX XX',
  US: '(305) 555-5555',
  CA: '(416) 555-0199',
  GB: '7911 123456',
  DE: '150 0000000',
  FR: '6 12 34 56 78',
  ES: '600 000 000',
  IT: '312 345 6789',
  NL: '6 12345678',
  AE: '50 123 4567',
  SA: '50 123 4567',
  AU: '412 345 678',
  RU: '912 345-67-89',
  KZ: '701 234 5678',
  CH: '79 123 45 67',
  AT: '664 123456',
  BE: '470 12 34 56',
  SE: '70 123 45 67',
  NO: '412 34 567',
  DK: '20 12 34 56',
  GR: '691 234 5678',
  PT: '912 345 678',
  PL: '512 345 678',
  RO: '712 345 678',
  UA: '50 123 4567',
  IE: '87 123 4567',
};

interface PhoneInputFieldProps {
  label: string;
  value: string;
  onChange: (e164Value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  error?: string;
  translations?: Record<string, Record<string, string>>;
  /**
   * The studio's country, from /api/booking/config. Passed as a prop rather
   * than read from a module global because the config arrives after the
   * first render, and the country was captured in a useState initialiser
   * that never ran again — an Atlanta page kept whatever was guessed
   * before the studio was known.
   */
  defaultCountry?: CountryCode;
}

export const PhoneInputField: React.FC<PhoneInputFieldProps> = ({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  error,
  translations,
  defaultCountry,
}) => {
  const [selectedCountry, setSelectedCountry] = useState<CountryCode>(() =>
    detectCountryFromPhone(value, defaultCountry ?? getStudioCountry()),
  );
  /** Once the visitor picks a country themselves, stop overriding them. */
  const chosenByUser = useRef(false);

  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Adopt the studio's country when the config lands — unless the visitor
  // has already chosen one, or has typed an international number.
  useEffect(() => {
    if (!defaultCountry || chosenByUser.current) return;
    if (value && (value.startsWith('+') || value.startsWith('00'))) return;
    setSelectedCountry(prev => (prev === defaultCountry ? prev : defaultCountry));
  }, [defaultCountry, value]);

  // Sync selected country if an explicit international '+' number is passed
  useEffect(() => {
    if (value && (value.startsWith('+') || value.startsWith('00'))) {
      const detected = detectCountryFromPhone(value, selectedCountry);
      if (detected && detected !== selectedCountry) {
        setSelectedCountry(detected);
      }
    }
  }, [value]);

  const currentCountryItem = useMemo(() => {
    return ALL_COUNTRIES.find(c => c.code === selectedCountry) || ALL_COUNTRIES.find(c => c.code === 'US') || ALL_COUNTRIES[0];
  }, [selectedCountry]);

  // Focus search input and prevent background scroll when modal opens
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    } else {
      document.body.style.overflow = '';
      setSearchQuery('');
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Filter countries by search query
  const filteredCountries = useMemo(() => {
    if (!searchQuery.trim()) return ALL_COUNTRIES;
    const q = searchQuery.toLowerCase().trim();
    return ALL_COUNTRIES.filter(c => 
      c.name.toLowerCase().includes(q) || 
      c.dial.includes(q) || 
      c.code.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  // Handle user input changes (Typing, Autofill, Paste)
  const handleInputChange = (raw: string) => {
    if (!raw) {
      onChange('');
      return;
    }

    const trimmed = raw.trim();

    // 1. If user types/pastes with '+' or '00' (e.g. +1936..., +4479..., +4917..., +9055...)
    if (trimmed.startsWith('+') || trimmed.startsWith('00')) {
      const rawDigits = trimmed.startsWith('00') ? trimmed.slice(2).replace(/\D/g, '') : trimmed.replace(/\D/g, '');
      const withPlus = '+' + rawDigits;
      
      const matched = matchCountryFromPlus(withPlus);
      if (matched && matched !== selectedCountry) {
        setSelectedCountry(matched);
      }

      const p = parsePhoneNumberFromString(withPlus);
      onChange(p && p.isValid() ? p.format('E.164') : withPlus);
      return;
    }

    // 2. National input: Strip all non-digits and use the selected country
    const cleanDigits = trimmed.replace(/\D/g, '');
    if (!cleanDigits) {
      onChange('');
      return;
    }

    const dial = '+' + getCountryCallingCode(selectedCountry);
    const p = parsePhoneNumberFromString(cleanDigits, selectedCountry);
    if (p && p.isValid()) {
      onChange(p.format('E.164'));
      return;
    }

    // While typing incrementally: attach current country calling code
    onChange(dial + cleanDigits);
  };

  const handleSelectCountry = (country: CountryItem) => {
    // An explicit choice outranks the studio default from here on.
    chosenByUser.current = true;
    setSelectedCountry(country.code);
    setIsOpen(false);

    if (value) {
      const digits = value.replace(/\D/g, '');
      const oldDialDigits = currentCountryItem.dial.replace(/\D/g, '');
      const nationalOnly = digits.startsWith(oldDialDigits) ? digits.slice(oldDialDigits.length) : digits;
      if (nationalOnly) {
        const parsed = parsePhoneNumberFromString(nationalOnly, country.code);
        if (parsed && parsed.isValid()) {
          onChange(parsed.format('E.164'));
        } else {
          onChange(country.dial + nationalOnly);
        }
      }
    }
  };

  // Compute clean subscriber number for the input display
  const displayValue = useMemo(() => {
    if (!value) return '';
    const str = value.trim();

    // If starts with dial code (+XX), show only subscriber part
    const dial = currentCountryItem.dial;
    if (str.startsWith(dial)) {
      return str.slice(dial.length).trim();
    }

    if (str.startsWith('+')) {
      const p = parsePhoneNumberFromString(str);
      if (p?.nationalNumber) return p.nationalNumber;
      return str;
    }

    return str;
  }, [value, currentCountryItem]);

  const activePlaceholder = useMemo(() => {
    if (COUNTRY_NATIONAL_PLACEHOLDERS[selectedCountry]) {
      return COUNTRY_NATIONAL_PLACEHOLDERS[selectedCountry];
    }
    if (placeholder) return placeholder;
    return 'XXX XXX XXXX';
  }, [selectedCountry, placeholder]);

  return (
    <div className="space-y-1.5 group">
      <label className="text-[10px] font-black uppercase text-zinc-500 group-focus-within:text-[#FFBE4E] tracking-widest ml-1 transition-colors">
        {label}
      </label>

      {/* Main Input Container */}
      <div className={`field-shell relative flex items-center bg-zinc-950/60 border-2 rounded-xl transition-all duration-300 ${
        error ? 'border-red-500/50 bg-red-950/10' : 'border-zinc-800 focus-within:border-[#FFBE4E] focus-within:bg-zinc-900/40'
      }`}>
        {/* Country Selector Button */}
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-1.5 px-3 py-3.5 border-r border-zinc-800/80 hover:bg-zinc-900/80 transition-colors text-white text-xs font-semibold rounded-l-xl select-none flex-shrink-0"
        >
          <span className="text-lg leading-none">{currentCountryItem.flag}</span>
          <span className="text-zinc-300 font-mono tracking-tight">{currentCountryItem.dial}</span>
          <svg className="w-3 h-3 text-zinc-500 group-hover:text-[#FFBE4E] transition-colors ml-0.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>

        {/* Subscriber Phone Input */}
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={displayValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onBlur={onBlur}
          placeholder={activePlaceholder}
          className="w-full bg-transparent p-3.5 text-sm text-white placeholder:text-zinc-700 outline-none font-medium"
        />
      </div>

      {error && (
        <p className="text-[10px] font-bold text-red-400 ml-1 uppercase tracking-tight italic">
          {error}
        </p>
      )}

      {/* React Portal Mounts Directly to document.body */}
      {isOpen && typeof document !== 'undefined' && createPortal(
        <div 
          className="fixed inset-0 z-[9999999] bg-[#050505] flex flex-col pt-[max(env(safe-area-inset-top),16px)] pb-[max(env(safe-area-inset-bottom),16px)] sm:p-6 sm:items-center sm:justify-center sm:bg-black/90 sm:backdrop-blur-2xl animate-in fade-in duration-200"
          onClick={() => setIsOpen(false)}
        >
          <div 
            className="w-full h-full sm:h-auto sm:max-w-lg bg-[#0d0d11] sm:border sm:border-zinc-800 sm:rounded-3xl sm:max-h-[80vh] flex flex-col shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-zinc-800/90 flex items-center justify-between bg-[#111116] flex-shrink-0">
              <div>
                <h3 className="text-base font-black text-white tracking-wide flex items-center gap-2">
                  <span>{t(translations, 'ui.country_picker', 'title', 'Select Country')}</span>
                  <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-[#FFBE4E]/15 text-[#FFBE4E] font-mono border border-[#FFBE4E]/30 font-bold">245</span>
                </h3>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  {t(translations, 'ui.country_picker', 'subtitle', 'Choose your international calling code')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="w-9 h-9 rounded-full bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 flex items-center justify-center text-zinc-300 hover:text-white transition-colors"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* Search Input Box */}
            <div className="p-3.5 border-b border-zinc-800/80 bg-[#0a0a0d] flex-shrink-0">
              <div className="relative">
                <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t(translations, 'ui.country_picker', 'search_placeholder', 'Search country or dial code (e.g. Turkey, +90, US)...')}
                  className="w-full bg-zinc-900/90 border border-zinc-700/80 rounded-xl pl-10 pr-12 py-3 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-[#FFBE4E] transition-all"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-zinc-400 hover:text-white px-2 py-0.5 rounded bg-zinc-800"
                  >
                    {t(translations, 'ui.country_picker', 'clear', 'Clear')}
                  </button>
                )}
              </div>
            </div>

            {/* Countries Scroll Area */}
            <div className="flex-1 overflow-y-auto divide-y divide-zinc-900/80 p-2 custom-scrollbar">
              {/* Quick Access Top Countries when not searching */}
              {!searchQuery && (
                <div className="p-2">
                  <span className="text-[10px] font-black uppercase text-zinc-400 tracking-wider px-1 block mb-2">
                    ⭐ {t(translations, 'ui.country_picker', 'popular', 'Popular Destinations')}
                  </span>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    {PRIORITY_COUNTRIES.map(c => (
                      <button
                        key={'priority-' + c.code}
                        type="button"
                        onClick={() => handleSelectCountry(c)}
                        className={`flex items-center gap-2.5 p-3 rounded-xl text-left transition-all ${
                          selectedCountry === c.code 
                            ? 'bg-[#FFBE4E]/20 border border-[#FFBE4E] text-[#FFBE4E] shadow-sm shadow-[#FFBE4E]/10' 
                            : 'bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800/80 text-zinc-200'
                        }`}
                      >
                        <span className="text-2xl leading-none">{c.flag}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold truncate leading-tight">{c.name}</p>
                          <span className="text-[10px] font-mono text-zinc-400">{c.dial}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                  <div className="border-t border-zinc-800/80 my-3" />
                  <span className="text-[10px] font-black uppercase text-zinc-400 tracking-wider px-1 block mb-1">
                    {t(translations, 'ui.country_picker', 'all', 'All Countries (A-Z)')}
                  </span>
                </div>
              )}

              {filteredCountries.length === 0 ? (
                <div className="py-16 text-center text-zinc-500 text-sm">
                  {t(translations, 'ui.country_picker', 'no_results', 'No countries found matching')} "{searchQuery}"
                </div>
              ) : (
                filteredCountries.map(c => {
                  const isSelected = selectedCountry === c.code;
                  return (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => handleSelectCountry(c)}
                      className={`w-full flex items-center justify-between px-4 py-3 rounded-xl hover:bg-zinc-900/90 transition-colors text-left ${
                        isSelected ? 'bg-[#FFBE4E]/15 text-[#FFBE4E]' : 'text-zinc-300'
                      }`}
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <span className="text-2xl leading-none">{c.flag}</span>
                        <div className="min-w-0">
                          <p className={`text-sm font-semibold truncate ${isSelected ? 'text-[#FFBE4E]' : 'text-white'}`}>{c.name}</p>
                          <p className="text-[10px] text-zinc-500 font-mono">{c.code}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5 flex-shrink-0">
                        <span className="text-xs font-mono font-bold text-zinc-400">{c.dial}</span>
                        {isSelected && (
                          <svg className="w-4 h-4 text-[#FFBE4E]" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
