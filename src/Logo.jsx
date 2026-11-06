import { useId } from 'react'

// Status AI mark: a folded ribbon S. A plum upper ribbon, a pink middle ribbon and a
// folded lower tail. Shapes are filled paths in an 800-unit design space; the visible
// artwork occupies roughly x 150-670, y 78-718.
const TOP = 'M628 182L522 108C478 78 436 84 400 104L232 200C172 236 148 300 174 358C196 410 250 442 304 458L445 306Z'
const MID = 'M445 306L588 386C640 414 662 460 654 506C648 548 618 578 576 602L486 654C512 622 504 574 456 549L356 507L306 464C278 438 280 402 312 384Z'
const BOT = 'M356 507L208 598C192 608 192 626 210 636L268 680C316 712 384 706 426 684L486 654C512 622 504 574 456 549Z'

const PALETTE = {
  light: { top: ['#3E0F4C', '#7A2A6D'], mid: ['#D95CA2', '#E870B2', '#BE4189'], bot: ['#CC5A9B', '#7C2C6C'] },
  dark: { top: ['#FFFFFF', '#F1D3E5'], mid: ['#D95CA2', '#E870B2', '#BE4189'], bot: ['#F7C6DF', '#A83C80'] },
}

export function LogoMark({ size = 32, variant = 'light' }) {
  const id = useId()
  const c = PALETTE[variant] || PALETTE.light
  return (
    <svg width={(size * 520) / 640} height={size} viewBox="150 78 520 640" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}t`} x1="170" y1="300" x2="628" y2="182" gradientUnits="userSpaceOnUse">
          <stop stopColor={c.top[0]} />
          <stop offset="1" stopColor={c.top[1]} />
        </linearGradient>
        <linearGradient id={`${id}m`} x1="300" y1="450" x2="654" y2="520" gradientUnits="userSpaceOnUse">
          <stop stopColor={c.mid[0]} />
          <stop offset=".4" stopColor={c.mid[1]} />
          <stop offset="1" stopColor={c.mid[2]} />
        </linearGradient>
        <linearGradient id={`${id}b`} x1="200" y1="620" x2="500" y2="620" gradientUnits="userSpaceOnUse">
          <stop stopColor={c.bot[0]} />
          <stop offset="1" stopColor={c.bot[1]} />
        </linearGradient>
      </defs>
      {/* same-colour round-joined stroke softens corners like the approved mark */}
      <path d={TOP} fill={`url(#${id}t)`} stroke={`url(#${id}t)`} strokeWidth="8" strokeLinejoin="round" />
      <path d={MID} fill={`url(#${id}m)`} stroke={`url(#${id}m)`} strokeWidth="8" strokeLinejoin="round" />
      <path d={BOT} fill={`url(#${id}b)`} stroke={`url(#${id}b)`} strokeWidth="8" strokeLinejoin="round" />
    </svg>
  )
}

export function Logo({ variant = 'light' }) {
  return (
    <span className={`logo ${variant}`}>
      <LogoMark variant={variant} size={38} />
      <span className="wordmark">Status AI</span>
    </span>
  )
}
