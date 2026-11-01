import React from 'react'

const PATHS = {
  menu: <><line x1='4' y1='7' x2='20' y2='7' /><line x1='4' y1='12' x2='20' y2='12' /><line x1='4' y1='17' x2='20' y2='17' /></>,
  close: <><line x1='6' y1='6' x2='18' y2='18' /><line x1='18' y1='6' x2='6' y2='18' /></>,
  search: <><circle cx='11' cy='11' r='7' /><line x1='20' y1='20' x2='16' y2='16' /></>,
  sun: <><circle cx='12' cy='12' r='4' /><path d='M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' /></>,
  moon: <path d='M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z' />,
  copy: <><rect x='9' y='9' width='11' height='11' rx='1.5' /><path d='M5 15V5a1 1 0 0 1 1-1h9' /></>,
  check: <polyline points='5 12.5 10 17 19 7' />,
  download: <><path d='M12 4v11' /><polyline points='7 10.5 12 15.5 17 10.5' /><line x1='5' y1='20' x2='19' y2='20' /></>,
  play: <polygon points='7 5 19 12 7 19 7 5' fill='currentColor' stroke='none' />,
  external: <><path d='M14 5h5v5' /><line x1='19' y1='5' x2='11' y2='13' /><path d='M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4' /></>,
  arrowLeft: <><line x1='19' y1='12' x2='5' y2='12' /><polyline points='11 6 5 12 11 18' /></>,
  arrowRight: <><line x1='5' y1='12' x2='19' y2='12' /><polyline points='13 6 19 12 13 18' /></>,
  chevron: <polyline points='9 6 15 12 9 18' />,
  key: <><circle cx='8' cy='15' r='4' /><path d='M11 12l9-9M16 7l3 3' /></>,
  github: (
    <path
      fill='currentColor'
      stroke='none'
      d='M12 2C6.48 2 2 6.48 2 12.02c0 4.42 2.87 8.17 6.84 9.5.5.09.68-.22.68-.48l-.01-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.64-1.34-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.03a9.56 9.56 0 0 1 5 0c1.91-1.3 2.75-1.03 2.75-1.03.55 1.38.2 2.4.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.85-2.34 4.7-4.57 4.94.36.31.68.92.68 1.86l-.01 2.75c0 .27.18.58.69.48A10.02 10.02 0 0 0 22 12.02C22 6.48 17.52 2 12 2z'
    />
  )
}

export type IconName = keyof typeof PATHS

export function Icon ({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth={1.75}
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
      focusable='false'
      className='icon'
    >
      {PATHS[name]}
    </svg>
  )
}
