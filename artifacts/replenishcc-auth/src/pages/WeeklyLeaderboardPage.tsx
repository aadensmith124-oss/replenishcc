import { useEffect } from 'react';
import { CircleAlert, RefreshCw, Trophy } from 'lucide-react';
import {
  getGetWeeklyLeaderboardQueryKey,
  useGetAuthMe,
  useGetWeeklyLeaderboard,
} from '@workspace/api-client-react';
import { useLocation } from 'wouter';
import { MemberShell } from '../components/MemberShell';

const money = (amountCents: number) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
}).format(amountCents / 100);

const utcDate = (value: string) => new Date(value).toISOString().slice(0, 10);

export function WeeklyLeaderboardPage() {
  const session = useGetAuthMe();
  const [, setLocation] = useLocation();
  const user = session.data?.authenticated ? session.data.user : null;
  const leaderboard = useGetWeeklyLeaderboard({
    query: {
      queryKey: getGetWeeklyLeaderboardQueryKey(),
      enabled: Boolean(user),
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
  });

  useEffect(() => {
    document.title = 'Weekly Leaderboard | ReplenishCC';
  }, []);

  useEffect(() => {
    if (!session.isLoading && (session.isError || !session.data?.authenticated)) {
      setLocation('/login');
    }
  }, [session.data?.authenticated, session.isError, session.isLoading, setLocation]);

  if (session.isLoading || !user) {
    return <MemberShell pageTitle="Leaderboard" user={null} loading />;
  }

  const rankings = leaderboard.data?.rankings ?? [];
  const weekRange = leaderboard.data
    ? `${utcDate(leaderboard.data.weekStart)} → ${utcDate(leaderboard.data.weekEnd)} UTC`
    : leaderboard.isLoading
      ? 'Loading current UTC week…'
      : 'Current UTC week unavailable';

  return (
    <MemberShell pageTitle="Leaderboard" user={user} contentClassName="member-dashboard-content">
      <div className="workspace-page leaderboard-page">
        <header className="workspace-heading leaderboard-page-heading">
          <div>
            <div className="section-kicker"><Trophy aria-hidden="true" /> Member rankings</div>
            <h1>Weekly Leaderboard</h1>
            <p>Deposit rankings · Monday 00:00 UTC → next Monday (UTC)</p>
          </div>
        </header>

        <div className="leaderboard-period-row">
          <p className="leaderboard-week-range" data-testid="text-leaderboard-week-range">{weekRange}</p>
          <button
            className="workspace-secondary-button leaderboard-refresh-button"
            type="button"
            onClick={() => void leaderboard.refetch()}
            disabled={leaderboard.isFetching}
            data-testid="button-refresh-leaderboard"
          >
            <RefreshCw className={leaderboard.isFetching ? 'icon-rotating' : ''} aria-hidden="true" />
            {leaderboard.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        <section className="workspace-panel leaderboard-panel" aria-labelledby="weekly-top-depositors-title" aria-busy={leaderboard.isFetching}>
          <div className="leaderboard-card-heading">
            <span className="leaderboard-trophy-mark"><Trophy aria-hidden="true" /></span>
            <div>
              <h2 id="weekly-top-depositors-title">Top depositors this week</h2>
              <p>Only confirmed deposits count. Emails are masked on the public leaderboard.</p>
            </div>
          </div>

          {leaderboard.isLoading ? (
            <div className="table-skeleton leaderboard-loading" role="status" aria-label="Loading weekly rankings">
              <span /><span /><span /><span />
            </div>
          ) : leaderboard.isError ? (
            <div className="inline-error leaderboard-error" role="alert">
              <CircleAlert aria-hidden="true" />
              <span>Weekly rankings are temporarily unavailable.</span>
              <button type="button" onClick={() => void leaderboard.refetch()}>Retry</button>
            </div>
          ) : rankings.length ? (
            <div className="leaderboard-table-wrap">
              <table className="leaderboard-table" aria-label="Top weekly depositors">
                <thead>
                  <tr><th scope="col">Rank</th><th scope="col">User</th><th scope="col" className="leaderboard-amount">Weekly deposits</th></tr>
                </thead>
                <tbody>
                  {rankings.map((entry) => (
                    <tr key={`${entry.rank}-${entry.maskedEmail}`} data-testid={`row-leaderboard-${entry.rank}`}>
                      <td className="leaderboard-rank">#{entry.rank}</td>
                      <td className="leaderboard-user" title={entry.maskedEmail}>{entry.maskedEmail}</td>
                      <td className="leaderboard-amount">{money(entry.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="workspace-empty compact leaderboard-empty">
              <Trophy aria-hidden="true" />
              <strong>No confirmed deposits this week</strong>
              <span>Rankings appear here after deposits are confirmed during the current UTC week.</span>
            </div>
          )}
        </section>
      </div>
    </MemberShell>
  );
}