// The Status AI logo: the supplied original artwork, never redrawn. The files are cropped from the original logo
// sheet by scripts/build-logo-assets.mjs (source: design/status-ai-logo-sheet.png).
//   variant 'light' (default): the full-colour logo for light backgrounds (public/logo-on-light.png)
//   variant 'dark': the white lockup for the deep-plum sidebar (public/logo-on-dark.png)
const FILES = {
  light: { src: '/logo-on-light.png', width: 640, height: 182 },
  dark: { src: '/logo-on-dark.png', width: 490, height: 157 },
}

export function Logo({ variant = 'light' }) {
  const f = FILES[variant] ?? FILES.light
  return <img className={`logo-img on-${variant === 'dark' ? 'dark' : 'light'}`} src={f.src} width={f.width} height={f.height} alt="Status AI" decoding="async" />
}
