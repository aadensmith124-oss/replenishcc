import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownToLine, CalendarDays, CheckCircle2, CircleAlert, Clock3, Download,
  ExternalLink, FileText, Megaphone, RefreshCw, ShieldCheck, TrendingUp, WalletCards,
} from 'lucide-react';
import {
  getGetAnnouncementsQueryKey, getGetMyDepositsQueryKey, useGetAnnouncements,
  useGetAuthMe, useGetMyDeposits, type Deposit,
} from '@workspace/api-client-react';
import { Link, useLocation } from 'wouter';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { MemberShell } from '../components/MemberShell';

type RangePreset = '30' | '90' | '365' | 'custom';
const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const dateLabel = (value: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
const statusName = (status: string) => status.charAt(0).toUpperCase() + status.slice(1);
const localDateInput = (value: Date) => {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function LoadingPanel() {
  return <div className="workspace-loading" role="status" aria-label="Loading account data"><span /><span /><span /></div>;
}

function DepositChart({ data, onDownload }: { data: Array<{ label: string; count: number; total: number; confirmed: number }>; onDownload: () => void }) {
  return (
    <section className="workspace-panel chart-panel" aria-labelledby="deposit-trend-title">
      <div className="workspace-panel-head">
        <div><div className="section-kicker">Activity over time</div><h2 id="deposit-trend-title">Deposit activity</h2><p>Count and value are calculated from your deposit records.</p></div>
        <button type="button" className="workspace-icon-button" onClick={onDownload} aria-label="Download deposit activity CSV" data-testid="button-download-deposit-chart"><Download aria-hidden="true" /></button>
      </div>
      {data.length ? <div className="workspace-chart" role="img" aria-label="Chart showing deposit count and total amount by month">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="hsl(210 8% 32% / .38)" strokeDasharray="3 5" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: '#929994', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="amount" tickFormatter={(n: number) => money(n)} tick={{ fill: '#929994', fontSize: 10 }} axisLine={false} tickLine={false} width={58} />
            <YAxis yAxisId="count" orientation="right" allowDecimals={false} tick={{ fill: '#929994', fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
            <Tooltip contentStyle={{ background: '#202522', border: '1px solid #3d4741', borderRadius: 8, color: '#eceee8', fontSize: 12 }} formatter={(value: number, name: string) => [name === 'count' ? value : money(value), name === 'count' ? 'Deposits' : name === 'confirmed' ? 'Confirmed value' : 'Deposit value']} />
            <Line yAxisId="amount" type="monotone" dataKey="total" stroke="#d2b65e" strokeWidth={2.5} dot={{ r: 3, fill: '#d2b65e', strokeWidth: 0 }} activeDot={{ r: 5 }} />
            <Line yAxisId="amount" type="monotone" dataKey="confirmed" stroke="#78a98d" strokeWidth={2} dot={false} />
            <Line yAxisId="count" type="monotone" dataKey="count" stroke="#a9b7ad" strokeWidth={1.8} strokeDasharray="5 4" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div> : <div className="workspace-empty compact"><CalendarDays aria-hidden="true" /><strong>No deposits in this date range</strong><span>Try a wider range or check back after your next deposit.</span></div>}
      <div className="chart-legend"><span><i className="legend-total" />Deposit value</span><span><i className="legend-confirmed" />Confirmed value</span><span><i className="legend-count" />Deposit count</span></div>
    </section>
  );
}

function StatusChart({ deposits, onDownload }: { deposits: Deposit[]; onDownload: () => void }) {
  const counts = ['confirmed', 'pending', 'rejected', 'failed', 'expired', 'refunded']
    .map((status) => ({ status, count: deposits.filter((deposit) => deposit.status === status).length }))
    .filter((item) => item.count > 0);
  return (
    <section className="workspace-panel status-panel" aria-labelledby="deposit-status-title">
      <div className="workspace-panel-head">
        <div><div className="section-kicker">Your records</div><h2 id="deposit-status-title">By status</h2><p>{deposits.length ? 'Every deposit in the selected period.' : 'No deposit activity to summarize.'}</p></div>
        <button type="button" className="workspace-icon-button" onClick={onDownload} aria-label="Download deposit status CSV" data-testid="button-download-status-chart"><Download aria-hidden="true" /></button>
      </div>
      {counts.length ? <div className="status-bars">{counts.map(({ status, count }) => (
        <div className="status-bar-row" key={status}>
          <span className={`status-dot status-${status}`} /><span className="status-bar-name">{statusName(status)}</span>
          <span className="status-bar-track"><i style={{ width: `${Math.max(7, count / deposits.length * 100)}%` }} /></span><strong>{count}</strong>
        </div>
      ))}</div> : <div className="workspace-empty compact"><FileText aria-hidden="true" /><strong>Nothing to show yet</strong><span>Your deposit status breakdown will appear here.</span></div>}
    </section>
  );
}

export function DashboardWorkspacePage() {
  const session = useGetAuthMe();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const user = session.data?.authenticated ? session.data.user : null;
  const depositsQuery = useGetMyDeposits({ query: { queryKey: getGetMyDepositsQueryKey(), enabled: Boolean(user), staleTime: 5 * 60_000, refetchOnWindowFocus: false } });
  const announcementsQuery = useGetAnnouncements({ query: { queryKey: getGetAnnouncementsQueryKey(), enabled: Boolean(user), staleTime: 5 * 60_000, refetchOnWindowFocus: false } });
  const [preset, setPreset] = useState<RangePreset>('90');
  const [fromDate, setFromDate] = useState(() => localDateInput(new Date(Date.now() - 90 * 86400000)));
  const [toDate, setToDate] = useState(() => localDateInput(new Date()));
  const [autoMinutes, setAutoMinutes] = useState('off');
  const deposits = depositsQuery.data?.deposits ?? [];
  useEffect(() => { document.title = 'Dashboard | ReplenishCC'; }, []);
  useEffect(() => {
    if (!session.isLoading && (session.isError || !session.data?.authenticated)) setLocation('/login');
  }, [session.data?.authenticated, session.isError, session.isLoading, setLocation]);
  useEffect(() => {
    if (autoMinutes === 'off') return;
    const minutes = Math.max(5, Number(autoMinutes) || 5);
    const timer = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: getGetMyDepositsQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetAnnouncementsQueryKey() });
    }, minutes * 60_000);
    return () => window.clearInterval(timer);
  }, [autoMinutes, queryClient]);
  const filteredDeposits = useMemo(() => deposits.filter((deposit) => {
    const created = new Date(deposit.createdAt).getTime();
    const start = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : -Infinity;
    const end = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : Infinity;
    return created >= start && created <= end;
  }), [deposits, fromDate, toDate]);
  const chartData = useMemo(() => {
    const months = new Map<string, { label: string; count: number; total: number; confirmed: number }>();
    filteredDeposits.forEach((deposit) => {
      const date = new Date(deposit.createdAt);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const record = months.get(key) ?? { label: date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), count: 0, total: 0, confirmed: 0 };
      record.count += 1;
      record.total += deposit.amountCents;
      if (deposit.status === 'confirmed') record.confirmed += deposit.amountCents;
      months.set(key, record);
    });
    return [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
  }, [filteredDeposits]);
  const announcements = announcementsQuery.data?.announcements ?? [];
  const recentDeposits = [...filteredDeposits].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5);
  const setRange = (value: RangePreset) => {
    setPreset(value);
    if (value !== 'custom') {
      setToDate(localDateInput(new Date()));
      setFromDate(localDateInput(new Date(Date.now() - Number(value) * 86400000)));
    }
  };
  const depositCsv = () => downloadCsv('replenishcc-deposit-activity.csv', [['Month', 'Deposit count', 'Total amount cents', 'Confirmed amount cents'], ...chartData.map((item) => [item.label, item.count, item.total, item.confirmed])]);
  const statusCsv = () => downloadCsv('replenishcc-deposit-status.csv', [['Status', 'Count'], ...['confirmed', 'pending', 'rejected', 'failed', 'expired', 'refunded'].map((status) => [statusName(status), filteredDeposits.filter((d) => d.status === status).length])]);

  if (session.isLoading || !user) return <MemberShell pageTitle="Dashboard" user={null} loading />;
  const loading = depositsQuery.isLoading;
  const depositError = depositsQuery.isError;
  const balance = depositsQuery.data?.balanceCents;
  return (
    <MemberShell pageTitle="Dashboard" user={user} contentClassName="member-dashboard-content">
      <div className="workspace-page">
        <section className="workspace-panel announcement-panel announcement-top-panel" aria-labelledby="dashboard-announcements-title">
          <div className="workspace-panel-head announcement-top-head"><div><div className="section-kicker"><Megaphone aria-hidden="true" /> From ReplenishCC</div><h2 id="dashboard-announcements-title">Service announcements</h2><p>Updates from the team that matter to your account.</p></div><span className="announcement-count">{announcements.length} {announcements.length === 1 ? 'update' : 'updates'}</span></div>
          {announcementsQuery.isLoading ? <div className="table-skeleton"><span /><span /></div> : announcementsQuery.isError ? <div className="inline-error" role="alert">Announcements are temporarily unavailable. <button type="button" onClick={() => void announcementsQuery.refetch()}>Retry</button></div> : announcements.length ? <div className="announcement-list">{announcements.slice(0, 3).map((item) => <article className="member-announcement" key={item.id}><div className="announcement-date">{dateLabel(item.publishedAt || item.createdAt)}</div><div><h3>{item.title}</h3><p>{item.body}</p></div></article>)}</div> : <div className="inline-empty">No service updates right now. Important announcements will be posted here.</div>}
        </section>

        <header className="workspace-heading">
          <div><div className="section-kicker"><ShieldCheck aria-hidden="true" /> Member workspace · Secure session</div><h1>Good to see you, {user.fullName.split(/\s+/)[0]}.</h1><p>Your balance and deposit activity, in one clear view.</p></div>
          <div className="workspace-heading-actions">
            <button className="workspace-secondary-button" type="button" onClick={() => window.print()} data-testid="button-print-dashboard"><FileText aria-hidden="true" /> Print / save PDF</button>
            <button className="workspace-secondary-button" type="button" onClick={() => { void depositsQuery.refetch(); void announcementsQuery.refetch(); }} disabled={depositsQuery.isFetching || announcementsQuery.isFetching} data-testid="button-refresh-dashboard"><RefreshCw className={depositsQuery.isFetching || announcementsQuery.isFetching ? 'icon-rotating' : ''} aria-hidden="true" /> Refresh</button>
          </div>
        </header>

        <section className="balance-feature">
          <div className="balance-feature-copy"><div className="section-kicker">Available balance</div>
            {loading ? <div className="balance-skeleton skeleton" /> : depositError ? <div className="balance-failed"><CircleAlert aria-hidden="true" /> Balance unavailable</div> : <strong className="balance-amount" data-testid="text-member-balance">{money(balance ?? 0)}</strong>}
            <span className="balance-caption">Current account balance</span>
          </div>
          <div className="balance-feature-mark"><WalletCards aria-hidden="true" /></div>
          <Link href="/my-deposits" className="balance-history-link" data-testid="link-balance-history">View deposit history <ExternalLink aria-hidden="true" /></Link>
          <div className="balance-rule" />
          <div className="balance-metric"><span>Records in range</span><strong>{loading ? '—' : filteredDeposits.length}</strong></div>
          <div className="balance-metric"><span>Confirmed in range</span><strong>{loading ? '—' : money(filteredDeposits.filter((d) => d.status === 'confirmed').reduce((sum, d) => sum + d.amountCents, 0))}</strong></div>
        </section>

        <section className="analytics-toolbar" aria-label="Analytics controls">
          <div className="range-control">
            <span className="toolbar-label"><CalendarDays aria-hidden="true" /> Date range</span>
            <div className="range-presets" role="group" aria-label="Date range preset">
              {(['30', '90', '365', 'custom'] as const).map((value) => <button key={value} type="button" className={preset === value ? 'range-chip selected' : 'range-chip'} onClick={() => setRange(value)} aria-pressed={preset === value} data-testid={`button-range-${value}`}>{value === 'custom' ? 'Custom' : `${value} days`}</button>)}
            </div>
            <div className="date-fields"><label>From<input type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); setPreset('custom'); }} aria-label="Start date" data-testid="input-date-from" /></label><span>to</span><label>To<input type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); setPreset('custom'); }} aria-label="End date" data-testid="input-date-to" /></label></div>
          </div>
          <label className="auto-refresh-control"><span className="toolbar-label"><Clock3 aria-hidden="true" /> Auto-refresh</span><select value={autoMinutes} onChange={(event) => setAutoMinutes(event.target.value)} aria-label="Auto-refresh interval" data-testid="select-auto-refresh"><option value="off">Off</option><option value="5">Every 5 minutes</option><option value="15">Every 15 minutes</option><option value="30">Every 30 minutes</option></select></label>
        </section>

        {depositError && <div className="workspace-error" role="alert"><CircleAlert aria-hidden="true" /><span>We couldn’t load your deposit data.</span><button type="button" onClick={() => void depositsQuery.refetch()}>Try again</button></div>}
        {loading ? <LoadingPanel /> : !depositError && deposits.length === 0 ? <div className="workspace-empty first-empty"><div className="empty-emblem"><WalletCards aria-hidden="true" /></div><div className="section-kicker">Your records</div><h2>Your deposit activity will appear here.</h2><p>There are no deposit records on this account yet. Once a deposit is submitted, its status and activity will show here.</p><Link className="workspace-primary-button" href="/deposits"><ArrowDownToLine aria-hidden="true" /> Start a deposit</Link></div> : !depositError && <div className="workspace-analytics-grid">
          <DepositChart data={chartData} onDownload={depositCsv} />
          <StatusChart deposits={filteredDeposits} onDownload={statusCsv} />
        </div>}

        <section className="workspace-panel recent-panel">
          <div className="workspace-panel-head"><div><div className="section-kicker">Ledger</div><h2>Recent deposits</h2><p>Latest activity from your account records.</p></div><Link href="/my-deposits" className="panel-text-link">Full history <ExternalLink aria-hidden="true" /></Link></div>
          {loading ? <div className="table-skeleton"><span /><span /><span /></div> : depositError ? <div className="inline-empty">Activity cannot be shown while deposit data is unavailable.</div> : recentDeposits.length ? <div className="deposit-list">
            {recentDeposits.map((deposit) => <div className="deposit-list-row" key={deposit.id} data-testid={`row-recent-deposit-${deposit.id}`}>
              <div className="deposit-method-mark"><WalletCards aria-hidden="true" /></div><div className="deposit-record-main"><strong>{deposit.method === 'nowpayments' ? 'Crypto deposit' : `${deposit.method === 'cashapp' ? 'Cash App' : 'Chime'} deposit`}</strong><span>{dateLabel(deposit.createdAt)}{deposit.referenceCode ? ` · Ref ${deposit.referenceCode}` : ''}</span></div>
              <span className={`deposit-status-pill status-pill-${deposit.status}`}><i />{statusName(deposit.status)}</span><strong className="deposit-record-amount">{money(deposit.amountCents)}</strong>
            </div>)}
          </div> : <div className="inline-empty">No deposit activity in the selected range.</div>}
        </section>

        <p className="data-integrity-note"><ShieldCheck aria-hidden="true" /> Account figures reflect your authenticated deposit records. No purchase or order totals are included.</p>
      </div>
    </MemberShell>
  );
}