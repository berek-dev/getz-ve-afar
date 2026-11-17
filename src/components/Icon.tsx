import type { ReactNode } from 'react';

export type IconName =
  | 'jobs'
  | 'gauge'
  | 'plus'
  | 'close'
  | 'check'
  | 'frame'
  | 'pipe'
  | 'wrench'
  | 'excavator'
  | 'mic'
  | 'eye'
  | 'spark'
  | 'forward'
  | 'back'
  | 'trash'
  | 'saw';

const PATHS: Record<IconName, ReactNode> = {
  jobs: (
    <>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M9 12h6M9 16h4" />
    </>
  ),
  gauge: (
    <>
      <path d="m12 14 4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  check: <path d="M20 6 9 17l-5-5" />,
  // Gate: two leaves with diagonal braces
  frame: (
    <>
      <rect x="3" y="5" width="18" height="15" rx="1" />
      <path d="M12 5v15M3 20l9-15M12 20l9-15" />
    </>
  ),
  // Pipe run with a bolted flange joint and a weld bead
  pipe: (
    <>
      <path d="M2 9h8v6H2M22 9h-8v6h8" />
      <rect x="10" y="6" width="4" height="12" rx="1" />
      <path d="M12 6v12" />
    </>
  ),
  wrench: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  ),
  excavator: (
    <>
      <rect x="2" y="17" width="12" height="4" rx="2" />
      <path d="M4 17v-5h6l2 5" />
      <path d="M10 12l4-6 5 3" />
      <path d="M19 9l2 5h-4" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  // RTL: "forward" points left, "back" points right
  forward: <path d="m15 18-6-6 6-6" />,
  back: <path d="m9 18 6-6-6-6" />,
  trash: <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />,
  // Chop-saw disc over a bar
  saw: (
    <>
      <circle cx="12" cy="9" r="6" />
      <circle cx="12" cy="9" r="1.5" />
      <path d="M2 19h20M2 22h20" />
    </>
  ),
  spark: (
    <>
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
};

export function Icon({ name, size = 24, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
