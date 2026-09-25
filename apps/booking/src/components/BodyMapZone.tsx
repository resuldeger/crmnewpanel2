
import React from 'react';

interface BodyMapZoneProps {
  path: string;
  id: string;
  selected: boolean;
  onToggle: (id: string) => void;
  label: string;
}

const BodyMapZone: React.FC<BodyMapZoneProps> = ({ 
  path, 
  id, 
  selected, 
  onToggle, 
  label 
}) => (
  <path
    d={path}
    onClick={() => onToggle(id)}
    className={`cursor-pointer transition-all duration-500 outline-none ${
      selected 
        ? 'fill-[#FFBE4E] stroke-[#FFBE4E] stroke-[1.5] opacity-90 filter drop-shadow-[0_0_8px_rgba(255,190,78,0.6)]' 
        : 'fill-zinc-900/40 stroke-zinc-800'
    }`}
  >
    <title>{label}</title>
  </path>
);

export default BodyMapZone;
