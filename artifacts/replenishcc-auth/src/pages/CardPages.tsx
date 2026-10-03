import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { ArrowRight, Check, Clipboard, CreditCard, Info, LockKeyhole, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import {
  getGetAdminGiftCardProductsQueryKey, getGetGiftCardProductsQueryKey, getGetMyGiftCardOrdersQueryKey, getGetMyDepositsQueryKey,
  useAddAdminGiftCardStock, useCreateAdminGiftCardProduct, useDeleteAdminGiftCardProduct,
  useGetAdminGiftCardProducts, useGetAuthMe, useGetGiftCardProducts, useGetMyGiftCardOrders,
  usePurchaseGiftCard,
  type AuthMeResponse,
  type GiftCardCredential,
} from '@workspace/api-client-react';
import { MemberShell } from '../components/MemberShell';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const date = (value: string) => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const cardSchema = z.object({
  name: z.string().trim().min(1, 'Enter a listing name').max(100),
  description: z.string().max(1000),
  faceValue: z.coerce.number().positive('Enter a positive denomination'),
  price: z.coerce.number().positive('Enter a positive price'),
});
type CardForm = z.infer<typeof cardSchema>;

function MemberGuard({ children, title }: { children: (user: NonNullable<AuthMeResponse['user']>) => ReactNode; title: string }) {
  const session = useGetAuthMe();
  const [, setLocation] = useLocation();
  useEffect(() => {
    if (!session.isLoading && (session.isError || !session.data?.authenticated)) setLocation('/login');
  }, [session.isLoading, session.isError, session.data?.authenticated, setLocation]);
  if (session.isLoading || !session.data?.authenticated || !session.data.user) return <MemberShell pageTitle={title} user={null} loading />;
  return <MemberShell pageTitle={title} user={session.data.user}>{children(session.data.user)}</MemberShell>;
}

export function BuyCardsPage() {
  const queryClient = useQueryClient();
  const productsQuery = useGetGiftCardProducts({ query: { queryKey: getGetGiftCardProductsQueryKey() } });
  const purchase = usePurchaseGiftCard();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState('');
  const [infoProductId, setInfoProductId] = useState<string | null>(null);
  const products = productsQuery.data?.products ?? [];
  const infoProduct = products.find((product) => product.id === infoProductId) ?? null;
  const buy = (productId: string, quantity: number) => purchase.mutate({ data: { productId, quantity } }, {
    onSuccess: (result) => {
      setNotice(`${result.order.quantity} ${result.order.productName} card${result.order.quantity > 1 ? 's' : ''} purchased for ${money(result.order.totalCents)}.`);
      void queryClient.invalidateQueries({ queryKey: getGetGiftCardProductsQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetMyGiftCardOrdersQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetMyDepositsQueryKey() });
    },
    onError: () => setNotice('Purchase could not be completed. Check your balance and available inventory, then try again.'),
  });
  useEffect(() => { document.title = 'Cards | ReplenishCC'; }, []);
  return <MemberGuard title="Card catalog">{() => <section className="gift-page">
    <header className="gift-heading">
      <div><div className="gift-eyebrow"><span className="gift-live-dot" /> Authorized inventory</div><h1>Cards</h1><p>Browse listings by denomination, availability, and member price.</p></div>
      <Link className="gift-orders-link" href="/my-card-orders" data-testid="link-card-order-history"><Clipboard /> My card orders <ArrowRight /></Link>
    </header>
    {notice && <div className="gift-notice" role="status" data-testid="status-card-purchase">{notice}<Link href="/my-card-orders">View order history</Link><button aria-label="Dismiss purchase notice" onClick={() => setNotice('')} data-testid="button-dismiss-purchase-notice">×</button></div>}
    {productsQuery.isLoading ? <div className="gift-grid" aria-label="Loading card listings" data-testid="loading-card-products">{[1,2,3].map((i) => <div className="gift-product-skeleton" key={i}><i/><i/><i/><i/></div>)}</div>
      : productsQuery.isError ? <div className="gift-query-error" role="alert" data-testid="error-card-products">Catalog couldn’t be loaded. <button onClick={() => void productsQuery.refetch()} data-testid="button-retry-card-products"><RefreshCw /> Try again</button></div>
      : products.length === 0 ? <div className="gift-empty" data-testid="empty-card-catalog"><CreditCard /><h2>No cards are available right now</h2><p>Inventory is checked live. Please return later to see the next verified listing.</p></div>
      : <>
        <div className="gift-catalog-table-wrap"><table className="gift-catalog-table">
          <thead><tr><th>Card / listing</th><th>Face value</th><th>Available</th><th>Member price</th><th>Actions</th></tr></thead>
          <tbody>{products.map((product) => {
            const quantity = Math.max(1, Math.min(50, product.availableCount, quantities[product.id] ?? 1));
            return <tr key={product.id} data-testid={`row-gift-product-${product.id}`}>
              <td><div className="gift-catalog-product"><span className="gift-product-mark"><CreditCard /></span><div><strong data-testid={`text-gift-product-name-${product.id}`}>{product.name}</strong><small>{product.description || 'Authorized card listing'}</small></div></div></td>
              <td className="gift-catalog-face" data-testid={`text-gift-face-value-${product.id}`}>{money(product.faceValueCents)}</td>
              <td><span className="gift-stock"><i />{product.availableCount} available</span></td>
              <td className="gift-catalog-price" data-testid={`text-gift-member-price-${product.id}`}>{money(product.priceCents)}</td>
              <td><div className="gift-catalog-actions">
                <button className="gift-info-button" type="button" onClick={() => setInfoProductId(product.id)} data-testid={`button-info-card-${product.id}`}><Info /> Info</button>
                <label className="gift-table-quantity"><span className="sr-only">Quantity for {product.name}</span><input aria-label={`Quantity for ${product.name}`} type="number" min={1} max={Math.min(50, product.availableCount)} value={quantity} onChange={(event) => setQuantities((old) => ({ ...old, [product.id]: Math.max(1, Math.min(50, product.availableCount, Number(event.target.value) || 1)) }))} data-testid={`input-card-quantity-${product.id}`} /></label>
                <button className="gift-table-purchase" type="button" disabled={purchase.isPending || product.availableCount < 1} onClick={() => buy(product.id, quantity)} data-testid={`button-purchase-card-${product.id}`}>{purchase.isPending ? 'Working…' : 'Purchase'} <ArrowRight /></button>
              </div></td>
            </tr>;
          })}</tbody>
        </table></div>
        <div className="gift-catalog-mobile">{products.map((product) => {
        const quantity = Math.max(1, Math.min(50, product.availableCount, quantities[product.id] ?? 1));
        return <article className="gift-mobile-row" key={product.id} data-testid={`card-gift-product-${product.id}`}>
          <div className="gift-mobile-row-head"><span className="gift-product-mark"><CreditCard /></span><div><strong>{product.name}</strong><small>{product.availableCount} available</small></div><strong className="gift-mobile-price">{money(product.priceCents)}</strong></div>
          <div className="gift-mobile-value"><span>Face value <strong>{money(product.faceValueCents)}</strong></span><span>Member price <strong>{money(product.priceCents)}</strong></span></div>
          <div className="gift-mobile-actions"><button className="gift-info-button" type="button" onClick={() => setInfoProductId(product.id)} data-testid={`button-info-card-mobile-${product.id}`}><Info /> Info</button><label><span className="sr-only">Quantity for {product.name}</span><input aria-label={`Quantity for ${product.name}`} type="number" min={1} max={Math.min(50, product.availableCount)} value={quantity} onChange={(event) => setQuantities((old) => ({ ...old, [product.id]: Math.max(1, Math.min(50, product.availableCount, Number(event.target.value) || 1)) }))} data-testid={`input-card-quantity-mobile-${product.id}`} /></label><button className="gift-table-purchase" type="button" disabled={purchase.isPending || product.availableCount < 1} onClick={() => buy(product.id, quantity)} data-testid={`button-purchase-card-mobile-${product.id}`}>{purchase.isPending ? 'Working…' : 'Purchase'} <ArrowRight /></button></div>
        </article>;
      })}</div>
      </>}
    <Dialog open={!!infoProduct} onOpenChange={(open) => { if (!open) setInfoProductId(null); }}>
      {infoProduct && <DialogContent className="gift-info-dialog" data-testid={`dialog-card-info-${infoProduct.id}`}>
        <DialogHeader className="gift-info-dialog-head"><span className="gift-product-mark"><CreditCard /></span><div><DialogTitle>{infoProduct.name}</DialogTitle><DialogDescription>Listing details · product information only</DialogDescription></div></DialogHeader>
        <p className="gift-info-description" data-testid={`text-card-info-description-${infoProduct.id}`}>{infoProduct.description || 'No additional description provided.'}</p>
        <dl className="gift-info-facts">
          <div><dt>Face value</dt><dd data-testid={`text-card-info-value-${infoProduct.id}`}>{money(infoProduct.faceValueCents)}</dd></div>
          <div><dt>Member price</dt><dd data-testid={`text-card-info-price-${infoProduct.id}`}>{money(infoProduct.priceCents)}</dd></div>
          <div><dt>Available stock</dt><dd data-testid={`text-card-info-stock-${infoProduct.id}`}>{infoProduct.availableCount} cards</dd></div>
        </dl>
      </DialogContent>}
    </Dialog>
  </section>}</MemberGuard>;
}

export function MyCardOrdersPage() {
  const ordersQuery = useGetMyGiftCardOrders({ query: { queryKey: getGetMyGiftCardOrdersQueryKey() } });
  const [copied, setCopied] = useState('');
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  useEffect(() => { document.title = 'My card orders | ReplenishCC'; }, []);
  const copy = async (value: string, key: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(key); window.setTimeout(() => setCopied(''), 1800); }
    catch { setCopied(`failed-${key}`); }
  };
  return <MemberGuard title="My card orders">{() => <section className="gift-page">
    <header className="gift-heading"><div><div className="gift-eyebrow">Private delivery ledger</div><h1>Your card <em>orders.</em></h1><p>Complete credentials for cards purchased by this account. Keep these details private.</p></div><Link className="gift-orders-link" href="/buy-cards" data-testid="link-back-to-card-catalog"><CreditCard /> Browse cards <ArrowRight /></Link></header>
    <div className="gift-assurance"><span><LockKeyhole /> Visible to account owner</span><span><ShieldCheck /> Secure delivery record</span></div>
    {ordersQuery.isLoading ? <div className="gift-orders-loading" data-testid="loading-card-orders">{[1,2].map((n) => <div className="gift-order-skeleton" key={n}/>)}</div>
      : ordersQuery.isError ? <div className="gift-query-error" role="alert" data-testid="error-card-orders">Order history couldn’t be loaded. <button onClick={() => void ordersQuery.refetch()} data-testid="button-retry-card-orders"><RefreshCw /> Try again</button></div>
      : (ordersQuery.data?.orders ?? []).length === 0 ? <div className="gift-empty" data-testid="empty-card-orders"><Clipboard /><h2>Your delivery ledger is empty</h2><p>After a purchase, the full card details will appear here for this account only.</p><Link href="/buy-cards" className="gift-primary-link" data-testid="link-shop-first-card">Browse available cards <ArrowRight /></Link></div>
      : <div className="gift-orders-list">{(ordersQuery.data?.orders ?? []).map((order) => <article className="gift-order" key={order.id} data-testid={`card-order-${order.id}`}>
        <header><div><span className="gift-order-label">ORDER · {order.id.slice(0, 8).toUpperCase()}</span><h2>{order.productName}</h2><p>{date(order.createdAt)} · {order.quantity} card{order.quantity !== 1 ? 's' : ''}</p></div><div className="gift-order-total"><small>Paid</small><strong>{money(order.totalCents)}</strong></div></header>
        <p className="gift-order-description">{order.description}</p>
        <div className="gift-delivery-head"><span>Delivered credentials</span><span>{order.deliveredCards.length} of {order.quantity}</span></div>
        <div className="gift-credentials">{order.deliveredCards.map((card, index) => {
          const key = `${order.id}-${index}`;
          const visible = !!revealed[key];
          return <Credential key={key} card={card} index={index} visible={visible} toggle={() => setRevealed((old) => ({ ...old, [key]: !old[key] }))} copy={(value, field) => void copy(value, `${key}-${field}`)} copied={copied} orderId={order.id} />;
        })}</div>
      </article>)}</div>}
  </section>}</MemberGuard>;
}

function Credential({ card, index, visible, toggle, copy, copied, orderId }: { card: GiftCardCredential; index: number; visible: boolean; toggle: () => void; copy: (value: string, field: string) => void; copied: string; orderId: string }) {
  return <section className="gift-credential" data-testid={`card-credential-${orderId}-${index}`}>
    <div className="gift-credential-head"><strong>Card {String(index + 1).padStart(2, '0')}</strong><button onClick={toggle} data-testid={`button-toggle-credential-${orderId}-${index}`}>{visible ? 'Hide details' : 'Reveal details'}</button></div>
    <div className="gift-credential-grid">{[
      ['Card number', visible ? card.cardNumber : '•••• •••• •••• ••••', card.cardNumber, 'number'],
      ['Expiration', visible ? card.expiration : '•• / ••', card.expiration, 'expiration'],
      ['Security code', visible ? card.securityCode : '•••', card.securityCode, 'security'],
      ['PIN', card.pin ? (visible ? card.pin : '••••') : 'Not provided', card.pin ?? '', 'pin'],
    ].map(([label, display, raw, field]) => <div className="gift-credential-field" key={field}><small>{label}</small><strong data-testid={`text-credential-${field}-${orderId}-${index}`}>{display}</strong>{visible && raw && <button onClick={() => copy(raw, field)} aria-label={`Copy ${label}`} data-testid={`button-copy-${field}-${orderId}-${index}`}>{copied === `${orderId}-${index}-${field}` ? <Check /> : <Clipboard />}<span>{copied === `${orderId}-${index}-${field}` ? 'Copied' : 'Copy'}</span></button>}{copied === `failed-${orderId}-${index}-${field}` && <small className="gift-copy-error" role="status">Clipboard unavailable. Select and copy manually.</small>}</div>)}</div>
  </section>;
}

const stockSchema = z.object({ productId: z.string().min(1, 'Choose a listing'), cards: z.string().min(1, 'Paste at least one card') });
type StockForm = z.infer<typeof stockSchema>;
const listingSchema = cardSchema;

export function AdminCardInventoryPage() {
  const queryClient = useQueryClient();
  const session = useGetAuthMe();
  const [, setLocation] = useLocation();
  const products = useGetAdminGiftCardProducts({ query: { queryKey: getGetAdminGiftCardProductsQueryKey() } });
  const create = useCreateAdminGiftCardProduct();
  const addStock = useAddAdminGiftCardStock();
  const remove = useDeleteAdminGiftCardProduct();
  const [feedback, setFeedback] = useState('');
  const form = useForm<CardForm>({ resolver: zodResolver(listingSchema), defaultValues: { name: '', description: '', faceValue: 0, price: 0 } });
  const stockForm = useForm<StockForm>({ resolver: zodResolver(stockSchema), defaultValues: { productId: '', cards: '' } });
  const rows = products.data?.products ?? [];
  const totalStock = useMemo(() => rows.reduce((sum, item) => sum + item.availableCount, 0), [rows]);
  useEffect(() => { document.title = 'Card inventory | ReplenishCC Admin'; }, []);
  useEffect(() => { if (!session.isLoading && (session.isError || !session.data?.authenticated)) setLocation('/login'); else if (!session.isLoading && session.data?.user && !session.data.user.isDepositAdmin) setLocation('/dashboard'); }, [session.isLoading, session.isError, session.data?.authenticated, session.data?.user, setLocation]);
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: getGetAdminGiftCardProductsQueryKey() }); void queryClient.invalidateQueries({ queryKey: getGetGiftCardProductsQueryKey() }); };
  if (session.isLoading || !session.data?.user?.isDepositAdmin) return <MemberShell pageTitle="Card inventory" user={null} loading shellMode="force" />;
  return <section className="gift-admin">
    <header className="gift-admin-heading"><div><div className="gift-eyebrow">Restricted operations · inventory only</div><h2>Card inventory</h2><p>Manage listings and encrypted stock intake. Credentials are intentionally excluded from this table.</p></div><div className="gift-admin-stat"><small>Available cards</small><strong data-testid="text-admin-total-stock">{products.isLoading ? '—' : totalStock}</strong></div></header>
    {feedback && <div className="gift-notice" role="status" data-testid="status-admin-card-action">{feedback}<button onClick={() => setFeedback('')} aria-label="Dismiss message" data-testid="button-dismiss-admin-message">×</button></div>}
    <div className="gift-admin-forms">
      <section className="gift-admin-panel"><div className="gift-admin-panel-title"><span>01</span><div><h3>Create a listing</h3><p>Set the public denomination and member price.</p></div></div>
        <Form {...form}><form onSubmit={form.handleSubmit((values) => create.mutate({ data: { name: values.name.trim(), description: values.description.trim(), faceValueCents: Math.round(values.faceValue * 100), priceCents: Math.round(values.price * 100) } }, { onSuccess: () => { form.reset(); invalidate(); setFeedback('Listing created. Add verified stock to make it available to members.'); }, onError: () => setFeedback('Listing could not be created. Review the values and try again.') }))} className="gift-form">
          <FormField control={form.control} name="name" render={({ field }) => <FormItem><FormLabel>Listing name</FormLabel><FormControl><Input {...field} placeholder="Gift card · $50" data-testid="input-admin-card-name" /></FormControl><FormMessage /></FormItem>} />
          <FormField control={form.control} name="description" render={({ field }) => <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea {...field} placeholder="Short member-facing details" data-testid="input-admin-card-description" /></FormControl><FormMessage /></FormItem>} />
          <div className="gift-form-pair"><FormField control={form.control} name="faceValue" render={({ field }) => <FormItem><FormLabel>Face value (USD)</FormLabel><FormControl><Input {...field} type="number" min="0.01" step="0.01" data-testid="input-admin-face-value" /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="price" render={({ field }) => <FormItem><FormLabel>Member price (USD)</FormLabel><FormControl><Input {...field} type="number" min="0.01" step="0.01" data-testid="input-admin-card-price" /></FormControl><FormMessage /></FormItem>} /></div>
          <button className="gift-admin-submit" disabled={create.isPending} data-testid="button-create-card-listing">{create.isPending ? 'Creating…' : 'Create listing'} <ArrowRight /></button>
        </form></Form>
      </section>
      <section className="gift-admin-panel"><div className="gift-admin-panel-title"><span>02</span><div><h3>Upload verified stock</h3><p>One card per line: number | expiration | security code | PIN (optional).</p></div></div>
        <Form {...stockForm}><form onSubmit={stockForm.handleSubmit((values) => {
          const cards: GiftCardCredential[] = values.cards.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
            const [cardNumber, expiration, securityCode, pin] = line.split('|').map((part) => part.trim());
            return { cardNumber: cardNumber ?? '', expiration: expiration ?? '', securityCode: securityCode ?? '', pin: pin || null };
          });
          if (!cards.length || cards.some((card) => !card.cardNumber || !card.expiration || !card.securityCode)) { setFeedback('Each line must include card number, expiration, and security code separated by |.'); return; }
          addStock.mutate({ productId: values.productId, data: { cards } }, { onSuccess: (result) => { stockForm.reset(); invalidate(); setFeedback(`${result.addedCount} cards accepted. ${result.availableCount} now available.`); }, onError: () => setFeedback('Stock upload was rejected. Check each line and try again.') });
        })} className="gift-form">
          <FormField control={stockForm.control} name="productId" render={({ field }) => <FormItem><FormLabel>Listing</FormLabel><FormControl><select {...field} data-testid="select-admin-stock-product"><option value="">Select a listing</option>{rows.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.availableCount} available</option>)}</select></FormControl><FormMessage /></FormItem>} />
          <FormField control={stockForm.control} name="cards" render={({ field }) => <FormItem><FormLabel>Card details</FormLabel><FormControl><Textarea {...field} rows={6} placeholder="card number | MM/YY | security code | PIN (optional)" data-testid="input-admin-card-stock" /></FormControl><FormMessage /></FormItem>} />
          <div className="gift-upload-note"><LockKeyhole /> Stock is handled by the authorized service and stored encrypted. Details never appear in inventory rows.</div>
          <button className="gift-admin-submit" disabled={addStock.isPending || !rows.length} data-testid="button-upload-card-stock">{addStock.isPending ? 'Uploading…' : 'Upload encrypted stock'} <ArrowRight /></button>
        </form></Form>
      </section>
    </div>
    <section className="gift-inventory-panel"><header><div><h3>Listings & counts</h3><p>Metadata and available quantity only. No card credentials are displayed here.</p></div><button onClick={() => void products.refetch()} aria-label="Refresh inventory" data-testid="button-refresh-card-inventory"><RefreshCw /></button></header>
      {products.isLoading ? <div className="gift-admin-loading" data-testid="loading-admin-card-inventory"><i/><i/><i/></div>
      : products.isError ? <div className="gift-query-error" role="alert" data-testid="error-admin-card-inventory">Inventory unavailable. <button onClick={() => void products.refetch()} data-testid="button-retry-admin-card-inventory">Retry</button></div>
      : rows.length === 0 ? <div className="gift-admin-empty" data-testid="empty-admin-card-inventory">No listings created yet. Create a listing above to begin.</div>
       : <div className="gift-table-wrap"><table className="gift-table"><thead><tr><th>Listing</th><th>Face value</th><th>Member price</th><th>Available</th><th>Created</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{rows.map((product) => <tr key={product.id} data-testid={`row-card-inventory-${product.id}`}><td><strong>{product.name}</strong><small>{product.description || 'No description'}</small></td><td>{money(product.faceValueCents)}</td><td>{money(product.priceCents)}</td><td><span className="gift-count-chip">{product.availableCount}</span></td><td>{date(product.createdAt)}</td><td><button className="gift-delete" disabled={product.availableCount !== 0 || remove.isPending} title={product.availableCount !== 0 ? 'Remove all available stock before deletion' : 'Deletion also requires no order history'} onClick={() => { if (window.confirm(`Delete listing “${product.name}”? It must have no inventory or order history.`)) remove.mutate({ productId: product.id }, { onSuccess: () => { invalidate(); setFeedback('Empty listing deleted.'); }, onError: () => setFeedback('Listing could not be deleted. It has remaining stock or order history.') }); }} data-testid={`button-delete-card-listing-${product.id}`}><Trash2 /> Delete</button></td></tr>)}</tbody></table></div>}
    </section>
  </section>;
}