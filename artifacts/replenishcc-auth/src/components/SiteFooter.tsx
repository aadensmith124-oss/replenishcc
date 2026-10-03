import { getHealthCheckQueryKey, useHealthCheck } from '@workspace/api-client-react';
import { Link } from 'wouter';

export function SiteFooter({ homeHref = '/login' }: { homeHref?: string }) {
  const health = useHealthCheck({
    query: {
      queryKey: getHealthCheckQueryKey(),
      refetchInterval: 60_000,
      refetchOnWindowFocus: true,
    },
  });
  const operational = !health.isLoading && !health.isError && health.data?.status === 'ok';
  const statusLabel = health.isLoading
    ? 'Checking account service'
    : operational
      ? 'Account API operational'
      : 'Account service status unavailable';

  return (
    <footer className="site-footer" data-testid="site-footer">
      <div
        className={`footer-health${operational ? ' is-operational' : health.isError ? ' is-unavailable' : ''}`}
        role="status"
        aria-live="polite"
        data-testid="status-account-service"
      >
        <span className="footer-health-dot" aria-hidden="true" />
        <span>{statusLabel}</span>
      </div>
      <nav className="footer-links" aria-label="Footer links">
        <Link href="/privacy" data-testid="link-footer-privacy">Privacy Policy</Link>
        <span aria-hidden="true">•</span>
        <Link href="/terms" data-testid="link-footer-terms">Terms of Service</Link>
        <span aria-hidden="true">•</span>
        <a href="/api/healthz" target="_blank" rel="noreferrer" data-testid="link-footer-status">Status</a>
      </nav>
      <small className="site-footer-copyright">© {new Date().getFullYear()} ReplenishCC. All rights reserved.</small>
      <Link href={homeHref} className="site-footer-home" data-testid="link-footer-home">
        <span className="site-footer-home-mark" aria-hidden="true">R</span>
        <span>ReplenishCC</span>
      </Link>
    </footer>
  );
}