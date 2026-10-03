import { Link } from 'wouter';

export function Brand({ href = '/login', label = 'ReplenishCC sign in' }: { href?: string; label?: string }) {
  return (
    <Link href={href} className="brand" aria-label={label}>
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <path d="M16 2.8 27.4 9.4v13.2L16 29.2 4.6 22.6V9.4L16 2.8Z" stroke="currentColor" strokeWidth="1.15" />
          <path d="m10.1 18.6 5.9-10 5.9 10M12.6 14.5h6.8M9.7 22.2h12.6" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span>REPLENISHCC</span>
    </Link>
  );
}