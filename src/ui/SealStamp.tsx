/**
 * 朱文印「锦少午餐委员会印」: a procedural cinnabar seal with worn edges (SVG turbulence),
 * two vertical columns read right to left. `slam` plays the stamp keyframes.
 */
import { useId } from 'react';
import { COPY } from '@/data/copy';

function columns(text: string): [string[], string[]] {
  let chars = Array.from(text.replace(/\s+/g, ''));
  if (chars.length % 2 === 1) chars = [...chars, '印'];
  const half = Math.ceil(chars.length / 2);
  return [chars.slice(0, half), chars.slice(half)];
}

export function SealStamp(props: { text?: string; size?: number; slam?: boolean; delay?: number; className?: string }) {
  const { text = COPY.app.committee, size = 96, slam = false, delay, className } = props;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [right, left] = columns(text);
  const rows = Math.max(right.length, left.length);
  const w = 100;
  const h = Math.round(28 + rows * 30);
  const cell = (h - 20) / rows;
  const fs = Math.min(30, cell * 0.92);

  return (
    <span
      className={`seal ${className ?? ''}`}
      data-slam={slam}
      style={delay !== undefined ? ({ '--delay': `${delay}s` } as React.CSSProperties) : undefined}
      role="img"
      aria-label={`印章：${text}`}
    >
      <svg width={size} height={(size * h) / w} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
        <defs>
          <filter id={`wear-${uid}`} x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="11" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G" result="d" />
            <feTurbulence type="fractalNoise" baseFrequency="0.22" numOctaves="3" seed="3" result="blot" />
            <feColorMatrix in="blot" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  6 0 0 0 -1.6" result="mask" />
            <feComposite in="d" in2="mask" operator="in" />
          </filter>
        </defs>
        <g filter={`url(#wear-${uid})`}>
          <rect x="3" y="3" width={w - 6} height={h - 6} rx="5" fill="#c0161f" />
          <rect x="8" y="8" width={w - 16} height={h - 16} rx="2" fill="none" stroke="#f6e7c8" strokeWidth="2.2" />
          <line x1={w / 2} y1="12" x2={w / 2} y2={h - 12} stroke="#f6e7c8" strokeWidth="1" opacity="0.5" />
          {right.map((c, i) => (
            <text
              key={`r${i}`}
              x={w * 0.73}
              y={10 + cell * (i + 0.5)}
              fontSize={fs}
              fontFamily="'Ma Shan Zheng','STKaiti','KaiTi',serif"
              fill="#f6e7c8"
              textAnchor="middle"
              dominantBaseline="central"
            >
              {c}
            </text>
          ))}
          {left.map((c, i) => (
            <text
              key={`l${i}`}
              x={w * 0.27}
              y={10 + cell * (i + 0.5)}
              fontSize={fs}
              fontFamily="'Ma Shan Zheng','STKaiti','KaiTi',serif"
              fill="#f6e7c8"
              textAnchor="middle"
              dominantBaseline="central"
            >
              {c}
            </text>
          ))}
        </g>
      </svg>
    </span>
  );
}
