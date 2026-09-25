"use client";


import React from 'react';

interface FormInputProps {
  label: string;
  type?: string;
  inputMode?: 'text' | 'tel' | 'email' | 'numeric' | 'decimal' | 'search' | 'url' | 'none';
  value: string;
  onChange: (val: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  icon?: React.ReactNode;
  error?: string;
  autoComplete?: string;
  prefix?: string;
}

const FormInput: React.FC<FormInputProps> = ({ 
  label, 
  type = 'text', 
  inputMode,
  value, 
  onChange, 
  onBlur, 
  placeholder, 
  icon, 
  error, 
  autoComplete, 
  prefix 
}) => (
  <div className="space-y-1.5 group">
    <label className="text-[10px] font-black uppercase text-zinc-500 group-focus-within:text-[#FFBE4E] tracking-widest ml-1 transition-colors">
      {label}
    </label>
    <div className="field-shell relative">
      <div className={`absolute inset-0 bg-white/[0.02] rounded-xl -z-10 transition-opacity ${error ? 'opacity-100' : 'opacity-0 group-focus-within:opacity-100'}`} />
      {icon && (
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 transition-colors group-focus-within:text-[#FFBE4E]">
          {icon}
        </div>
      )}
      {prefix && !icon && (
        <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center pr-3 border-r border-zinc-800 pointer-events-none transition-colors group-focus-within:border-[#FFBE4E]/30">
          <span className="text-[10px] font-bold text-zinc-500 group-focus-within:text-[#FFBE4E]">{prefix}</span>
        </div>
      )}
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={`w-full bg-zinc-950/40 border-2 rounded-xl p-4 text-sm outline-none transition-all duration-300 placeholder:text-zinc-700 ${
          icon ? 'pl-12' : (prefix ? 'pl-14' : 'pl-4')
        } ${
          error
            ? 'border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.1)]'
            : 'border-zinc-900 group-hover:border-zinc-800 focus:border-[#FFBE4E] focus:shadow-[0_0_20px_rgba(255,190,78,0.08)]'
        }`}
      />
    </div>
    {error && <p className="text-[10px] font-bold text-red-400 ml-1 uppercase tracking-tight italic">{error}</p>}
  </div>
);

export default FormInput;
