// Line icons for the editor chrome: 16px grid, 1.5px stroke, currentColor.
// Inline SVG instead of Unicode glyphs (←, ⋯, ⤢…), which render at different
// weights, sizes and baselines depending on the OS font, and are missing
// from some fonts entirely. Decorative: the button carrying an icon supplies
// the accessible name (aria-label or visible text).

import type { ReactNode } from "react";

function Icon({ children, filled }: { children: ReactNode; filled?: boolean }) {
  return (
    <svg
      aria-hidden
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="gb-icon"
    >
      {children}
    </svg>
  );
}

export const BackIcon = () => (
  <Icon>
    <path d="M13 8H3M7 4 3 8l4 4" />
  </Icon>
);

export const MoreIcon = () => (
  <Icon filled>
    <circle cx="3.5" cy="8" r="1.25" />
    <circle cx="8" cy="8" r="1.25" />
    <circle cx="12.5" cy="8" r="1.25" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);

export const MinusIcon = () => (
  <Icon>
    <path d="M3 8h10" />
  </Icon>
);

/** Four corner brackets: frame everything. */
export const FitIcon = () => (
  <Icon>
    <path d="M2.75 6V2.75H6M10 2.75h3.25V6M13.25 10v3.25H10M6 13.25H2.75V10" />
  </Icon>
);

/** Panel attached to the right edge. */
export const DockIcon = () => (
  <Icon>
    <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1" />
    <path d="M9.75 2.75v10.5" />
  </Icon>
);

/** Panel floating free inside the frame. */
export const UndockIcon = () => (
  <Icon>
    <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1" />
    <rect x="8.25" y="5" width="3.25" height="5" rx="0.5" />
  </Icon>
);

export const UndoIcon = () => (
  <Icon>
    <path d="M5.5 3.75 2.75 6.5 5.5 9.25M2.75 6.5H10a3.25 3.25 0 0 1 0 6.5H7.5" />
  </Icon>
);

export const RedoIcon = () => (
  <Icon>
    <path d="M10.5 3.75 13.25 6.5 10.5 9.25M13.25 6.5H6a3.25 3.25 0 0 0 0 6.5h2.5" />
  </Icon>
);

export const UpIcon = () => (
  <Icon>
    <path d="M8 13V3M4 7l4-4 4 4" />
  </Icon>
);

export const DownIcon = () => (
  <Icon>
    <path d="M8 3v10M4 9l4 4 4-4" />
  </Icon>
);
