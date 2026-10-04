import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, ArrowRight, Check, CircleAlert, Clock3, Copy, Headphones, MessageSquareText,
  RefreshCw, Send, ShieldCheck, Ticket, WalletCards,
} from 'lucide-react';
import {
  getGetAdminSupportTicketsQueryKey, getGetMyDepositsQueryKey, getGetMySupportOrdersQueryKey, getGetMySupportTicketsQueryKey,
  getGetSupportTicketQueryKey, useCreateSupportTicket, useCreateSupportTicketRefund,
  useGetAdminSupportTickets, useGetAuthMe, useGetMySupportOrders, useGetMySupportTickets, useGetSupportTicket,
  usePatchAdminSupportTicketStatus, usePostSupportTicketMessage,
  type AdminSupportTicket, type AuthMeResponse, type SupportOrder, type SupportTicket, type SupportTicketCategory, type SupportTicketInputCategory, type SupportTicketMessage, type SupportTicketStatus,
} from '@workspace/api-client-react';
import { Link, useLocation, useParams } from 'wouter';
import { Form } from '@/components/ui/form';
import { MemberShell } from '../components/MemberShell';
import './SupportPages.css';

const categoryLabels: Record<SupportTicketCategory, string> = {
  account: 'Account access',
  deposit_balance: 'Deposits & balance',
  purchase: 'Purchase',
  other: 'Other',
  card_purchase: 'Card Purchase',
  log_purchase: 'Log Purchase',
  deposits: 'Deposits',
};
const categoryOptions: SupportTicketInputCategory[] = ['card_purchase', 'log_purchase', 'deposits'];
const statusLabels: Record<SupportTicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};
const statuses: SupportTicketStatus[] = ['open', 'in_progress', 'resolved', 'closed'];

function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function dollars(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object') {
    const candidate = error as { message?: unknown; error?: unknown; response?: { data?: { error?: unknown } } };
    if (typeof candidate.response?.data?.error === 'string') return candidate.response.data.error;
    if (typeof candidate.error === 'string') return candidate.error;
    if (typeof candidate.message === 'string') return candidate.message;
  }
  return 'We could not complete that request. Please try again.';
}

function PortalGate({ title, children }: { title: string; children: (user: NonNullable<AuthMeResponse['user']>) => ReactNode }) {
  const session = useGetAuthMe();
  const [, setLocation] = useLocation();
  useEffect(() => {
    if (!session.isLoading && (!session.data?.authenticated || session.isError || !session.data.user)) setLocation('/login');
  }, [session.data?.authenticated, session.data?.user, session.isError, session.isLoading, setLocation]);
  if (session.isLoading || !session.data?.user) return <MemberShell pageTitle={title} user={null} loading />;
  return <MemberShell pageTitle={title} user={session.data.user} contentClassName="member-dashboard-content">{children(session.data.user)}</MemberShell>;
}

function Heading({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: ReactNode }) {
  return <header className="workspace-heading support-heading">
    <div><div className="section-kicker"><Headphones aria-hidden="true" /> {eyebrow}</div><h1>{title}</h1><p>{copy}</p></div>
    {action && <div className="workspace-heading-actions">{action}</div>}
  </header>;
}

function Alert({ children, kind = 'error' }: { children: ReactNode; kind?: 'error' | 'success' | 'info' }) {
  const Icon = kind === 'success' ? Check : CircleAlert;
  return <div className={`support-alert support-alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'} data-testid={`status-support-${kind}`}>
    <Icon aria-hidden="true" /><span>{children}</span>
  </div>;
}

function QueryError({ error, retry, label }: { error: unknown; retry: () => void; label: string }) {
  return <div className="support-query-error" role="alert" data-testid="error-support-query">
    <CircleAlert aria-hidden="true" /><div><strong>{label}</strong><span>{errorText(error)}</span></div>
    <button type="button" className="workspace-secondary-button" onClick={retry} data-testid="button-retry-support"><RefreshCw aria-hidden="true" /> Retry</button>
  </div>;
}

function SkeletonRows({ count = 3 }: { count?: number }) {
  return <div className="support-skeleton-list" aria-busy="true" aria-label="Loading support tickets" data-testid="loading-support-tickets">
    {Array.from({ length: count }, (_, index) => <div className="support-skeleton-row" key={index}><span /><span /><span /></div>)}
  </div>;
}

function StatusPill({ status }: { status: SupportTicketStatus }) {
  return <span className={`support-status status-${status}`} data-testid={`status-ticket-${status}`}><i aria-hidden="true" />{statusLabels[status]}</span>;
}

type TicketForm = {
  category: SupportTicketInputCategory;
  subject: string;
  orderReference: string;
  message: string;
};

export function CreateSupportTicketPage() {
  const create = useCreateSupportTicket();
  const session = useGetAuthMe();
  const orders = useGetMySupportOrders({
    query: {
      queryKey: getGetMySupportOrdersQueryKey(),
      enabled: Boolean(session.data?.user),
    },
  });
  const client = useQueryClient();
  const [, setLocation] = useLocation();
  const [feedback, setFeedback] = useState<{ kind: 'error'; text: string } | null>(null);
  const form = useForm<TicketForm>({
    defaultValues: { category: 'card_purchase', subject: '', orderReference: '', message: '' },
  });
  const categoryField = form.register('category', { required: true });
  const selectedCategory = form.watch('category');
  const selectedOrderId = form.watch('orderReference');
  const categoryOrders = orders.data?.orders.filter((order) => order.category === selectedCategory) ?? [];
  const selectedOrder = categoryOrders.find((order) => order.id === selectedOrderId);
  useEffect(() => { document.title = 'Create a support ticket | ReplenishCC'; }, []);

  const submit = form.handleSubmit((values) => {
    const subject = values.subject.trim();
    const message = values.message.trim();
    const orderReference = values.orderReference.trim();
    if (!subject || !message) {
      setFeedback({ kind: 'error', text: 'Add a subject and a first message to continue.' });
      return;
    }
    setFeedback(null);
    create.mutate({
      data: {
        category: values.category,
        subject,
        ...(orderReference ? { orderReference } : {}),
        message,
      },
    }, {
      onSuccess: (response) => {
        void client.invalidateQueries({ queryKey: getGetMySupportTicketsQueryKey() });
        void client.invalidateQueries({ queryKey: getGetAdminSupportTicketsQueryKey() });
        setLocation(`/support/tickets/${encodeURIComponent(response.ticket.id)}`);
      },
      onError: (error) => setFeedback({ kind: 'error', text: errorText(error) }),
    });
  });

  return <PortalGate title="Create support ticket">{(user) => <>
    <div className="workspace-page support-page">
      <Heading eyebrow="Member care" title="Create a support ticket" copy="Tell us what you need help with. Your request will stay in your account for follow-up." action={<Link href="/support/tickets" className="workspace-secondary-button" data-testid="link-my-support-tickets"><ArrowLeft aria-hidden="true" /> My tickets</Link>} />
      <div className="support-compose-layout">
        <section className="workspace-panel support-form-panel" aria-labelledby="support-create-title">
          <div className="support-panel-heading"><span className="support-icon"><MessageSquareText aria-hidden="true" /></span><div><div className="section-kicker">New conversation</div><h2 id="support-create-title">How can we help?</h2></div></div>
          <p className="support-panel-copy">A clear subject and a little context help us route your request.</p>
          {feedback && <Alert>{feedback.text}</Alert>}
          <Form {...form}>
            <form className="support-form" onSubmit={submit} noValidate>
              <div className="support-field">
                <label htmlFor="support-category">Category</label>
                <select id="support-category" {...categoryField} onChange={(event) => {
                  categoryField.onChange(event);
                  form.setValue('orderReference', '');
                }} data-testid="select-support-category">
                  {categoryOptions.map((category) => <option value={category} key={category}>{categoryLabels[category]}</option>)}
                </select>
              </div>
              <div className="support-field">
                <label htmlFor="support-subject">Subject</label>
                <input id="support-subject" maxLength={140} placeholder="A short summary of your request" {...form.register('subject', { required: 'Enter a subject.' })} aria-invalid={Boolean(form.formState.errors.subject)} data-testid="input-support-subject" />
                {form.formState.errors.subject && <small className="support-field-error">{form.formState.errors.subject.message}</small>}
                <small className="support-counter">{form.watch('subject').length}/140</small>
              </div>
              {selectedCategory !== 'deposits' && <div className="support-field">
                <label htmlFor="support-order-reference">Order ID <span>Optional · verified against your account</span></label>
                <select id="support-order-reference" {...form.register('orderReference')} data-testid="input-support-order-reference">
                  <option value="">No order linked</option>
                  {categoryOrders.map((order) => <option value={order.id} key={order.id}>{order.productName} · {order.quantity} item{order.quantity === 1 ? '' : 's'} · {dollars(order.totalCents)} · {dateTime(order.createdAt)}</option>)}
                </select>
                {selectedOrder && <div className="support-selected-order" data-testid="text-selected-support-order">
                  <strong>Selected order ID</strong><code>{selectedOrder.id}</code>
                </div>}
                {orders.isLoading && <small className="support-field-note">Loading your card and log purchase orders…</small>}
                {orders.isError && <small className="support-field-error">Your orders could not be checked. You can continue without linking an order.</small>}
                {!orders.isLoading && !orders.isError && categoryOrders.length === 0 && <small className="support-field-note">No orders of this type are available to link.</small>}
                <small className="support-field-note">Only orders in your account that match this ticket category can be selected.</small>
              </div>}
              <div className="support-field">
                <label htmlFor="support-message">First message</label>
                <textarea id="support-message" rows={7} maxLength={4000} placeholder="Include the details that will help us understand your request." {...form.register('message', { required: 'Write a first message.', maxLength: { value: 4000, message: 'Keep your message under 4,000 characters.' } })} aria-invalid={Boolean(form.formState.errors.message)} data-testid="textarea-support-message" />
                {form.formState.errors.message && <small className="support-field-error">{form.formState.errors.message.message}</small>}
                <small className="support-counter">{form.watch('message').length}/4,000</small>
              </div>
              <div className="support-form-foot"><span>Signed in as <strong data-testid="text-support-member-email">{user.email}</strong></span>
                <button className="workspace-primary-button" type="submit" disabled={create.isPending} data-testid="button-create-support-ticket">{create.isPending ? 'Creating ticket…' : <>Create ticket <ArrowRight aria-hidden="true" /></>}</button>
              </div>
            </form>
          </Form>
        </section>
      </div>
    </div>
  </>}</PortalGate>;
}

function TicketList({ ticket, admin = false }: { ticket: SupportTicket | AdminSupportTicket; admin?: boolean }) {
  const adminTicket = ticket as AdminSupportTicket;
  return <Link href={`/support/tickets/${encodeURIComponent(ticket.id)}`} className="support-ticket-row" data-testid={`link-support-ticket-${ticket.id}`}>
    <span className="support-ticket-mark"><Ticket aria-hidden="true" /></span>
    <span className="support-ticket-main">
      <strong data-testid={`text-ticket-subject-${ticket.id}`}>{ticket.subject}</strong>
      <span>{categoryLabels[ticket.category]} · Updated <time dateTime={ticket.updatedAt} data-testid={`text-ticket-updated-${ticket.id}`}>{dateTime(ticket.updatedAt)}</time></span>
      {admin && <small data-testid={`text-ticket-member-${ticket.id}`}>{adminTicket.memberName} · {adminTicket.memberEmail}</small>}
      {admin && ticket.orderReference && <small className={`support-ticket-order-match ${adminTicket.orderMatchStatus === 'verified' ? 'is-verified' : 'is-unmatched'}`} data-testid={`status-ticket-order-match-${ticket.id}`}>
        {adminTicket.orderMatchStatus === 'verified' ? 'Order ID verified' : 'Order ID not matched'}
      </small>}
    </span>
    <span className="support-ticket-side"><StatusPill status={ticket.status} /><span className="support-ticket-id">#{ticket.id}</span></span>
    <ArrowRight className="support-ticket-arrow" aria-hidden="true" />
  </Link>;
}

type OrderCopyState = 'idle' | 'copied' | 'failed';

function SupportOrderCard({
  reference,
  order,
  copyState,
  onCopy,
}: {
  reference: string;
  order: SupportOrder | null;
  copyState: OrderCopyState;
  onCopy: () => void;
}) {
  return <section className="workspace-panel support-detail-card support-order-card" aria-labelledby="support-order-title" data-testid="card-support-order">
    <div className="section-kicker"><Ticket aria-hidden="true" /> Order verification</div>
    <h2 id="support-order-title">{order ? 'Verified order' : 'Order not matched'}</h2>
    <div className="support-order-id-row">
      <code data-testid="text-support-order-id">{reference}</code>
      <button type="button" className="support-copy-order-button" onClick={onCopy} aria-label="Copy order ID" data-testid="button-copy-support-order-id">
        {copyState === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {copyState === 'copied' ? 'Copied' : 'Copy ID'}
      </button>
    </div>
    {copyState === 'failed' && <small className="support-order-copy-status" role="status">Copy failed. Select the order ID to copy it manually.</small>}
    {order ? <>
      <div className="support-order-verified-summary">
        <strong>{order.productName}</strong>
        <span>{order.category === 'card_purchase' ? 'Gift-card purchase' : 'Log purchase'} · {order.quantity} item{order.quantity === 1 ? '' : 's'} · {dollars(order.totalCents)}</span>
      </div>
      <details className="support-order-details" data-testid="details-support-order">
        <summary>View order details</summary>
        <dl className="support-detail-facts">
          <div><dt>Order type</dt><dd>{order.category === 'card_purchase' ? 'Gift card' : 'Log'}</dd></div>
          <div><dt>Product</dt><dd>{order.productName}</dd></div>
          <div><dt>Order details</dt><dd>{order.description || '—'}</dd></div>
          <div><dt>Quantity</dt><dd>{order.quantity}</dd></div>
          <div><dt>Order total</dt><dd>{dollars(order.totalCents)}</dd></div>
          <div><dt>Placed</dt><dd>{dateTime(order.createdAt)}</dd></div>
        </dl>
      </details>
    </> : <p className="support-order-unmatched">This ID does not match an order in this member’s account for the ticket category.</p>}
  </section>;
}

export function MySupportTicketsPage() {
  const tickets = useGetMySupportTickets({ query: { queryKey: getGetMySupportTicketsQueryKey() } });
  useEffect(() => { document.title = 'My support tickets | ReplenishCC'; }, []);
  return <PortalGate title="My support tickets">{() => {
    const items = tickets.data?.tickets ?? [];
    return <div className="workspace-page support-page">
      <Heading eyebrow="Member care" title="My support tickets" copy="Follow your open requests and return to any previous conversation." action={<Link href="/support/create" className="workspace-primary-button" data-testid="link-create-support-ticket"><MessageSquareText aria-hidden="true" /> New ticket</Link>} />
      <section className="workspace-panel support-list-panel" aria-labelledby="support-list-title">
        <div className="workspace-panel-head support-list-head"><div><div className="section-kicker">Your account record</div><h2 id="support-list-title">Ticket history</h2><p data-testid="text-support-ticket-count">{tickets.data ? `${items.length} ${items.length === 1 ? 'ticket' : 'tickets'}` : 'Your submitted requests'}</p></div>
          <button type="button" className="workspace-icon-button" onClick={() => void tickets.refetch()} disabled={tickets.isFetching} aria-label="Refresh support tickets" data-testid="button-refresh-support-tickets"><RefreshCw aria-hidden="true" /></button>
        </div>
        {tickets.isLoading ? <SkeletonRows /> : tickets.isError ? <QueryError error={tickets.error} retry={() => void tickets.refetch()} label="Ticket history could not be loaded." /> : items.length ? <div className="support-ticket-list" data-testid="list-my-support-tickets">{items.map((ticket) => <TicketList ticket={ticket} key={ticket.id} />)}</div> : <div className="workspace-empty first-empty support-empty" data-testid="empty-my-support-tickets">
          <span className="empty-emblem"><MessageSquareText aria-hidden="true" /></span><div className="section-kicker">A clear start</div><h2>No support tickets yet</h2><p>When you send a request, its status and replies will be available here.</p><Link href="/support/create" className="workspace-primary-button" data-testid="link-empty-create-support-ticket">Create a ticket <ArrowRight aria-hidden="true" /></Link>
        </div>}
      </section>
    </div>;
  }}</PortalGate>;
}

function MessageCard({ message, viewerIsAdmin }: { message: SupportTicketMessage; viewerIsAdmin: boolean }) {
  const isAdmin = message.authorRole === 'admin';
  return <article className={`support-message${isAdmin ? ' from-admin' : ''}`} data-testid={`card-support-message-${message.id}`}>
    <div className="support-message-avatar" aria-hidden="true">{message.authorName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || (isAdmin ? 'A' : 'M')}</div>
    <div className="support-message-content">
      <header><strong data-testid={`text-message-author-${message.id}`}>{message.authorName}</strong><span className={`support-role ${isAdmin ? 'admin' : ''}`}>{isAdmin ? 'Support team' : viewerIsAdmin ? 'Member' : 'You'}</span><time dateTime={message.createdAt} data-testid={`text-message-created-${message.id}`}>{dateTime(message.createdAt)}</time></header>
      <p data-testid={`text-message-body-${message.id}`}>{message.body}</p>
    </div>
  </article>;
}

type ReplyForm = { message: string };
type RefundForm = { amount: string; reason: string };

export function SupportTicketDetailPage() {
  const { ticketId = '' } = useParams<{ ticketId: string }>();
  const session = useGetAuthMe();
  const isAdmin = Boolean(session.data?.user?.isDepositAdmin);
  const client = useQueryClient();
  const detail = useGetSupportTicket(ticketId, { query: { enabled: Boolean(ticketId), queryKey: getGetSupportTicketQueryKey(ticketId) } });
  const postMessage = usePostSupportTicketMessage();
  const changeStatus = usePatchAdminSupportTicketStatus();
  const refundMutation = useCreateSupportTicketRefund();
  const [replyNotice, setReplyNotice] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [statusNotice, setStatusNotice] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [refundNotice, setRefundNotice] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [orderCopyState, setOrderCopyState] = useState<OrderCopyState>('idle');
  const replyForm = useForm<ReplyForm>({ defaultValues: { message: '' } });
  const refundForm = useForm<RefundForm>({ defaultValues: { amount: '', reason: '' } });
  useEffect(() => { document.title = 'Support ticket | ReplenishCC'; }, []);
  const ticket = detail.data?.ticket;
  const closed = ticket?.status === 'closed';
  const copyOrderId = async () => {
    if (!ticket?.orderReference) return;
    try {
      await navigator.clipboard.writeText(ticket.orderReference);
      setOrderCopyState('copied');
    } catch {
      setOrderCopyState('failed');
    }
  };

  const invalidateSupport = () => {
    void client.invalidateQueries({ queryKey: getGetSupportTicketQueryKey(ticketId) });
    void client.invalidateQueries({ queryKey: getGetMySupportTicketsQueryKey() });
    void client.invalidateQueries({ queryKey: getGetAdminSupportTicketsQueryKey() });
  };

  const submitReply = replyForm.handleSubmit(({ message }) => {
    const cleanMessage = message.trim();
    if (!cleanMessage) {
      setReplyNotice({ kind: 'error', text: 'Write a message before sending.' });
      return;
    }
    setReplyNotice(null);
    postMessage.mutate({ ticketId, data: { message: cleanMessage } }, {
      onSuccess: () => {
        replyForm.reset({ message: '' });
        setReplyNotice({ kind: 'success', text: 'Your reply was added to the conversation.' });
        invalidateSupport();
      },
      onError: (error) => setReplyNotice({ kind: 'error', text: errorText(error) }),
    });
  });

  const updateStatus = (status: SupportTicketStatus) => {
    if (!ticket || ticket.status === status) return;
    setStatusNotice(null);
    changeStatus.mutate({ ticketId, data: { status } }, {
      onSuccess: () => {
        setStatusNotice({ kind: 'success', text: `Ticket status changed to ${statusLabels[status].toLowerCase()}.` });
        invalidateSupport();
      },
      onError: (error) => setStatusNotice({ kind: 'error', text: errorText(error) }),
    });
  };

  const submitRefund = refundForm.handleSubmit(({ amount, reason }) => {
    const dollarsValue = Number(amount);
    const cleanReason = reason.trim();
    if (!Number.isFinite(dollarsValue) || dollarsValue <= 0 || !cleanReason) {
      setRefundNotice({ kind: 'error', text: 'Enter a valid amount and a reason for this credit.' });
      return;
    }
    const amountCents = Math.round(dollarsValue * 100);
    if (amountCents < 1 || amountCents > 2_147_483_647) {
      setRefundNotice({ kind: 'error', text: 'Enter a valid amount in the supported range.' });
      return;
    }
    setRefundNotice(null);
    refundMutation.mutate({ ticketId, data: { amountCents, reason: cleanReason } }, {
      onSuccess: (response) => {
        refundForm.reset({ amount: '', reason: '' });
        setRefundNotice({ kind: 'success', text: `${dollars(response.refund.amountCents)} was credited to the member balance.` });
        invalidateSupport();
        void client.invalidateQueries({ queryKey: getGetMyDepositsQueryKey() });
      },
      onError: (error) => setRefundNotice({ kind: 'error', text: errorText(error) }),
    });
  });

  return <PortalGate title="Support ticket">{(user) => {
    const adminView = Boolean(user.isDepositAdmin);
    return <div className="workspace-page support-page">
      <Heading eyebrow={adminView ? 'Administration · member care' : 'Member care'} title={detail.data?.ticket.subject ?? 'Support ticket'} copy={detail.data ? `Ticket #${detail.data.ticket.id} · ${categoryLabels[detail.data.ticket.category]}` : 'Your support conversation and request details.'} action={<Link href={adminView ? '/admin/support/tickets' : '/support/tickets'} className="workspace-secondary-button" data-testid="link-back-support-tickets"><ArrowLeft aria-hidden="true" /> {adminView ? 'Inbox' : 'My tickets'}</Link>} />
      {detail.isLoading ? <div className="support-detail-loading"><div className="workspace-panel"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div><SkeletonRows count={2} /></div>
        : detail.isError ? <QueryError error={detail.error} retry={() => void detail.refetch()} label="This ticket could not be loaded." />
        : !detail.data ? <div className="support-query-error" role="alert" data-testid="error-support-ticket-missing"><CircleAlert aria-hidden="true" /><div><strong>Ticket unavailable</strong><span>This ticket could not be found in your support records.</span></div></div>
        : <div className="support-detail-layout">
          <div className="support-conversation-column">
            <section className="workspace-panel support-conversation" aria-labelledby="support-conversation-title">
              <header className="support-conversation-head"><div><div className="section-kicker">Conversation</div><h2 id="support-conversation-title">{detail.data.ticket.subject}</h2></div><StatusPill status={detail.data.ticket.status} /></header>
              <div className="support-conversation-meta">
                <span><strong>Category</strong>{categoryLabels[detail.data.ticket.category]}</span>
                <span><strong>Created</strong><time dateTime={detail.data.ticket.createdAt}>{dateTime(detail.data.ticket.createdAt)}</time></span>
              </div>
              <div className="support-messages" data-testid="list-support-messages">
                {detail.data.messages.map((message) => <MessageCard key={message.id} message={message} viewerIsAdmin={adminView} />)}
              </div>
              {replyNotice && <Alert kind={replyNotice.kind}>{replyNotice.text}</Alert>}
              {closed && !adminView ? <div className="support-closed-note" role="status" data-testid="status-ticket-closed"><Clock3 aria-hidden="true" /> This ticket is closed. Replies are unavailable.</div>
                : <Form {...replyForm}><form className="support-reply-form" onSubmit={submitReply} noValidate>
                  <label htmlFor="support-reply">{adminView ? 'Reply to member' : 'Add a reply'}</label>
                  <textarea id="support-reply" rows={5} maxLength={4000} placeholder="Write a message for this conversation" {...replyForm.register('message', { required: true, maxLength: 4000 })} data-testid="textarea-support-reply" />
                  <div className="support-reply-foot"><span>Up to 4,000 characters</span><button type="submit" className="workspace-primary-button" disabled={postMessage.isPending} data-testid="button-send-support-reply">{postMessage.isPending ? 'Sending…' : <>Send reply <Send aria-hidden="true" /></>}</button></div>
                </form></Form>}
            </section>
          </div>
          <aside className="support-detail-aside">
            <section className="workspace-panel support-detail-card" aria-labelledby="support-details-title">
              <div className="section-kicker"><Ticket aria-hidden="true" /> Request details</div><h2 id="support-details-title">Ticket record</h2>
              <dl className="support-detail-facts">
                <div><dt>Ticket ID</dt><dd data-testid="text-support-ticket-id">{detail.data.ticket.id}</dd></div>
                <div><dt>Current status</dt><dd><StatusPill status={detail.data.ticket.status} /></dd></div>
                {adminView && <><div><dt>Member</dt><dd data-testid="text-support-member-name">{detail.data.memberName}</dd></div><div><dt>Email</dt><dd data-testid="text-support-member-contact">{detail.data.memberEmail}</dd></div></>}
                <div><dt>Last updated</dt><dd data-testid="text-support-last-updated">{dateTime(detail.data.ticket.updatedAt)}</dd></div>
              </dl>
              {adminView && <>
                {statusNotice && <Alert kind={statusNotice.kind}>{statusNotice.text}</Alert>}
                <div className="support-admin-status"><label htmlFor="support-status">Change status</label><select id="support-status" value={detail.data.ticket.status} onChange={(event) => updateStatus(event.target.value as SupportTicketStatus)} disabled={changeStatus.isPending} data-testid="select-support-status">{statuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></div>
              </>}
            </section>
            {detail.data.ticket.orderReference && <SupportOrderCard
              reference={detail.data.ticket.orderReference}
              order={detail.data.matchedOrder}
              copyState={orderCopyState}
              onCopy={() => void copyOrderId()}
            />}
            {adminView && <section className="workspace-panel support-refund-card" aria-labelledby="support-refund-title">
              <div className="section-kicker"><WalletCards aria-hidden="true" /> Balance adjustment</div><h2 id="support-refund-title">One-time refund credit</h2>
              {detail.data.refund ? <div className="support-refund-record" data-testid="card-support-refund">
                <strong data-testid="text-support-refund-amount">{dollars(detail.data.refund.amountCents)}</strong><span>Credited by {detail.data.refund.adminName}</span><p data-testid="text-support-refund-reason">{detail.data.refund.reason}</p><small className="support-refund-unverified">{detail.data.matchedOrder ? 'This ticket is linked to a verified order.' : 'The amount was not verified against an order.'}</small><time dateTime={detail.data.refund.createdAt}>{dateTime(detail.data.refund.createdAt)}</time>
              </div> : <>
                <p className="support-refund-explainer">{detail.data.matchedOrder
                  ? `Order verified for ${dollars(detail.data.matchedOrder.totalCents)}. Review the order details before deciding whether to credit the member’s balance.`
                  : detail.data.ticket.orderReference
                    ? 'This order ID did not match a purchase for this member. Review the ticket before issuing any manual balance credit.'
                    : 'No purchase order is linked. Issue a balance credit only if needed and record the reason.'}</p>
                {refundNotice && <Alert kind={refundNotice.kind}>{refundNotice.text}</Alert>}
                <Form {...refundForm}><form className="support-form support-refund-form" onSubmit={submitRefund} noValidate>
                  <div className="support-field"><label htmlFor="support-refund-amount">Credit amount (USD)</label><div className="support-money-input"><span>$</span><input id="support-refund-amount" type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="0.00" {...refundForm.register('amount', { required: true })} data-testid="input-support-refund-amount" /></div></div>
                  <div className="support-field"><label htmlFor="support-refund-reason">Reason</label><textarea id="support-refund-reason" rows={3} maxLength={250} placeholder="Record the reason for this balance credit" {...refundForm.register('reason', { required: true, maxLength: 250 })} data-testid="textarea-support-refund-reason" /></div>
                  <button type="submit" className="workspace-primary-button support-refund-submit" disabled={refundMutation.isPending} data-testid="button-issue-support-refund">{refundMutation.isPending ? 'Issuing credit…' : <>Issue balance credit <ArrowRight aria-hidden="true" /></>}</button>
                </form></Form>
              </>}
            </section>}
            {!adminView && detail.data.refund && <section className="workspace-panel support-refund-card" aria-labelledby="member-refund-title"><div className="section-kicker"><WalletCards aria-hidden="true" /> Account balance</div><h2 id="member-refund-title">Credit recorded</h2><div className="support-refund-record"><strong data-testid="text-member-refund-amount">{dollars(detail.data.refund.amountCents)}</strong><span>One-time credit · {detail.data.refund.adminName}</span><p>{detail.data.refund.reason}</p><time dateTime={detail.data.refund.createdAt}>{dateTime(detail.data.refund.createdAt)}</time></div><p className="support-refund-explainer">{detail.data.matchedOrder ? 'The linked purchase order was verified.' : 'This balance credit was not verified against an order.'}</p></section>}
          </aside>
        </div>}
    </div>;
  }}</PortalGate>;
}

export function AdminSupportTicketsPage() {
  const session = useGetAuthMe();
  const [, setLocation] = useLocation();
  const admin = Boolean(session.data?.user?.isDepositAdmin);
  const inbox = useGetAdminSupportTickets({ query: { queryKey: getGetAdminSupportTicketsQueryKey(), enabled: admin } });
  const [status, setStatus] = useState<'all' | SupportTicketStatus>('all');
  useEffect(() => { document.title = 'Support inbox | ReplenishCC Admin'; }, []);
  useEffect(() => {
    if (!session.isLoading && (!session.data?.authenticated || session.isError || !session.data.user)) setLocation('/login');
    else if (!session.isLoading && session.data?.user && !session.data.user.isDepositAdmin) setLocation('/dashboard');
  }, [session.data?.authenticated, session.data?.user, session.isError, session.isLoading, setLocation]);
  if (session.isLoading || !session.data?.user || !admin) return <MemberShell pageTitle="Support inbox" user={null} loading />;
  const items = inbox.data?.tickets ?? [];
  const visible = status === 'all' ? items : items.filter((ticket) => ticket.status === status);
  const count = (value: SupportTicketStatus) => items.filter((ticket) => ticket.status === value).length;

  return <MemberShell pageTitle="Support inbox" user={session.data.user} contentClassName="member-dashboard-content">
    <div className="workspace-page support-page">
      <Heading eyebrow="Administration · member care" title="Support inbox" copy="Review real member requests, manage status, and continue the conversation." action={<div className="support-admin-mark"><ShieldCheck aria-hidden="true" /> Support administration</div>} />
      <section className="workspace-panel support-list-panel" aria-labelledby="support-inbox-title">
        <div className="workspace-panel-head support-list-head"><div><div className="section-kicker">Member requests</div><h2 id="support-inbox-title">All tickets</h2><p data-testid="text-admin-ticket-count">{inbox.data ? `${items.length} total ${items.length === 1 ? 'ticket' : 'tickets'}` : 'Live support queue'}</p></div><button type="button" className="workspace-icon-button" onClick={() => void inbox.refetch()} disabled={inbox.isFetching} aria-label="Refresh support inbox" data-testid="button-refresh-admin-support"><RefreshCw aria-hidden="true" /></button></div>
        <div className="support-filter-bar" role="group" aria-label="Filter tickets by status">
          <button type="button" className={`range-chip${status === 'all' ? ' selected' : ''}`} onClick={() => setStatus('all')} aria-pressed={status === 'all'} data-testid="button-filter-support-all">All <span>{items.length}</span></button>
          {statuses.map((value) => <button type="button" key={value} className={`range-chip${status === value ? ' selected' : ''}`} onClick={() => setStatus(value)} aria-pressed={status === value} data-testid={`button-filter-support-${value}`}>{statusLabels[value]} <span>{count(value)}</span></button>)}
        </div>
        {inbox.isLoading ? <SkeletonRows /> : inbox.isError ? <QueryError error={inbox.error} retry={() => void inbox.refetch()} label="The support inbox could not be loaded." /> : visible.length ? <div className="support-ticket-list" data-testid="list-admin-support-tickets">{visible.map((ticket) => <TicketList ticket={ticket} admin key={ticket.id} />)}</div> : <div className="workspace-empty compact support-filter-empty" data-testid="empty-admin-support-tickets"><MessageSquareText aria-hidden="true" /><strong>{items.length ? `No ${statusLabels[status as SupportTicketStatus].toLowerCase()} tickets` : 'The inbox is clear'}</strong><span>{items.length ? 'Choose another status filter to see more requests.' : 'New member requests will appear here.'}</span></div>}
      </section>
    </div>
  </MemberShell>;
}