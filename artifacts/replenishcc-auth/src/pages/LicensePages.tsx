import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, Link } from 'wouter';
import {
  ArrowRight, Check, CircleAlert, Clipboard, Clock3, Download, KeyRound, PackageCheck,
  Plus, RotateCcw, ShieldCheck, ShoppingBag, Trash2,
} from 'lucide-react';
import {
  getGetAdminLicenseProductsQueryKey,
  getGetLicenseProductsQueryKey,
  getGetMyDepositsQueryKey,
  getGetMyLicenseOrdersQueryKey,
  useAddAdminLicenseStock,
  useCreateAdminLicenseProduct,
  useCreateLicenseOrder,
  useDeleteAdminLicenseProduct,
  useGetAdminLicenseProducts,
  useGetAuthMe,
  useGetLicenseProducts,
  useGetMyLicenseOrders,
  type LicenseProduct,
} from '@workspace/api-client-react';
import { MemberShell } from '../components/MemberShell';
import { downloadTextFile, plainTextLine } from '../lib/download-text-file';

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const date = (value: string) => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const logsText = (value: string) => value.replace(/\blicenses\b/gi, 'logs').replace(/\blicense\b/gi, 'log');
function message(error: unknown) {
  if (error && typeof error === 'object') {
    const candidate = error as { message?: unknown; response?: { data?: { error?: unknown } } };
    if (typeof candidate.response?.data?.error === 'string') return candidate.response.data.error;
    if (typeof candidate.message === 'string') return candidate.message;
  }
  return 'The request could not be completed. Please try again.';
}
function useMemberGuard(title: string) {
  const session = useGetAuthMe();
  const [, setLocation] = useLocation();
  const user = session.data?.authenticated ? session.data.user : null;
  useEffect(() => { document.title = `${title} | ReplenishCC`; }, [title]);
  useEffect(() => {
    if (!session.isLoading && (!session.data?.authenticated || session.isError)) setLocation('/login');
  }, [session.data?.authenticated, session.isError, session.isLoading, setLocation]);
  return { session, user };
}
function QueryError({ retry, children }: { retry: () => void; children: string }) {
  return <div className="license-query-error" role="alert"><CircleAlert aria-hidden="true" /><span>{children}</span><button type="button" onClick={retry}>Try again</button></div>;
}

export function LicenseProductsPage() {
  const { session, user } = useMemberGuard('Buy Logs');
  const client = useQueryClient();
  const productsQuery = useGetLicenseProducts({ query: { queryKey: getGetLicenseProductsQueryKey(), enabled: Boolean(user) } });
  const purchase = useCreateLicenseOrder();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [category, setCategory] = useState('All products');
  const products = productsQuery.data?.products ?? [];
  const categories = useMemo(() => ['All products', ...Array.from(new Set(products.map((p) => p.category))).sort()], [products]);
  const shown = category === 'All products' ? products : products.filter((p) => p.category === category);
  const buy = (product: LicenseProduct) => {
    const quantity = Math.max(1, Math.min(product.availableCount, Math.floor(quantities[product.id] ?? 1)));
    setNotice(null);
    purchase.mutate({ data: { productId: product.id, quantity } }, {
      onSuccess: (result) => {
        void client.invalidateQueries({ queryKey: getGetLicenseProductsQueryKey() });
        void client.invalidateQueries({ queryKey: getGetMyLicenseOrdersQueryKey() });
        void client.invalidateQueries({ queryKey: getGetMyDepositsQueryKey() });
        setNotice({ kind: 'success', text: `${result.order.quantity} ${logsText(result.order.productName)} log${result.order.quantity === 1 ? '' : 's'} purchased. Your logs are ready in order history.` });
        setQuantities((current) => ({ ...current, [product.id]: 1 }));
      },
      onError: (error) => setNotice({ kind: 'error', text: message(error) }),
    });
  };
  if (session.isLoading || !user) return <MemberShell pageTitle="Buy Logs" user={null} loading />;
  return <MemberShell pageTitle="Buy Logs" user={user} contentClassName="member-dashboard-content">
    <div className="workspace-page license-page">
      <header className="workspace-heading license-heading">
        <div><div className="section-kicker"><KeyRound aria-hidden="true" /> ReplenishCC · logs</div><h1>Buy Logs</h1><p>Choose a log, pay securely from your account balance, and retrieve it from My Log Orders.</p></div>
      </header>
      {notice && <div className={`license-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.kind === 'success' ? <Check aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}{notice.text}{notice.kind === 'success' && <Link href="/my-log-orders">View keys</Link>}</div>}
      <div className="license-catalog-top"><label className="license-category">Category<select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter products by category" data-testid="select-license-category">{categories.map((item) => <option key={item} value={item}>{logsText(item)}</option>)}</select></label></div>
      {productsQuery.isLoading ? <div className="license-product-grid" aria-label="Loading products" aria-busy="true">{[1, 2, 3].map((n) => <div className="license-card license-card-skeleton" key={n}><i /><i /><i /><i /></div>)}</div>
        : productsQuery.isError ? <QueryError retry={() => void productsQuery.refetch()}>We couldn’t load log products.</QueryError>
          : products.length === 0 ? <div className="license-empty"><div className="license-empty-icon"><ShoppingBag aria-hidden="true" /></div><h2>No logs available yet</h2><p>There are no products in the catalog right now. Please check back later.</p></div>
            : shown.length === 0 ? <div className="license-empty compact"><h2>No products in this category</h2><p>Choose another category to keep browsing.</p></div>
              : <div className="license-product-grid">{shown.map((product) => {
                const quantity = quantities[product.id] ?? 1;
                return <article className="license-card" key={product.id} data-testid={`card-license-product-${product.id}`}>
                  <div className="license-card-top"><span className="license-category-tag">{logsText(product.category)}</span><span className={`license-stock${product.availableCount === 0 ? ' empty' : ''}`}><i />{product.availableCount === 0 ? 'Out of stock' : `${product.availableCount} available`}</span></div>
                  <h3>{logsText(product.name)}</h3><p className="license-description">{logsText(product.description)}</p>
                  <div className="license-card-price"><strong>{money(product.priceCents)}</strong><span>per log</span></div>
                  <div className="license-buy-row"><label htmlFor={`quantity-${product.id}`}>Quantity</label><input id={`quantity-${product.id}`} type="number" min={1} max={Math.max(1, product.availableCount)} value={quantity} disabled={!product.availableCount} onChange={(e) => setQuantities((current) => ({ ...current, [product.id]: Math.max(1, Math.min(product.availableCount || 1, Number(e.target.value) || 1)) }))} data-testid={`input-quantity-${product.id}`} />
                    <button type="button" className="workspace-primary-button" disabled={!product.availableCount || purchase.isPending} onClick={() => buy(product)} data-testid={`button-buy-license-${product.id}`}>{purchase.isPending && purchase.variables?.data.productId === product.id ? 'Processing…' : 'Purchase'} <ArrowRight aria-hidden="true" /></button>
                  </div><div className="license-total">Subtotal <strong>{money(product.priceCents * quantity)}</strong></div>
                </article>;
              })}</div>}
      <div className="license-bottom-note"><ShieldCheck aria-hidden="true" /><span>Every purchase is associated with your signed-in account. Your logs are only shown in your private order history.</span></div>
    </div>
  </MemberShell>;
}

export function LicenseOrdersPage() {
  const { session, user } = useMemberGuard('My Log Orders');
  const ordersQuery = useGetMyLicenseOrders({ query: { queryKey: getGetMyLicenseOrdersQueryKey(), enabled: Boolean(user) } });
  const [copied, setCopied] = useState('');
  const copy = async (key: string, id: string) => {
    try { await navigator.clipboard.writeText(key); setCopied(id); window.setTimeout(() => setCopied(''), 1800); }
    catch { setCopied('failed'); window.setTimeout(() => setCopied(''), 2500); }
  };
  if (session.isLoading || !user) return <MemberShell pageTitle="My Log Orders" user={null} loading />;
  const orders = ordersQuery.data?.orders ?? [];
  const exportOrders = () => {
    if (orders.length === 0) return;
    const orderSections = orders.map((order, orderIndex) => [
      `Order ${orderIndex + 1}`,
      `ID: ${plainTextLine(order.id)}`,
      `Purchased: ${date(order.createdAt)}`,
      `Product: ${plainTextLine(logsText(order.productName))}`,
      `Description: ${plainTextLine(logsText(order.description))}`,
      `Quantity: ${order.quantity}`,
      `Unit price: ${money(order.unitPriceCents)}`,
      ...(order.couponCode ? [`Coupon: ${plainTextLine(order.couponCode)}`] : []),
      `Discount: ${money(order.discountCents)}`,
      `Total paid: ${money(order.totalCents)}`,
      `Delivered log keys (${order.deliveredKeys.length}):`,
      ...(order.deliveredKeys.length
        ? order.deliveredKeys.map((key, keyIndex) => `${keyIndex + 1}. ${plainTextLine(key)}`)
        : ['None']),
    ].join('\n'));
    const fileDate = new Date().toISOString().slice(0, 10);
    downloadTextFile(
      `replenishcc-log-orders-${fileDate}.txt`,
      [
        'ReplenishCC — My Log Orders',
        `Exported: ${date(new Date().toISOString())}`,
        'Contains private delivered log keys. Keep this file secure.',
        '',
        orderSections.join('\n\n'),
      ].join('\n'),
    );
  };
  return <MemberShell pageTitle="My Log Orders" user={user} contentClassName="member-dashboard-content">
    <div className="workspace-page license-page">
      <header className="workspace-heading"><div><div className="section-kicker"><Clipboard aria-hidden="true" /> Purchase records</div><h1>My Log Orders</h1><p>Order details and delivered keys are visible only to your authenticated account.</p></div><div className="workspace-heading-actions"><button type="button" className="workspace-secondary-button" onClick={exportOrders} disabled={orders.length === 0} title="Downloads delivered log keys in plain text." data-testid="button-export-log-orders"><Download aria-hidden="true" /> Export .txt</button><Link className="workspace-primary-button" href="/buy-logs"><ShoppingBag aria-hidden="true" /> Buy Logs</Link></div></header>
      {ordersQuery.isLoading ? <div className="license-orders-loading" aria-busy="true">{[1, 2].map((item) => <div className="license-order-skeleton" key={item}><i /><i /><i /></div>)}</div>
        : ordersQuery.isError ? <QueryError retry={() => void ordersQuery.refetch()}>We couldn’t load your log orders.</QueryError>
          : orders.length === 0 ? <div className="license-empty"><div className="license-empty-icon"><KeyRound aria-hidden="true" /></div><h2>No log orders yet</h2><p>When you buy a log, the purchase and delivered log will appear here.</p><Link href="/buy-logs" className="workspace-primary-button">Buy Logs <ArrowRight aria-hidden="true" /></Link></div>
            : <div className="license-orders-list">{orders.map((order) => <article className="license-order-card" key={order.id} data-testid={`card-license-order-${order.id}`}>
              <div className="license-order-head"><div><span className="license-order-label">Log order</span><h2>{logsText(order.productName)}</h2></div><span className="license-order-total">{money(order.totalCents)}</span></div>
              <div className="license-order-meta"><span>{order.quantity} log{order.quantity === 1 ? '' : 's'} · {money(order.unitPriceCents)} each</span><span><Clock3 aria-hidden="true" /> {date(order.createdAt)}</span></div>
              {order.couponCode && <p className="license-order-coupon">Coupon {order.couponCode} · {order.couponPercentOff}% off · saved {money(order.discountCents)}</p>}
              {order.description && <p className="license-order-description">{logsText(order.description)}</p>}
              <div className="license-keys-heading"><strong>Delivered keys</strong><span>{order.deliveredKeys.length} of {order.quantity} delivered</span></div>
              {order.deliveredKeys.length ? <div className="license-keys">{order.deliveredKeys.map((key, index) => {
                const keyId = `${order.id}-${index}`;
                return <div className="license-key-row" key={keyId}><span className="license-key-index">{String(index + 1).padStart(2, '0')}</span><code data-testid={`text-license-key-${keyId}`}>{key}</code><button type="button" onClick={() => void copy(key, keyId)} aria-label={`Copy log ${index + 1}`} data-testid={`button-copy-license-key-${keyId}`}><Clipboard aria-hidden="true" />{copied === keyId ? 'Copied' : 'Copy'}</button></div>;
              })}</div> : <div className="license-key-pending">No keys are attached to this order yet. Contact support if you need help.</div>}
              {copied === 'failed' && <p className="license-copy-error" role="status">Clipboard unavailable. Select and copy the key manually.</p>}
            </article>)}</div>}
    </div>
  </MemberShell>;
}

export function AdminLicenseProductsPage() {
  const { session, user } = useMemberGuard('Log inventory');
  const [, setLocation] = useLocation();
  const client = useQueryClient();
  const productsQuery = useGetAdminLicenseProducts({ query: { queryKey: getGetAdminLicenseProductsQueryKey(), enabled: Boolean(user?.isDepositAdmin) } });
  const create = useCreateAdminLicenseProduct();
  const addStock = useAddAdminLicenseStock();
  const deleteProduct = useDeleteAdminLicenseProduct();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('');
  const [stockText, setStockText] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  useEffect(() => {
    if (!session.isLoading && (!session.data?.authenticated || session.isError)) setLocation('/login');
    else if (!session.isLoading && user && !user.isDepositAdmin) setLocation('/dashboard');
  }, [session.data?.authenticated, session.isError, session.isLoading, setLocation, user]);
  const products = productsQuery.data?.products ?? [];
  const submitProduct = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const priceCents = Math.round(Number(price) * 100);
    if (!name.trim() || !description.trim() || !category.trim() || !Number.isFinite(priceCents) || priceCents < 1) {
      setNotice({ kind: 'error', text: 'Complete every field and enter a valid price greater than zero.' }); return;
    }
    setNotice(null);
    create.mutate({ data: { name: name.trim(), description: description.trim(), category: category.trim(), priceCents } }, {
      onSuccess: () => {
        setName(''); setDescription(''); setCategory(''); setPrice('');
        setNotice({ kind: 'success', text: 'Product created. Add stock below when keys are ready.' });
        void client.invalidateQueries({ queryKey: getGetAdminLicenseProductsQueryKey() });
        void client.invalidateQueries({ queryKey: getGetLicenseProductsQueryKey() });
      },
      onError: (error) => setNotice({ kind: 'error', text: message(error) }),
    });
  };
  const submitStock = (productId: string) => {
    const keys = (stockText[productId] ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!keys.length) { setNotice({ kind: 'error', text: 'Paste at least one license key, one per line.' }); return; }
    setNotice(null);
    addStock.mutate({ productId, data: { keys } }, {
      onSuccess: (result) => {
        setStockText((current) => ({ ...current, [productId]: '' }));
        setNotice({ kind: 'success', text: `${result.addedCount} keys added. ${result.availableCount} available for sale.` });
        void client.invalidateQueries({ queryKey: getGetAdminLicenseProductsQueryKey() });
        void client.invalidateQueries({ queryKey: getGetLicenseProductsQueryKey() });
      },
      onError: (error) => setNotice({ kind: 'error', text: message(error) }),
    });
  };
  const removeProduct = (productId: string, productName: string) => {
    if (!window.confirm(`Delete "${productName}"? This only works when the product has no inventory or order history.`)) return;
    setNotice(null);
    deleteProduct.mutate({ productId }, {
      onSuccess: () => {
        setNotice({ kind: 'success', text: `${productName} was deleted.` });
        void client.invalidateQueries({ queryKey: getGetAdminLicenseProductsQueryKey() });
        void client.invalidateQueries({ queryKey: getGetLicenseProductsQueryKey() });
      },
      onError: (error) => setNotice({ kind: 'error', text: message(error) }),
    });
  };
  if (session.isLoading || !user || !user.isDepositAdmin) return <MemberShell pageTitle="Log inventory" user={null} loading />;
  return <MemberShell pageTitle="Log inventory" user={user} contentClassName="member-dashboard-content">
    <div className="workspace-page license-page admin-license-page">
      <header className="workspace-heading"><div><div className="section-kicker"><ShieldCheck aria-hidden="true" /> Administration · stock control</div><h1>Log inventory</h1><p>Create catalog listings and deliver securely stored license keys into stock.</p></div><span className="license-admin-badge"><ShieldCheck aria-hidden="true" /> Deposit administrator</span></header>
      {notice && <div className={`license-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.kind === 'success' ? <Check aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}{notice.text}</div>}
      <div className="license-admin-layout">
        <section className="workspace-panel license-create-panel"><div className="section-kicker"><Plus aria-hidden="true" /> New listing</div><h2>Create a product</h2><p>Price is entered in dollars and stored as an exact cent value.</p>
          <form className="license-admin-form" onSubmit={submitProduct}>
            <label htmlFor="license-name">Product name</label><input id="license-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required placeholder="e.g. Productivity Suite" data-testid="input-license-name" />
            <label htmlFor="license-description">Description</label><textarea id="license-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} required placeholder="What this license includes" data-testid="input-license-description" />
            <div className="license-form-pair"><div><label htmlFor="license-category">Category</label><input id="license-category" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={60} required placeholder="Productivity" data-testid="input-license-category" /></div><div><label htmlFor="license-price">Unit price (USD)</label><input id="license-price" type="number" value={price} onChange={(e) => setPrice(e.target.value)} min="0.01" step="0.01" required placeholder="12.00" data-testid="input-license-price" /></div></div>
            <button className="workspace-primary-button license-submit" type="submit" disabled={create.isPending} data-testid="button-create-license-product">{create.isPending ? 'Creating…' : 'Create product'} <ArrowRight aria-hidden="true" /></button>
          </form>
        </section>
        <section className="workspace-panel license-stock-panel"><div className="license-stock-panel-heading"><div><div className="section-kicker">Live catalog</div><h2>Products & stock</h2><p>Products with inventory or order history are protected from deletion.</p></div><button className="workspace-icon-button" type="button" onClick={() => void productsQuery.refetch()} disabled={productsQuery.isFetching} aria-label="Refresh product inventory" data-testid="button-refresh-license-inventory"><RotateCcw aria-hidden="true" /></button></div>
          {productsQuery.isLoading ? <div className="license-orders-loading" aria-busy="true"><div className="license-order-skeleton"><i /><i /><i /></div><div className="license-order-skeleton"><i /><i /><i /></div></div>
            : productsQuery.isError ? <QueryError retry={() => void productsQuery.refetch()}>We couldn’t load product inventory.</QueryError>
              : products.length === 0 ? <div className="workspace-empty compact"><PackageCheck aria-hidden="true" /><strong>No products created</strong><span>Create the first listing using the form. Products are never pre-populated.</span></div>
                : <div className="license-admin-products">{products.map((product) => {
                  const lines = (stockText[product.id] ?? '').split(/\r?\n/).filter((line) => line.trim()).length;
                  return <article className="license-admin-product" key={product.id} data-testid={`admin-product-${product.id}`}>
                    <div className="license-admin-product-head"><div><span className="license-category-tag">{product.category}</span><h3>{product.name}</h3></div><div className="admin-product-actions"><div className="admin-product-stock"><strong>{product.availableCount}</strong><span>available</span></div><button className="admin-delete-product" type="button" onClick={() => removeProduct(product.id, product.name)} disabled={deleteProduct.isPending} aria-label={`Delete ${product.name}`} data-testid={`button-delete-license-product-${product.id}`}><Trash2 aria-hidden="true" /> Delete</button></div></div>
                    <p>{product.description}</p><div className="admin-product-price">{money(product.priceCents)} <span>per license</span></div>
                    <label htmlFor={`stock-${product.id}`}>Add keys <span>one key per line · {lines} ready</span></label>
                    <textarea id={`stock-${product.id}`} value={stockText[product.id] ?? ''} onChange={(e) => setStockText((current) => ({ ...current, [product.id]: e.target.value }))} rows={4} placeholder={'XXXXX-XXXXX-XXXXX\nXXXXX-XXXXX-XXXXX'} data-testid={`textarea-stock-${product.id}`} />
                    <div className="license-stock-foot"><span>Keys are not shown after submission.</span><button type="button" className="workspace-secondary-button" disabled={addStock.isPending || lines === 0} onClick={() => submitStock(product.id)} data-testid={`button-add-stock-${product.id}`}>{addStock.isPending && addStock.variables?.productId === product.id ? 'Adding…' : 'Add stock'} <ArrowRight aria-hidden="true" /></button></div>
                  </article>;
                })}</div>}
        </section>
      </div>
    </div>
  </MemberShell>;
}