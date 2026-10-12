/** Hand-drawn inline SVG icons (currentColor, 24×24). */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 22, children, ...rest }: P) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** 名单: a bundle of sticks in a tube. */
export function IconList(p: P) {
  return (
    <Svg {...p}>
      <path d="M7 10.5h10l-1.2 10a1.5 1.5 0 0 1-1.5 1.3H9.7a1.5 1.5 0 0 1-1.5-1.3L7 10.5Z" />
      <path d="M9.5 10.5 8.6 2.8M12 10.5V2.2M14.5 10.5l.9-7.7" />
      <path d="M7.4 14h9.2" opacity={0.6} />
    </Svg>
  );
}

/** 签簿: a stitched book. */
export function IconHistory(p: P) {
  return (
    <Svg {...p}>
      <path d="M5 3.5h11.5A2.5 2.5 0 0 1 19 6v14.5H7.5A2.5 2.5 0 0 1 5 18V3.5Z" />
      <path d="M5 18a2.5 2.5 0 0 1 2.5-2.5H19" />
      <path d="M8.5 3.5v12" opacity={0.6} />
      <path d="M11.5 7.5h4.5M11.5 10.5h3" />
    </Svg>
  );
}

/** 共签: three people. */
export function IconTeam(p: P) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="8" r="2.8" />
      <path d="M6.8 19.5a5.2 5.2 0 0 1 10.4 0" />
      <circle cx="5.2" cy="10" r="2" opacity={0.75} />
      <circle cx="18.8" cy="10" r="2" opacity={0.75} />
      <path d="M2 18.5a3.4 3.4 0 0 1 4-3.2M22 18.5a3.4 3.4 0 0 0-4-3.2" opacity={0.75} />
    </Svg>
  );
}

/** 设置: an incense burner / lotus knob. */
export function IconSettings(p: P) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" />
    </Svg>
  );
}

export function IconSound(p: P & { on: boolean }) {
  const { on, ...rest } = p;
  return (
    <Svg {...rest}>
      <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" />
      {on ? (
        <>
          <path d="M15.5 9a4.2 4.2 0 0 1 0 6" />
          <path d="M18 6.5a7.6 7.6 0 0 1 0 11" />
        </>
      ) : (
        <path d="m16 9.5 5 5M21 9.5l-5 5" />
      )}
    </Svg>
  );
}

export function IconClose(p: P) {
  return (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

export function IconUp(p: P) {
  return (
    <Svg {...p}>
      <path d="m6 14 6-6 6 6" />
    </Svg>
  );
}

export function IconDown(p: P) {
  return (
    <Svg {...p}>
      <path d="m6 10 6 6 6-6" />
    </Svg>
  );
}

export function IconTrash(p: P) {
  return (
    <Svg {...p}>
      <path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l.9 12.6a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.6" />
    </Svg>
  );
}

export function IconEdit(p: P) {
  return (
    <Svg {...p}>
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" />
      <path d="m14 8 3 3" />
    </Svg>
  );
}

export function IconShare(p: P) {
  return (
    <Svg {...p}>
      <path d="M12 3.5v11M7.5 8 12 3.5 16.5 8" />
      <path d="M5 12.5v6A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-6" />
    </Svg>
  );
}

export function IconCopy(p: P) {
  return (
    <Svg {...p}>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </Svg>
  );
}

export function IconDownload(p: P) {
  return (
    <Svg {...p}>
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
      <path d="M5 19.5h14" />
    </Svg>
  );
}

export function IconCheck(p: P) {
  return (
    <Svg {...p}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Svg>
  );
}

export function IconRefresh(p: P) {
  return (
    <Svg {...p}>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 4.5v4h-4" />
    </Svg>
  );
}

export function IconPlus(p: P) {
  return (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function IconLink(p: P) {
  return (
    <Svg {...p}>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" />
    </Svg>
  );
}

export function IconOdds(p: P) {
  return (
    <Svg {...p}>
      <path d="M4 20V10M9.3 20V4M14.6 20v-7M20 20V7" />
    </Svg>
  );
}

/** Crescent 筊 block: flat (wood) face or round (lacquer) face up. */
export function JiaobeiGlyph({ face, size = 44, title }: { face: 'flat' | 'round'; size?: number; title?: string }) {
  const id = face === 'round' ? 'jb-round' : 'jb-flat';
  return (
    <svg
      width={size}
      height={size * 0.62}
      viewBox="0 0 100 62"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="0" y2="1">
          {face === 'round' ? (
            <>
              <stop offset="0" stopColor="#ef4a50" />
              <stop offset="0.5" stopColor="#b3121b" />
              <stop offset="1" stopColor="#5e060c" />
            </>
          ) : (
            <>
              <stop offset="0" stopColor="#f0cf94" />
              <stop offset="1" stopColor="#b07b3c" />
            </>
          )}
        </linearGradient>
      </defs>
      <path d="M4 18 C 22 66, 78 66, 96 18 C 80 34, 20 34, 4 18 Z" fill={`url(#${id}-g)`} stroke="#3a1408" strokeWidth="2" />
      {face === 'round' ? (
        <path d="M18 34 C 34 48, 66 48, 82 34" stroke="rgb(255 220 200 / 0.55)" strokeWidth="3" fill="none" strokeLinecap="round" />
      ) : (
        <>
          <path d="M20 36 C 36 44, 64 44, 80 36" stroke="rgb(110 60 20 / 0.45)" strokeWidth="1.5" fill="none" />
          <path d="M28 42 C 40 47, 60 47, 72 42" stroke="rgb(110 60 20 / 0.35)" strokeWidth="1.2" fill="none" />
        </>
      )}
    </svg>
  );
}
