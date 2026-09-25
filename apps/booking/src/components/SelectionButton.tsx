
import React from 'react';

interface SelectionButtonProps {
  label: string;
  isSelected: boolean;
  onClick: () => void;
  description?: string;
  image?: string;
  showChevron?: boolean;
}

const SelectionButton: React.FC<SelectionButtonProps> = ({ 
  label, 
  isSelected, 
  onClick, 
  description, 
  image, 
  showChevron 
}) => {
  return (
    <button
      onClick={onClick}
      className={`group relative w-full rounded-2xl text-left transition-all duration-500 border overflow-hidden ${
        image ? 'p-0 flex flex-col md:flex-row md:items-center' : 'p-5 md:p-6 flex items-center justify-between gap-4'
      } ${
        isSelected 
          ? 'bg-[#FFBE4E]/5 border-[#FFBE4E] shadow-[0_0_30px_rgba(255,190,78,0.2)] scale-[1.02]' 
          : 'bg-[#0f0f0f]/60 border-zinc-900/50 md:hover:border-[#FFBE4E]/30 md:hover:bg-zinc-900/40'
      }`}
    >
      {image && (
        <div className="relative w-full h-32 md:absolute md:inset-y-0 md:left-0 md:w-44 md:h-auto z-0 opacity-100 overflow-hidden pointer-events-none">
          <img src={image} alt="" className="w-full h-full object-cover scale-110 group-hover:scale-100 transition-transform duration-1000" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-transparent to-transparent md:bg-gradient-to-r md:from-transparent md:via-[#050505]/40 md:to-[#050505]" />
        </div>
      )}

      <div className={`relative z-10 flex flex-col gap-0.5 flex-grow ${
        image 
          ? 'p-4 text-center items-center md:text-left md:items-start md:pl-40 md:py-6' 
          : ''
      }`}>
        <span className={`serif-font text-xl md:text-2xl font-bold tracking-tight normal-case transition-colors duration-300 ${isSelected ? 'text-white' : 'text-white/90 md:group-hover:text-white'}`}>
          {label}
        </span>
        {description && (
          <span className={`text-[9px] md:text-xs leading-tight font-medium transition-colors duration-300 ${isSelected ? 'text-zinc-300' : 'text-zinc-500'}`}>
            {description}
          </span>
        )}
      </div>

      {showChevron ? (
        <div className={`${image ? 'absolute top-4 right-4 md:static md:relative' : 'relative'} z-10 transition-transform duration-300 ${isSelected ? 'text-[#FFBE4E] translate-x-1' : 'text-zinc-700 md:group-hover:text-zinc-500'}`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      ) : (
        <div className={`${image ? 'absolute top-4 right-4 md:static md:relative' : 'relative'} z-10 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-500 ${isSelected ? 'border-[#FFBE4E]' : 'border-zinc-800 md:group-hover:border-[#FFBE4E]/30'}`}>
           <div className={`w-3 h-3 rounded-full bg-[#FFBE4E] transition-all duration-500 ${isSelected ? 'scale-100 opacity-100' : 'scale-0 opacity-0'}`} />
        </div>
      )}
    </button>
  );
};

export default SelectionButton;
