
import React from 'react';

interface LoadingOverlayProps {
  isVisible: boolean;
  message?: string;
}

const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ isVisible, message }) => {
  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md animate-fade-in transition-all">
      <div className="flex flex-col items-center space-y-8 max-w-xs text-center">
        <div className="relative">
          {/* Outer Ring */}
          <div className="w-24 h-24 rounded-full border-t-2 border-r-2 border-[#FFBE4E] animate-spin shadow-[0_0_15px_rgba(255,190,78,0.4)]" />
          
          {/* Inner Logo/Icon */}
          <div className="absolute inset-0 flex items-center justify-center">
            <img 
              src="https://www.cleopatraink.com/img/cleopatra-logo.svg" 
              alt="Cleopatra Ink" 
              className="w-12 h-12 object-contain animate-pulse filter drop-shadow-[0_0_8px_rgba(255,190,78,0.6)]" 
            />
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-white font-black uppercase tracking-[0.4em] text-[10px] animate-pulse">
            {message || 'Synchronizing with Studio...'}
          </p>
          <div className="h-[2px] w-24 mx-auto bg-zinc-900 rounded-full overflow-hidden">
            <div className="h-full bg-[#FFBE4E] animate-shimmer" />
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes shimmer { 
          0% { transform: translateX(-100%); } 
          100% { transform: translateX(100%); } 
        }
        .animate-fade-in { animation: fade-in 0.3s ease-out forwards; }
        .animate-shimmer { 
          animation: shimmer 1.5s infinite linear; 
          width: 50%;
        }
      `}</style>
    </div>
  );
};

export default LoadingOverlay;
