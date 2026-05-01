import React from 'react';

export const ClassicSpaceLogo = ({ className = '', size = 24 }: { className?: string; size?: number }) => {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {/* Helmet */}
        <path d="M12 2C8 2 6 5 6 9v2.5A1.5 1.5 0 0 0 7.5 13h9a1.5 1.5 0 0 0 1.5-1.5V9c0-4-2-7-6-7z" fill="#2563eb" stroke="none" />
        {/* Face plate opening */}
        <path d="M8 9v2c0 1 1 1.5 2 1.5h4c1 0 2-.5 2-1.5V9c0-1-1-1.5-2-1.5h-4C9 7.5 8 8 8 9z" fill="#fde047" stroke="none" />
        {/* Eyes and mouth */}
        <circle cx="10.5" cy="9.5" r="0.5" fill="black" stroke="none" />
        <circle cx="13.5" cy="9.5" r="0.5" fill="black" stroke="none" />
        <path d="M11 11c.3.2.7.2 1 0" stroke="black" strokeWidth="0.5" />
        
        {/* Air tanks (behind) */}
        <path d="M4 8v6a2 2 0 0 0 2 2h0 M20 8v6a2 2 0 0 1-2 2h0" stroke="#1e40af" strokeWidth="3" />
        
        {/* Torso */}
        <path d="M7.5 13L6 22h12l-1.5-9" fill="#2563eb" stroke="none" />
        <path d="M7.5 13L6 22h12l-1.5-9H7.5z" stroke="#1e40af" strokeWidth="1" />
        
        {/* Classic Space Logo */}
        <circle cx="12" cy="18" r="1.5" fill="#facc15" stroke="none" />
        <path d="M9 20c1.5-2 3-3.5 5-4" stroke="#ef4444" strokeWidth="1" />
        <path d="M14 16l1.5-1" stroke="#ef4444" strokeWidth="1" />
      </g>
    </svg>
  );
};
