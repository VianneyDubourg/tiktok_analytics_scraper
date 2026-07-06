import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function EyeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function HeartIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 20.5s-7.5-4.6-9.8-9.3C.8 7.9 2.4 4.5 5.7 3.9c2-.4 4 .5 5.2 2.2A5 5 0 0 1 15.1 3.9c3.3.6 4.9 4 3.5 7.3C16.3 15.9 12 20.5 12 20.5Z" />
    </svg>
  );
}

export function CommentIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 4.5h16a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1H9l-4.5 4V16H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

export function ShareIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 12v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
      <path d="M16 6l-4-4-4 4" />
      <path d="M12 2.5V15" />
    </svg>
  );
}

export function BookmarkIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4.2L5 21V4.5a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.8 19c.7-3 3.1-5 6.2-5s5.5 2 6.2 5" />
      <path d="M15.5 5.2a3.2 3.2 0 0 1 0 6.2" />
      <path d="M17.2 14.3c2.6.5 4.4 2.3 5 4.7" />
    </svg>
  );
}

export function UserPlusIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.8 19c.7-3 3.1-5 6.2-5s5.5 2 6.2 5" />
      <path d="M18 8v6M15 11h6" />
    </svg>
  );
}

export function ClipIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9.5 9.2v5.6l5-2.8-5-2.8Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function BadgeCheckIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 2.5 14.2 4.6 17.2 4 18 7l3 1.3-.9 3L21 14l-3 1.7-.5 3.1-3-.2L12 21.5l-2.5-2.9-3 .2-.5-3.1L3 14l.9-2.7L3 8l3-1L6.8 4l3 .6L12 2.5Z" />
      <path d="m8.7 12.2 2.2 2.2 4.4-4.6" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function AtIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-4.2 7.6" />
    </svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3 2 20h20L12 3Z" />
      <path d="M12 10v4M12 17.5h.01" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.2 2" />
    </svg>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v5h-5" />
    </svg>
  );
}
