import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { ArrowRight, Check, ChevronRight, Clipboard, Columns3, CreditCard, Info, LockKeyhole, RefreshCw, RotateCcw, Search, ShieldCheck, SlidersHorizontal, Trash2 } from 'lucide-react';
import {
  getGetAdminGiftCardProductsQueryKey, getGetGiftCardProductsQueryKey, getGetMyGiftCardOrdersQueryKey, getGetMyDepositsQueryKey,
  useAddAdminGiftCardStock, useCreateAdminGiftCardProduct, useDeleteAdminGiftCardProduct,
  useGetAdminGiftCardProducts, useGetAuthMe, useGetGiftCardProducts, useGetMyGiftCardOrders, usePurchaseGiftCard,
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

type CatalogColumn = 'description' | 'faceValue' | 'availability' | 'price';
type CatalogPriceFilter = 'all' | 'under-25' | '25-50' | '50-100' | '100-plus';
const catalogColumns: { id: CatalogColumn; label: string }[] = [
  { id: 'description', label: 'Description' },
  { id: 'faceValue', label: 'Face value' },
  { id: 'availability', label: 'Available stock' },
  { id: 'price', label: 'Member price' },
];
const catalogColumnStorageKey = 'replenishcc-card-catalog-columns';
const defaultCatalogColumns = catalogColumns.map((column) => column.id);

function readCatalogColumns(): CatalogColumn[] {
  if (typeof window === 'undefined') return defaultCatalogColumns;
  try {
    const stored = window.localStorage.getItem(catalogColumnStorageKey);
    if (stored === null) return defaultCatalogColumns;
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return defaultCatalogColumns;
    return catalogColumns.filter((column) => parsed.includes(column.id)).map((column) => column.id);
  } catch {
    return defaultCatalogColumns;
  }
}

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
  const products = useMemo(() => productsQuery.data?.products ?? [], [productsQuery.data?.products]);
  const [infoProductId, setInfoProductId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [baseId, setBaseId] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [faceValueFilter, setFaceValueFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out'>('all');
  const [priceFilter, setPriceFilter] = useState<CatalogPriceFilter>('all');
  const [visibleColumns, setVisibleColumns] = useState<CatalogColumn[]>(readCatalogColumns);
  const infoProduct = products.find((product) => product.id === infoProductId) ?? null;
  const purchaseOne = (productId: string) => {
    setNotice('');
    purchase.mutate({ data: { productId, quantity: 1 } }, {
      onSuccess: (result) => {
        setNotice(`${result.order.quantity} ${result.order.productName} card purchased for ${money(result.order.totalCents)}.`);
        void queryClient.invalidateQueries({ queryKey: getGetGiftCardProductsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetMyGiftCardOrdersQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetMyDepositsQueryKey() });
      },
      onError: () => setNotice('Purchase could not be completed. Check your balance and available inventory, then try again.'),
    });
  };
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const faceValues = useMemo(
    () => [...new Set(products.map((product) => product.faceValueCents))].sort((left, right) => left - right),
    [products],
  );
  const filteredProducts = useMemo(() => products.filter((product) => {
    const matchesBase = baseId === 'all' || product.id === baseId;
    const matchesSearch = !normalizedSearch
      || product.name.toLowerCase().includes(normalizedSearch)
      || product.description.toLowerCase().includes(normalizedSearch);
    const matchesFaceValue = faceValueFilter === 'all' || product.faceValueCents === Number(faceValueFilter);
    const matchesStock = stockFilter === 'all'
      || (stockFilter === 'low' && product.availableCount > 0 && product.availableCount <= 5)
      || (stockFilter === 'out' && product.availableCount === 0);
    const matchesPrice = priceFilter === 'all'
      || (priceFilter === 'under-25' && product.priceCents < 2500)
      || (priceFilter === '25-50' && product.priceCents >= 2500 && product.priceCents < 5000)
      || (priceFilter === '50-100' && product.priceCents >= 5000 && product.priceCents < 10000)
      || (priceFilter === '100-plus' && product.priceCents >= 10000);
    return matchesBase && matchesSearch && matchesFaceValue && matchesStock && matchesPrice;
  }), [products, baseId, normalizedSearch, faceValueFilter, stockFilter, priceFilter]);
  const toggleColumn = (columnId: CatalogColumn) => {
    setVisibleColumns((current) => current.includes(columnId)
      ? current.filter((column) => column !== columnId)
      : [...current, columnId]);
  };
  const resetFilters = () => {
    setBaseId('all');
    setSearchTerm('');
    setFaceValueFilter('all');
    setStockFilter('all');
    setPriceFilter('all');
  };
  useEffect(() => {
    try { window.localStorage.setItem(catalogColumnStorageKey, JSON.stringify(visibleColumns)); }
    catch { /* Column preferences remain usable for this visit when browser storage is unavailable. */ }
  }, [visibleColumns]);
  useEffect(() => { document.title = 'Cards | ReplenishCC'; }, []);
  return <MemberGuard title="Card catalog">{() => <section className="gift-page">
    <header className="gift-heading">
      <div><div className="gift-eyebrow"><span className="gift-live-dot" /> Authorized inventory</div><h1>Cards</h1><p>Browse listings by denomination, availability, and member price.</p></div>
      <Link className="gift-orders-link" href="/my-card-orders" data-testid="link-card-order-history"><Clipboard /> My card orders <ArrowRight /></Link>
    </header>
    {notice && <div className="gift-notice" role="status" data-testid="status-card-purchase">{notice}<Link href="/my-card-orders">View order history</Link><button aria-label="Dismiss purchase notice" onClick={() => setNotice('')} data-testid="button-dismiss-purchase-notice">×</button></div>}
    <section className="gift-catalog-base-panel" aria-label="Bases" data-testid="section-card-catalog-bases">
      <div className="gift-catalog-control-title"><CreditCard /><span>Bases</span><small>Choose a listing; count shows stock</small></div>
      <div className="gift-catalog-base-options">
        <button type="button" disabled={productsQuery.isLoading || productsQuery.isError || products.length === 0} className={`gift-catalog-base-button${baseId === 'all' ? ' is-active' : ''}`} aria-pressed={baseId === 'all'} onClick={() => setBaseId('all')} data-testid="button-card-base-all">All listings <span>{products.length}</span></button>
        {products.map((product) => <button type="button" key={product.id} className={`gift-catalog-base-button${baseId === product.id ? ' is-active' : ''}`} aria-pressed={baseId === product.id} onClick={() => setBaseId(product.id)} data-testid={`button-card-base-${product.id}`}>{product.name}<span>{product.availableCount}</span></button>)}
        {productsQuery.isLoading && <p className="gift-bases-empty" role="status">Loading bases…</p>}
        {productsQuery.isError && products.length === 0 && <p className="gift-bases-empty" role="status">Bases couldn’t be loaded.</p>}
        {!productsQuery.isLoading && !productsQuery.isError && products.length === 0 && <p className="gift-bases-empty" role="status">No card listings have been added yet.</p>}
      </div>
    </section>
    {productsQuery.isLoading ? <div className="gift-grid" aria-label="Loading card listings" data-testid="loading-card-products">{[1,2,3].map((i) => <div className="gift-product-skeleton" key={i}><i/><i/><i/><i/></div>)}</div>
      : productsQuery.isError ? <div className="gift-query-error" role="alert" data-testid="error-card-products">Catalog couldn’t be loaded. <button onClick={() => void productsQuery.refetch()} data-testid="button-retry-card-products"><RefreshCw /> Try again</button></div>
      : products.length === 0 ? <div className="gift-empty" data-testid="empty-card-catalog"><CreditCard /><h2>No card listings yet</h2><p>Once a listing is added, it will appear here along with its base and filters.</p></div>
      : <>
        <section className="gift-catalog-filter-panel" aria-label="Catalog filters">
            <div className="gift-catalog-control-title"><SlidersHorizontal /><span>Filters</span><small>Search and narrow catalog listings</small></div>
          <div className="gift-catalog-toolbar">
            <label className="gift-catalog-filter-field gift-catalog-search-field">
              <span>Search listings</span>
              <span className="gift-catalog-search-input"><Search aria-hidden="true" /><input type="search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Name or description" aria-label="Search card listings" data-testid="input-card-catalog-search" /></span>
            </label>
            <label className="gift-catalog-filter-field">
              <span>Face value</span>
              <select value={faceValueFilter} onChange={(event) => setFaceValueFilter(event.target.value)} aria-label="Filter by face value" data-testid="select-card-face-value-filter">
                <option value="all">Any denomination</option>
                {faceValues.map((value) => <option key={value} value={value}>{money(value)}</option>)}
              </select>
            </label>
            <label className="gift-catalog-filter-field">
              <span>Stock</span>
              <select value={stockFilter} onChange={(event) => setStockFilter(event.target.value as typeof stockFilter)} aria-label="Filter by stock status" data-testid="select-card-stock-filter">
                <option value="all">All listings</option><option value="low">Low stock (1–5)</option><option value="out">Out of stock</option>
              </select>
            </label>
            <label className="gift-catalog-filter-field">
              <span>Member price</span>
              <select value={priceFilter} onChange={(event) => setPriceFilter(event.target.value as CatalogPriceFilter)} aria-label="Filter by member price" data-testid="select-card-price-filter">
                <option value="all">Any price</option><option value="under-25">Under $25</option><option value="25-50">$25 to under $50</option><option value="50-100">$50 to under $100</option><option value="100-plus">$100 and up</option>
              </select>
            </label>
            <details className="column-chooser gift-column-chooser">
              <summary className="quiet-button" data-testid="button-choose-card-columns"><Columns3 /> Columns <ChevronRight className="chooser-chevron" /></summary>
              <div className="column-chooser-menu" role="group" aria-label="Choose visible card listing columns">
                <p className="gift-column-note">Listing name and Info stay visible. Credentials are never catalog columns.</p>
                {catalogColumns.map((column) => <label key={column.id} className="column-choice">
                  <input type="checkbox" checked={visibleColumns.includes(column.id)} onChange={() => toggleColumn(column.id)} data-testid={`checkbox-card-column-${column.id}`} />
                  <span>{column.label}</span>
                </label>)}
              </div>
            </details>
          </div>
        </section>
        <div className="gift-catalog-results" role="status" data-testid="text-card-catalog-results">
          Showing <strong>{filteredProducts.length}</strong> of {products.length} listings
          {(normalizedSearch || baseId !== 'all' || faceValueFilter !== 'all' || stockFilter !== 'all' || priceFilter !== 'all') && <button type="button" onClick={resetFilters} data-testid="button-clear-card-filters"><RotateCcw /> Clear filters</button>}
        </div>
        {filteredProducts.length === 0 ? <div className="gift-empty gift-filter-empty" data-testid="empty-filtered-card-catalog"><Search /><h2>No matching listings</h2><p>Try changing the search text or filters.</p><button type="button" className="gift-primary-link" onClick={resetFilters} data-testid="button-reset-card-filters">Reset filters <RotateCcw /></button></div>
          : <>
            <div className="gift-catalog-table-wrap" role="region" aria-label="Card listings" tabIndex={0}>
              <table className="gift-catalog-table">
                <thead><tr><th scope="col">Card / listing</th>{visibleColumns.map((column) => <th scope="col" key={column}>{catalogColumns.find((item) => item.id === column)?.label}</th>)}<th scope="col">Actions</th></tr></thead>
                <tbody>{filteredProducts.map((product) => <tr key={product.id} data-testid={`row-gift-product-${product.id}`}>
                  <td><div className="gift-catalog-product"><span className="gift-product-mark"><CreditCard /></span><div><strong data-testid={`text-gift-product-name-${product.id}`}>{product.name}</strong></div></div></td>
                  {visibleColumns.includes('description') && <td className="gift-catalog-description">{product.description || 'Authorized card listing'}</td>}
                  {visibleColumns.includes('faceValue') && <td className="gift-catalog-face" data-testid={`text-gift-face-value-${product.id}`}>{money(product.faceValueCents)}</td>}
                  {visibleColumns.includes('availability') && <td><span className={`gift-stock${product.availableCount === 0 ? ' is-out' : product.availableCount <= 5 ? ' is-low' : ''}`}><i />{product.availableCount} available</span></td>}
                  {visibleColumns.includes('price') && <td className="gift-catalog-price" data-testid={`text-gift-member-price-${product.id}`}>{money(product.priceCents)}</td>}
                  <td><div className="gift-catalog-actions">
                    <button className="gift-info-button" type="button" onClick={() => setInfoProductId(product.id)} data-testid={`button-info-card-${product.id}`}><Info /> Info</button>
                    <button className="gift-purchase-button" type="button" disabled={purchase.isPending || product.availableCount < 1} onClick={() => purchaseOne(product.id)} aria-label={`Buy one ${product.name}`} data-testid={`button-purchase-card-${product.id}`}>{purchase.isPending ? 'Working…' : 'Buy 1'} <ArrowRight /></button>
                  </div></td>
                </tr>)}</tbody>
              </table>
            </div>
            <div className="gift-catalog-mobile">{filteredProducts.map((product) => <article className="gift-mobile-row" key={product.id} data-testid={`card-gift-product-${product.id}`}>
              <div className="gift-mobile-row-head"><span className="gift-product-mark"><CreditCard /></span><div><strong>{product.name}</strong></div></div>
              <div className="gift-mobile-fields">
                {visibleColumns.includes('description') && <p className="gift-mobile-description">{product.description || 'Authorized card listing'}</p>}
                {visibleColumns.includes('faceValue') && <span>Face value <strong>{money(product.faceValueCents)}</strong></span>}
                {visibleColumns.includes('availability') && <span>Available <strong className={product.availableCount === 0 ? 'is-out' : product.availableCount <= 5 ? 'is-low' : ''}>{product.availableCount}</strong></span>}
                {visibleColumns.includes('price') && <span>Member price <strong className="gift-mobile-price">{money(product.priceCents)}</strong></span>}
              </div>
              <div className="gift-mobile-actions">
                <button className="gift-info-button" type="button" onClick={() => setInfoProductId(product.id)} data-testid={`button-info-card-mobile-${product.id}`}><Info /> Info</button>
                <button className="gift-purchase-button" type="button" disabled={purchase.isPending || product.availableCount < 1} onClick={() => purchaseOne(product.id)} aria-label={`Buy one ${product.name}`} data-testid={`button-purchase-card-mobile-${product.id}`}>{purchase.isPending ? 'Working…' : 'Buy 1'} <ArrowRight /></button>
              </div>
            </article>)}</div>
          </>}
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