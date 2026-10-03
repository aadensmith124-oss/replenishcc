import { Link } from 'wouter';

export function Brand({ href = '/login', label = 'ReplenishCC sign in' }: { href?: string; label?: string }) {
  return (
    <Link href={href} className="brand" aria-label={label}>
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <defs>
            <linearGradient id="replenish-brand-leaf" x1="8" y1="3" x2="27" y2="30" gradientUnits="userSpaceOnUse">
              <stop stopColor="#E8CC68" />
              <stop offset=".48" stopColor="#D5B44D" />
              <stop offset="1" stopColor="#B48A24" />
            </linearGradient>
          </defs>
          <path d="M16.2 1.8C13.8 8.5 5.3 14.5 5.3 22.5c0 5.7 4.4 9.7 10.7 9.7s10.7-4 10.7-9.7c0-7.4-7.7-14.8-10.5-20.7Z" fill="url(#replenish-brand-leaf)" />
          <path d="M18.7 8.4c1.2 5-2 8-5.1 10.9-2.3 2.2-3.6 4.1-3.3 6.5.2 1.5 1 2.8 2.3 3.9-4.1-1.2-6.1-4-6.1-7.7 0-5.4 6.9-10.3 12.2-13.6Z" fill="#111715" />
          <path d="M7.3 22.4c2.2 4.2 6.1 6.4 10.7 6.1 3.9-.2 7.3-2.4 9-5.7-.2 5.7-4.5 9.4-10.4 9.4-5 0-8.7-2.7-9.3-7.1-.1-.9-.1-1.8 0-2.7Z" fill="url(#replenish-brand-leaf)" />
        </svg>
      </span>
      <span className="brand-wordmark">ReplenishCC</span>
    </Link>
  );
}