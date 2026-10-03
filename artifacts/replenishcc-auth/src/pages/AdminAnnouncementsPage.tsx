import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, Check, CircleAlert, ExternalLink, LoaderCircle, Megaphone, RotateCcw, Send, ShieldCheck } from 'lucide-react';
import {
  getGetAdminAnnouncementsQueryKey, getGetAnnouncementsQueryKey, useCreateAnnouncement,
  useGetAdminAnnouncements, useGetAuthMe, useUpdateAnnouncement, type Announcement,
} from '@workspace/api-client-react';
import { useLocation } from 'wouter';
import { MemberShell } from '../components/MemberShell';

const readableDate = (value: string) => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
function isTelegramChannelUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.port === '' && !url.username && !url.password
      && ['t.me', 'telegram.me'].includes(url.hostname.toLowerCase()) && url.pathname.length > 1;
  } catch {
    return false;
  }
}
function messageFrom(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'The request could not be completed. Please try again.';
}
function AnnouncementCard({ item, onAction, busy }: { item: Announcement; onAction: (item: Announcement, action: 'archive' | 'restore') => void; busy: boolean }) {
  const archived = Boolean(item.archivedAt);
  return <article className={`admin-announcement-card${archived ? ' is-archived' : ''}`} data-testid={`card-announcement-${item.id}`}>
    <div className="admin-announcement-card-top"><div className="announcement-card-badges"><span className={archived ? 'publish-state archived' : 'publish-state'}><i />{archived ? 'Archived' : 'Published'}</span><span className={item.showAsPopup ? 'announcement-popup-badge' : 'announcement-banner-badge'}>{item.showAsPopup ? 'Telegram pop-up' : 'Dashboard banner'}</span></div><span className="announcement-created">Created {readableDate(item.createdAt)}</span></div>
    <h3>{item.title}</h3><p>{item.body}</p>
    {item.showAsPopup && item.telegramUrl && <a className="announcement-telegram-link" href={item.telegramUrl} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" />{item.telegramButtonText}</a>}
    <div className="admin-announcement-card-foot"><span>{archived ? `Archived ${readableDate(item.archivedAt!)}` : `Published ${readableDate(item.publishedAt)}`}</span>
      <button type="button" className={archived ? 'admin-action-button restore-action' : 'admin-action-button'} disabled={busy} onClick={() => onAction(item, archived ? 'restore' : 'archive')} data-testid={`${archived ? 'button-restore' : 'button-archive'}-${item.id}`}>
        {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : archived ? <RotateCcw aria-hidden="true" /> : <Archive aria-hidden="true" />}{archived ? 'Restore' : 'Archive'}
      </button>
    </div>
  </article>;
}

export function AdminAnnouncementsPage() {
  const session = useGetAuthMe();
  const [, setLocation] = useLocation();
  const client = useQueryClient();
  const user = session.data?.authenticated ? session.data.user : null;
  const adminQuery = useGetAdminAnnouncements({ query: { queryKey: getGetAdminAnnouncementsQueryKey(), enabled: Boolean(user?.isDepositAdmin) } });
  const create = useCreateAnnouncement();
  const update = useUpdateAnnouncement();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [displayType, setDisplayType] = useState<'banner' | 'popup'>('banner');
  const [telegramUrl, setTelegramUrl] = useState('');
  const [telegramButtonText, setTelegramButtonText] = useState('Visit Telegram channel');
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [filter, setFilter] = useState<'all' | 'published' | 'archived'>('all');
  useEffect(() => { document.title = 'Announcements | ReplenishCC Admin'; }, []);
  useEffect(() => {
    if (!session.isLoading && (!session.data?.authenticated || session.isError)) setLocation('/login');
    else if (!session.isLoading && user && !user.isDepositAdmin) setLocation('/dashboard');
  }, [session.data?.authenticated, session.isError, session.isLoading, setLocation, user]);
  const items = adminQuery.data?.announcements ?? [];
  const visibleItems = items.filter((item) => filter === 'all' || (filter === 'archived' ? Boolean(item.archivedAt) : !item.archivedAt));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    const cleanBody = body.trim();
    const showAsPopup = displayType === 'popup';
    if (!cleanTitle || !cleanBody) {
      setNotice({ kind: 'error', text: 'Add a title and message before publishing.' });
      return;
    }
    const cleanTelegramUrl = telegramUrl.trim();
    if (showAsPopup && !isTelegramChannelUrl(cleanTelegramUrl)) {
      setNotice({ kind: 'error', text: 'Enter a valid HTTPS Telegram channel link from t.me or telegram.me.' });
      return;
    }
    setNotice(null);
    const cleanButtonText = telegramButtonText.trim() || 'Visit Telegram channel';
    create.mutate({ data: { title: cleanTitle, body: cleanBody, showAsPopup, telegramUrl: showAsPopup ? cleanTelegramUrl : null, telegramButtonText: showAsPopup ? cleanButtonText : null } }, {
      onSuccess: () => {
        setTitle(''); setBody(''); setDisplayType('banner'); setTelegramUrl(''); setTelegramButtonText('Visit Telegram channel');
        setNotice({ kind: 'success', text: showAsPopup ? 'Telegram pop-up published. Signed-in members will see it once until dismissed.' : 'Announcement banner published in the member dashboard.' });
        void client.invalidateQueries({ queryKey: getGetAnnouncementsQueryKey() });
        void client.invalidateQueries({ queryKey: getGetAdminAnnouncementsQueryKey() });
      },
      onError: (error) => setNotice({ kind: 'error', text: messageFrom(error) }),
    });
  };
  const changeStatus = (item: Announcement, action: 'archive' | 'restore') => {
    setNotice(null);
    update.mutate({ announcementId: item.id, data: { action } }, {
      onSuccess: () => {
        setNotice({ kind: 'success', text: action === 'archive' ? 'Announcement moved to the archive.' : 'Announcement restored and published.' });
        void client.invalidateQueries({ queryKey: getGetAnnouncementsQueryKey() });
        void client.invalidateQueries({ queryKey: getGetAdminAnnouncementsQueryKey() });
      },
      onError: (error) => setNotice({ kind: 'error', text: messageFrom(error) }),
    });
  };
  if (session.isLoading || !user || !user.isDepositAdmin) return <MemberShell pageTitle="Announcements" user={null} loading />;
  return <MemberShell pageTitle="Announcements" user={user} contentClassName="member-dashboard-content">
    <div className="workspace-page admin-announcements-page">
      <header className="workspace-heading">
        <div><div className="section-kicker"><ShieldCheck aria-hidden="true" /> Administration · Member communications</div><h1>Announcements</h1><p>Publish service updates for every ReplenishCC member.</p></div>
        <div className="admin-access-mark"><ShieldCheck aria-hidden="true" /> Deposit administrator</div>
      </header>
      <div className="admin-announcements-layout">
        <section className="workspace-panel announcement-compose">
          <div className="compose-title"><div className="compose-icon"><Megaphone aria-hidden="true" /></div><div><div className="section-kicker">New message</div><h2>Write an announcement</h2></div></div>
          <p className="compose-intro">Published messages appear in member dashboards. Keep updates clear and specific.</p>
          {notice && <div className={`admin-feedback ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.kind === 'success' ? <Check aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}{notice.text}</div>}
          <form className="announcement-form" onSubmit={submit}>
            <label className="finance-label" htmlFor="announcement-title">Title <span>{title.length}/120</span></label>
            <input id="announcement-title" className="announcement-input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required placeholder="A concise update title" data-testid="input-announcement-title" />
            <label className="finance-label" htmlFor="announcement-body">Message <span>{body.length}/2000</span></label>
            <textarea id="announcement-body" className="announcement-input announcement-textarea" value={body} onChange={(event) => setBody(event.target.value)} maxLength={2000} required placeholder="Share the details members need to know." data-testid="input-announcement-body" />
            <fieldset className="announcement-display-selector">
              <legend>Choose one display format</legend>
              <label className={`announcement-popup-option${displayType === 'banner' ? ' selected' : ''}`}>
                <input type="radio" name="announcement-display-type" value="banner" checked={displayType === 'banner'} onChange={() => setDisplayType('banner')} data-testid="radio-announcement-banner" />
                <span><strong>Announcements banner</strong><small>Show this update in the member dashboard announcement panel.</small></span>
              </label>
              <label className={`announcement-popup-option${displayType === 'popup' ? ' selected' : ''}`}>
                <input type="radio" name="announcement-display-type" value="popup" checked={displayType === 'popup'} onChange={() => setDisplayType('popup')} data-testid="radio-announcement-popup" />
                <span><strong>Telegram pop-up</strong><small>Show a pop-up to signed-in members instead of adding it to the dashboard banner.</small></span>
              </label>
            </fieldset>
            {showAsPopup && <>
              <label className="finance-label" htmlFor="announcement-telegram-url">Telegram channel URL</label>
              <input id="announcement-telegram-url" className="announcement-input" type="url" value={telegramUrl} onChange={(event) => setTelegramUrl(event.target.value)} required maxLength={2048} placeholder="https://t.me/yourchannel" data-testid="input-announcement-telegram-url" />
              <label className="finance-label" htmlFor="announcement-telegram-button-text">Pop-up button text <span>{telegramButtonText.length}/60</span></label>
              <input id="announcement-telegram-button-text" className="announcement-input" value={telegramButtonText} onChange={(event) => setTelegramButtonText(event.target.value)} required maxLength={60} placeholder="Visit Telegram channel" data-testid="input-announcement-telegram-button-text" />
              <p className="announcement-popup-hint">Use a secure channel link on t.me or telegram.me.</p>
            </>}
            <div className="compose-form-foot"><span>Posts publish immediately.</span><button type="submit" className="workspace-primary-button" disabled={create.isPending} data-testid="button-publish-announcement">{create.isPending ? <LoaderCircle className="spin" aria-hidden="true" /> : <Send aria-hidden="true" />}{create.isPending ? 'Publishing…' : 'Publish update'}</button></div>
          </form>
        </section>
        <section className="workspace-panel archive-workspace">
          <div className="workspace-panel-head"><div><div className="section-kicker">Message archive</div><h2>Published updates</h2><p>Restore archived posts at any time.</p></div><button type="button" className="workspace-icon-button" onClick={() => void adminQuery.refetch()} disabled={adminQuery.isFetching} aria-label="Refresh announcements" data-testid="button-refresh-announcements"><RotateCcw className={adminQuery.isFetching ? 'icon-rotating' : ''} aria-hidden="true" /></button></div>
          <div className="announcement-filter" role="group" aria-label="Filter announcements">{(['all', 'published', 'archived'] as const).map((option) => <button type="button" key={option} onClick={() => setFilter(option)} className={filter === option ? 'range-chip selected' : 'range-chip'} aria-pressed={filter === option} data-testid={`button-filter-${option}`}>{option === 'all' ? `All · ${items.length}` : option === 'published' ? `Published · ${items.filter((item) => !item.archivedAt).length}` : `Archived · ${items.filter((item) => item.archivedAt).length}`}</button>)}</div>
          {adminQuery.isLoading ? <div className="table-skeleton"><span /><span /><span /></div> : adminQuery.isError ? <div className="announcement-query-error" role="alert"><CircleAlert aria-hidden="true" /><span>Couldn’t load the announcement archive.</span><button type="button" className="workspace-secondary-button" onClick={() => void adminQuery.refetch()}>Try again</button></div> : visibleItems.length ? <div className="admin-announcement-list">{visibleItems.map((item) => <AnnouncementCard key={item.id} item={item} onAction={changeStatus} busy={update.isPending && update.variables?.announcementId === item.id} />)}</div> : <div className="workspace-empty compact"><Archive aria-hidden="true" /><strong>{filter === 'archived' ? 'Nothing archived' : filter === 'published' ? 'No published announcements' : 'The archive is clear'}</strong><span>{filter === 'archived' ? 'Archived announcements will be available here.' : 'Your next service update can be published from this page.'}</span></div>}
        </section>
      </div>
    </div>
  </MemberShell>;
}