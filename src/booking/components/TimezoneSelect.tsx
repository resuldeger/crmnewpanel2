"use client";


import React, { useState, useMemo, useEffect, useRef } from 'react';
import { t } from '../hooks/useBookingConfig';

const strictTimezoneData = [
  {
    group: "US/Canada",
    key: "us_canada",
    options: [
      { label: "Pacific Time - US & Canada", key: "pacific_time", zone: "America/Los_Angeles" },
      { label: "Mountain Time - US & Canada", key: "mountain_time", zone: "America/Denver" },
      { label: "Central Time - US & Canada", key: "central_time", zone: "America/Chicago" },
      { label: "Eastern Time - US & Canada", key: "eastern_time", zone: "America/New_York" },
      { label: "Alaska Time", key: "alaska_time", zone: "America/Anchorage" },
      { label: "Arizona, Yukon Time", key: "arizona_time", zone: "America/Phoenix" },
      { label: "Newfoundland Time", key: "newfoundland_time", zone: "America/St_Johns" },
      { label: "Hawaii Time", key: "hawaii_time", zone: "Pacific/Honolulu" },
    ],
  },
  {
    group: "Europe",
    key: "europe",
    options: [
      { label: "Central European Time", key: "central_europe", zone: "Europe/Paris" },
      { label: "Eastern European Time", key: "eastern_europe", zone: "Europe/Bucharest" },
      { label: "UK, Ireland, Lisbon Time", key: "uk_ireland", zone: "Europe/London" },
      { label: "Minsk Time", key: "minsk_time", zone: "Europe/Minsk" },
      { label: "Moscow Time", key: "moscow_time", zone: "Europe/Moscow" },
      { label: "Turkey Time", key: "turkey_time", zone: "Europe/Istanbul" },
    ],
  },
  {
    group: "Asia",
    key: "asia",
    options: [
      { label: "Dubai Time", key: "dubai_time", zone: "Asia/Dubai" },
      { label: "Japan, Korea Time", key: "tokyo_time", zone: "Asia/Tokyo" },
      { label: "China, Singapore, Perth", key: "shanghai_time", zone: "Asia/Shanghai" },
      { label: "India, Sri Lanka Time", key: "india_time", zone: "Asia/Kolkata" },
    ],
  },
];

interface TimezoneSelectProps {
  value: string;
  onChange: (val: string) => void;
  translations: Record<string, Record<string, string>> | undefined;
}

const TimezoneSelect: React.FC<TimezoneSelectProps> = ({ value, onChange, translations }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [now, setNow] = useState(new Date());
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getTimeForZone = (zone: string) => {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: zone
      }).format(now);
    } catch {
      return '--:--';
    }
  };

  const filteredData = useMemo(() => {
    if (!searchTerm) return strictTimezoneData;
    const term = searchTerm.toLowerCase();
    return strictTimezoneData.map(group => ({
      ...group,
      options: group.options.filter(opt => 
        opt.label.toLowerCase().includes(term) || 
        opt.zone.toLowerCase().includes(term) ||
        t(translations, 'tz.labels', opt.key, opt.label).toLowerCase().includes(term)
      )
    })).filter(group => group.options.length > 0);
  }, [searchTerm, translations]);

  const selectedLabel = useMemo(() => {
    for (const group of strictTimezoneData) {
      const found = group.options.find(opt => opt.zone === value);
      if (found) {
        const localizedLabel = t(translations, 'tz.labels', found.key, found.label);
        return `${localizedLabel} (${getTimeForZone(value)})`;
      }
    }
    return value;
  }, [value, now, translations]);

  return (
    <div className="relative" ref={containerRef}>
      <label className="text-[10px] font-black uppercase text-zinc-600 mb-2 block tracking-widest ml-1">
        {t(translations, 'ui.labels', 'timezone', 'Time zone')}
      </label>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full bg-zinc-950/40 border-2 border-zinc-900 rounded-xl p-4 text-xs font-bold text-zinc-400 flex items-center justify-between hover:border-zinc-800 transition-all"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">🌍</span>
          <span>{selectedLabel}</span>
        </div>
        <svg 
          className={`w-4 h-4 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} 
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 w-full mb-2 bg-[#0c0c0c] border-2 border-zinc-800 rounded-2xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="p-3 border-b border-zinc-900 bg-black/40">
             <div className="relative group/search">
               <input 
                 type="text"
                 placeholder={t(translations, 'ui.labels', 'search_timezone', 'Search time zone...')}
                 value={searchTerm}
                 onChange={(e) => setSearchTerm(e.target.value)}
                 className="w-full bg-zinc-950/60 border border-zinc-800 rounded-xl py-2.5 pl-10 pr-4 text-xs font-bold outline-none focus:border-[#FFBE4E]/40 focus:bg-zinc-950 transition-all placeholder:text-zinc-700"
                 autoFocus
               />
               <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600 transition-colors group-focus-within/search:text-[#FFBE4E]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                 <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
               </svg>
             </div>
          </div>
          <div className="max-h-60 overflow-y-auto custom-scrollbar">
            {filteredData.length > 0 ? (
              filteredData.map((group) => (
                <div key={group.group} className="p-1">
                  <div className="px-4 py-2 text-[8px] font-black uppercase tracking-widest text-[#FFBE4E] opacity-50">
                    {t(translations, 'tz.groups', group.key, group.group)}
                  </div>
                  {group.options.map((opt) => (
                    <button
                      key={opt.zone}
                      onClick={() => {
                        onChange(opt.zone);
                        setIsOpen(false);
                        setSearchTerm('');
                      }}
                      className={`w-full text-left px-4 py-3 text-[11px] font-bold transition-colors flex items-center justify-between ${
                        value === opt.zone 
                          ? 'bg-[#FFBE4E] text-black' 
                          : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span>{t(translations, 'tz.labels', opt.key, opt.label)}</span>
                      </div>
                      <span className={`font-mono text-[10px] ${value === opt.zone ? 'text-black/60' : 'text-zinc-500'}`}>
                        {getTimeForZone(opt.zone)}
                      </span>
                    </button>
                  ))}
                </div>
              ))
            ) : (
              <div className="p-8 text-center">
                <p className="text-xs font-bold text-zinc-600 italic">{t(translations, 'ui.labels', 'no_results', 'No zones found')}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TimezoneSelect;
