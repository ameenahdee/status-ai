// Small line icons (currentColor), used by the sidebar and the dashboard.
const base = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false' }
const Icon = ({ size, children, ...rest }) => (
  <svg {...base} {...(size ? { width: size, height: size } : {})} {...rest}>{children}</svg>
)

export const IconHome = (p) => <Icon {...p}><path d="M3.5 10.8 12 3.5l8.5 7.3V19a1.5 1.5 0 0 1-1.5 1.5h-4.2v-5.8H9.2v5.8H5A1.5 1.5 0 0 1 3.5 19z" /></Icon>
export const IconLayers = (p) => <Icon {...p}><path d="M12 3.5 3.5 8 12 12.5 20.5 8z" /><path d="m3.5 12 8.5 4.5 8.5-4.5" /><path d="m3.5 16 8.5 4.5 8.5-4.5" /></Icon>
export const IconBars = (p) => <Icon {...p}><path d="M5 20V11M12 20V4M19 20v-6" /></Icon>
export const IconLink = (p) => <Icon {...p}><path d="M10.2 13.8a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M13.8 10.2a4 4 0 0 0-5.7 0L5.3 13a4 4 0 0 0 5.7 5.7l1-1" /></Icon>
export const IconPlus = (p) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>
export const IconDoc = (p) => <Icon {...p}><path d="M7 3.5h7l4 4V20.5H7z" /><path d="M14 3.5v4h4" /><path d="M10 12.5h5M10 16h5" /></Icon>
export const IconPulse = (p) => <Icon {...p}><path d="M3 12h4l2.2-6 4.2 12 2.2-6H21" /></Icon>
export const IconPencil = (p) => <Icon {...p}><path d="M4 20h4L19.5 8.5l-4-4L4 16z" /><path d="m13 7 4 4" /></Icon>
export const IconCheck = (p) => <Icon {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Icon>
export const IconWarn = (p) => <Icon {...p}><path d="M12 4 3 19.5h18z" /><path d="M12 10v4.2M12 17v.1" /></Icon>
export const IconX = (p) => <Icon {...p}><path d="m6.5 6.5 11 11M17.5 6.5l-11 11" /></Icon>
export const IconUser = (p) => <Icon {...p}><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" /></Icon>
export const IconInfo = (p) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.8v.1" /></Icon>
export const IconArrow = (p) => <Icon {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Icon>
export const IconChevron = (p) => <Icon {...p}><path d="m9 6 6 6-6 6" /></Icon>
