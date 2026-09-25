"use client";


import React from 'react';
import { FormStep } from '../types';

interface StepProgressProps {
  currentStep: FormStep;
}

const steps = [
  { id: FormStep.PURPOSE, label: 'Purpose' },
  { id: FormStep.STYLE, label: 'Style' },
  { id: FormStep.STORY, label: 'Story' },
  { id: FormStep.BODY_AREA, label: 'Location' },
  { id: FormStep.SIZE, label: 'Size' },
  { id: FormStep.TIMING, label: 'Timing' },
  { id: FormStep.CONTACT, label: 'Contact' }
];

export const StepProgress: React.FC<StepProgressProps> = ({ currentStep }) => {
  if (currentStep === FormStep.SUCCESS || currentStep === FormStep.WELCOME) return null;

  return (
    <div className="w-full max-w-4xl mx-auto px-4 mb-12">
      <div className="relative flex justify-between items-center">
        <div className="absolute top-1/2 left-0 w-full h-0.5 bg-zinc-800 -translate-y-1/2 -z-10" />
        <div 
          className="absolute top-1/2 left-0 h-0.5 bg-[#FFBE4E] transition-all duration-500 ease-in-out -translate-y-1/2 -z-10"
          style={{ width: `${((currentStep - 1) / (steps.length - 1)) * 100}%` }}
        />

        {steps.map((step) => {
          const isActive = currentStep >= step.id;
          const isCurrent = currentStep === step.id;

          return (
            <div key={step.id} className="flex flex-col items-center">
              <div 
                className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                  isActive 
                    ? 'bg-[#FFBE4E] border-[#FFBE4E] text-black' 
                    : 'bg-zinc-900 border-zinc-700 text-zinc-500'
                } ${isCurrent ? 'ring-4 ring-[#FFBE4E]/20 scale-110' : ''}`}
              >
                {isActive && currentStep > step.id ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <polyline points="20 6 9 17 4 12" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <span className="text-[10px] font-bold">{step.id}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
