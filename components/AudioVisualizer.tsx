import React, { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  isActive: boolean;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ isActive }) => {
  const bars = 5;
  
  return (
    <div className="flex items-end justify-center gap-1 h-8">
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className={`w-1.5 rounded-full bg-blue-500 transition-all duration-75 ease-in-out ${
            isActive ? 'animate-pulse' : 'h-1 opacity-30'
          }`}
          style={{
            height: isActive ? `${Math.random() * 100}%` : '4px',
            animationDuration: `${0.4 + Math.random() * 0.5}s`
          }}
        />
      ))}
    </div>
  );
};
