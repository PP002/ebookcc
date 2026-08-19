import React from 'react';

export function SplitPanelsIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Central panel frame */}
      <rect x="7" y="3.5" width="10" height="17" rx="1.5" />
      {/* Left panel indicator [ */}
      <path d="M4.5 7H2.5v10h2" />
      {/* Right panel indicator ] */}
      <path d="M19.5 7h2v10h-2" />
    </svg>
  );
}
