'use client';

import React, { useId } from 'react';

interface WindCompassProps {
  /** Graden van Spire (0–360), meteorologische windrichting (waar de wind vandaan komt). */
  direction: number;
  size?: number;
}

export default function WindCompass({ direction, size = 40 }: WindCompassProps) {
  const gradId = `wind-arrow-${useId().replace(/:/g, '')}`;

  const rotationStyle: React.CSSProperties = {
    transform: `rotate(${direction}deg)`,
    transition: 'transform 1s cubic-bezier(0.4, 0, 0.2, 1)',
  };

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
      aria-label={`Windrichting ${direction}°`}
    >
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 h-full w-full opacity-20"
      >
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="white"
          strokeWidth="2"
          strokeDasharray="4 4"
        />
        <text
          x="50"
          y="15"
          fill="white"
          fontSize="12"
          textAnchor="middle"
          fontWeight="bold"
        >
          N
        </text>
      </svg>

      <div
        style={rotationStyle}
        className="relative flex items-center justify-center"
      >
        <svg
          width={size * 0.8}
          height={size * 0.8}
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M12 3L17 19L12 17L7 19L12 3Z"
            fill={`url(#${gradId})`}
            stroke="white"
            strokeWidth="1"
            strokeLinejoin="round"
          />
          <defs>
            <linearGradient
              id={gradId}
              x1="12"
              y1="3"
              x2="12"
              y2="19"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#22d3ee" />
              <stop offset="1" stopColor="#2563eb" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    </div>
  );
}
