import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { Archive, ArrowRight, Check, ChevronRight, Clipboard, Columns3, CreditCard, Download, Info, LockKeyhole, Pencil, RefreshCw, RotateCcw, Search, ShieldCheck, ShoppingCart, SlidersHorizontal, Trash2 } from 'lucide-react';
import {
  getGetAdminGiftCardProductsQueryKey, getGetAuthMeQueryKey, getGetGiftCardProductsQueryKey, getGetMyGiftCardOrdersQueryKey, getGetMyDepositsQueryKey,
  useAddAdminGiftCardStock, useCreateAdminGiftCardProduct, useDeleteAdminGiftCardProduct, useRestoreAdminGiftCardProduct, useBulkPurchaseGiftCards,
  useGetAdminGiftCardProducts, useGetAuthMe, useGetGiftCardProducts, useGetMyGiftCardOrders, usePurchaseGiftCard, useUpdateAdminGiftCardProductMetadata,
  type AuthMeResponse,
  type GiftCardCredential,
} from '@workspace/api-client-react';
import { MemberShell } from '../components/MemberShell';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { downloadTextFile, plainTextLine } from '../lib/download-text-file';
import { parseCardStockInput } from '../lib/card-stock-import';

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const date = (value: string) => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const MAX_CARDS_PER_BATCH = 100;
const MAX_STOCK_FILE_BYTES = 100_000;
const STOCK_FILE_EXTENSIONS = new Set(['txt', 'text', 'csv', 'tsv', 'json', 'jsonl', 'ndjson', 'log', 'dat']);

function ContactIndicator({ available, label }: { available: boolean; label: string }) {
  return <span className={`gift-contact-indicator${available ? ' is-present' : ''}`} aria-label={`${label} ${available ? 'included' : 'not included'}`} title={`${label} ${available ? 'included' : 'not included'}`}>
    {available ? <Check aria-hidden="true" /> : <span aria-hidden="true">—</span>}
    <span>{available ? 'Included' : 'Not included'}</span>
  </span>;
}

const baseSchema = z.object({
  name: z.string().trim().min(1, 'Enter a base name').max(100),
  price: z.coerce.number().positive('Enter a positive price').max(10_000, 'Price cannot exceed $10,000'),
});
type BaseForm = z.infer<typeof baseSchema>;

type CatalogColumn = 'state' | 'city' | 'regionZip' | 'cardType' | 'issuer' | 'brand' | 'price' | 'actions';
type CatalogPriceFilter = 'all' | 'under-25' | '25-50' | '50-100' | '100-plus';
type CatalogPresenceFilter = 'all' | 'yes' | 'no';
type CatalogFilters = {
  brand: string;
  cardType: string;
  issuer: string;
  state: string;
  city: string;
  zip: string;
  address: CatalogPresenceFilter;
  email: CatalogPresenceFilter;
  phone: CatalogPresenceFilter;
  price: CatalogPriceFilter;
};
type PublicCardLocation = {
  address: string;
  city: string;
  state: string;
  regionZip: string | null;
};
type ProductWithCardLocations = PublicCardLocation & {
  availableCardLocations: PublicCardLocation[];
};

function locationsForProduct(product: ProductWithCardLocations): PublicCardLocation[] {
  return product.availableCardLocations.length > 0
    ? product.availableCardLocations
    : [{
      address: product.address,
      city: product.city,
      state: product.state,
      regionZip: product.regionZip,
    }];
}

function productLocationValue(
  product: ProductWithCardLocations,
  field: 'city' | 'state' | 'regionZip',
) {
  const values = locationsForProduct(product).map((location) => (location[field] ?? '').trim());
  if (new Set(values.map((value) => value.toLocaleLowerCase())).size > 1) return 'Varies';
  return values[0] || '—';
}

const emptyCatalogFilters: CatalogFilters = {
  brand: '', cardType: '', issuer: '', state: '', city: '', zip: '',
  address: 'all', email: 'all', phone: 'all', price: 'all',
};
const catalogColumns: { id: CatalogColumn; label: string }[] = [
  { id: 'brand', label: 'Brand' },
  { id: 'cardType', label: 'Type' },
  { id: 'issuer', label: 'Issuer' },
  { id: 'city', label: 'City' },
  { id: 'state', label: 'State' },
  { id: 'regionZip', label: 'ZIP' },
  { id: 'price', label: 'Price' },
  { id: 'actions', label: 'Actions' },
];
const catalogColumnStorageKey = 'replenishcc-card-catalog-columns-v5';
const previousCatalogColumnStorageKey = 'replenishcc-card-catalog-columns-v4';
const legacyCatalogColumnStorageKey = 'replenishcc-card-catalog-columns-v3';
const olderCatalogColumnStorageKey = 'replenishcc-card-catalog-columns-v2';
const oldestCatalogColumnStorageKey = 'replenishcc-card-catalog-columns';
const defaultCatalogColumns = catalogColumns.map((column) => column.id);

function matchesCatalogPrice(priceCents: number, filter: CatalogPriceFilter) {
  return filter === 'all'
    || (filter === 'under-25' && priceCents < 2500)
    || (filter === '25-50' && priceCents >= 2500 && priceCents < 5000)
    || (filter === '50-100' && priceCents >= 5000 && priceCents < 10000)
    || (filter === '100-plus' && priceCents >= 10000);
}

function readCatalogColumns(): CatalogColumn[] {
  if (typeof window === 'undefined') return defaultCatalogColumns;
  try {
    const stored = window.localStorage.getItem(catalogColumnStorageKey);
    const migratingPreferences = stored === null;
    const preferenceValue = stored
      ?? window.localStorage.getItem(previousCatalogColumnStorageKey)
      ?? window.localStorage.getItem(legacyCatalogColumnStorageKey)
      ?? window.localStorage.getItem(olderCatalogColumnStorageKey)
      ?? window.localStorage.getItem(oldestCatalogColumnStorageKey);
    if (preferenceValue === null) return defaultCatalogColumns;
    const parsed: unknown = JSON.parse(preferenceValue);
    if (!Array.isArray(parsed)) return defaultCatalogColumns;
    const newMetadataColumns: CatalogColumn[] = migratingPreferences
      ? ['state', 'city', 'regionZip', 'cardType', 'issuer', 'brand', 'actions']
      : [];
    return catalogColumns.filter((column) => parsed.includes(column.id) || newMetadataColumns.includes(column.id)).map((column) => column.id);
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
  const bulkPurchase = useBulkPurchaseGiftCards();
  const products = useMemo(() => productsQuery.data?.products ?? [], [productsQuery.data?.products]);
  const [infoProductId, setInfoProductId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [baseId, setBaseId] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [catalogFilters, setCatalogFilters] = useState<CatalogFilters>(emptyCatalogFilters);
  const [draftCatalogFilters, setDraftCatalogFilters] = useState<CatalogFilters>(emptyCatalogFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<CatalogColumn[]>(readCatalogColumns);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const infoProduct = products.find((product) => product.id === infoProductId) ?? null;
  const cardInfoFacts = infoProduct ? [
    { label: 'Brand', value: infoProduct.brand || 'Not specified' },
    { label: 'Type', value: infoProduct.cardType || 'Not specified' },
    { label: 'Issuer', value: infoProduct.issuer || 'Not specified' },
    { label: 'Base', value: infoProduct.name },
    { label: 'Available stock', value: `${infoProduct.availableCount} cards`, testId: `text-card-info-stock-${infoProduct.id}` },
    { label: 'Price', value: money(infoProduct.priceCents), testId: `text-card-info-price-${infoProduct.id}` },
  ] : [];
  const cardInfoFeatures = infoProduct ? [
    { label: 'Email address', available: infoProduct.hasEmail, testId: `text-card-info-email-${infoProduct.id}` },
    {
      label: 'Address details',
      available: infoProduct.availableCardLocations.some((location) =>
        Boolean(location.address || location.city || location.state || location.regionZip),
      ),
      testId: `text-card-info-address-availability-${infoProduct.id}`,
    },
    { label: 'Phone number', available: infoProduct.hasPhone, testId: `text-card-info-phone-${infoProduct.id}` },
  ] : [];
  const purchaseOne = (productId: string) => {
    setNotice('');
    purchase.mutate({ data: { productId, quantity: 1 } }, {
      onSuccess: (result) => {
        setNotice(`${result.order.quantity} ${result.order.productName} card purchased for ${money(result.order.totalCents)}.`);
        void queryClient.invalidateQueries({ queryKey: getGetGiftCardProductsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetMyGiftCardOrdersQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetMyDepositsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetAuthMeQueryKey() });
      },
      onError: () => setNotice('Purchase could not be completed. Check your balance and available inventory, then try again.'),
    });
  };
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const catalogOptions = useMemo(() => ({
    brand: [...new Set(products.map((product) => product.brand.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    cardType: [...new Set(products.map((product) => product.cardType.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    issuer: [...new Set(products.map((product) => product.issuer.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    state: [...new Set(products.flatMap(locationsForProduct).map((location) => location.state.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    city: [...new Set(products.flatMap(locationsForProduct).map((location) => location.city.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
  }), [products]);
  const searchFilteredProducts = useMemo(() => products.filter((product) => {
    const matchesBase = baseId === 'all' || product.id === baseId;
    const matchesLocation = locationsForProduct(product).some((location) =>
      location.address.toLowerCase().includes(normalizedSearch)
      || location.city.toLowerCase().includes(normalizedSearch)
      || location.state.toLowerCase().includes(normalizedSearch)
      || (location.regionZip ?? '').toLowerCase().includes(normalizedSearch),
    );
    const matchesSearch = !normalizedSearch
      || product.name.toLowerCase().includes(normalizedSearch)
      || product.description.toLowerCase().includes(normalizedSearch)
      || product.brand.toLowerCase().includes(normalizedSearch)
      || product.cardType.toLowerCase().includes(normalizedSearch)
      || product.issuer.toLowerCase().includes(normalizedSearch)
      || matchesLocation;
    return matchesBase && matchesSearch;
  }), [products, baseId, normalizedSearch]);
  const filterProducts = (source: typeof products, filters: CatalogFilters) => source.filter((product) => {
    const exactMatch = (value: string, selection: string) => !selection || value.trim().toLocaleLowerCase() === selection.toLocaleLowerCase();
    const presenceMatch = (value: boolean, selection: CatalogPresenceFilter) => selection === 'all' || (selection === 'yes' ? value : !value);
    const locations = locationsForProduct(product);
    const matchesLocation = locations.some((location) =>
      exactMatch(location.state, filters.state)
      && exactMatch(location.city, filters.city)
      && (!filters.zip || (location.regionZip ?? '').toLowerCase().includes(filters.zip.trim().toLowerCase())),
    );
    return exactMatch(product.brand, filters.brand)
      && exactMatch(product.cardType, filters.cardType)
      && exactMatch(product.issuer, filters.issuer)
      && matchesLocation
      && presenceMatch(locations.some((location) => Boolean(location.address.trim())), filters.address)
      && presenceMatch(product.hasEmail, filters.email)
      && presenceMatch(product.hasPhone, filters.phone)
      && matchesCatalogPrice(product.priceCents, filters.price);
  });
  const filteredProducts = useMemo(
    () => filterProducts(searchFilteredProducts, catalogFilters),
    [searchFilteredProducts, catalogFilters],
  );
  const draftResultCount = useMemo(
    () => filterProducts(searchFilteredProducts, draftCatalogFilters).length,
    [searchFilteredProducts, draftCatalogFilters],
  );
  const activeFilterCount = Object.entries(catalogFilters).filter(([key, value]) => key === 'price' ? value !== 'all' : key === 'address' || key === 'email' || key === 'phone' ? value !== 'all' : value !== '').length
    + (normalizedSearch ? 1 : 0) + (baseId !== 'all' ? 1 : 0);
  const selectableProducts = filteredProducts.filter((product) => product.availableCount > 0);
  const selectedProducts = selectedIds
    .map((id) => products.find((product) => product.id === id))
    .filter((product): product is NonNullable<typeof product> => Boolean(product && product.availableCount > 0));
  const selectedTotalCents = selectedProducts.reduce((total, product) => total + product.priceCents, 0);
  const allVisibleSelected = selectableProducts.length > 0 && selectableProducts.every((product) => selectedIds.includes(product.id));
  const toggleSelection = (productId: string) => setSelectedIds((current) => current.includes(productId)
    ? current.filter((id) => id !== productId)
    : current.length < 50 ? [...current, productId] : current);
  const purchaseSelected = () => {
    if (!selectedProducts.length || bulkPurchase.isPending) return;
    setNotice('');
    bulkPurchase.mutate({ data: { productIds: selectedProducts.map((product) => product.id) } }, {
      onSuccess: (result) => {
        setNotice(`${result.orders.length} card${result.orders.length === 1 ? '' : 's'} purchased for ${money(result.totalCents)}. Your updated balance is ${money(result.balanceCents)}.`);
        setSelectedIds([]);
        void queryClient.invalidateQueries({ queryKey: getGetGiftCardProductsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetMyGiftCardOrdersQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetMyDepositsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetAuthMeQueryKey() });
      },
      onError: (reason) => setNotice(`Selected purchase could not be completed. No cards were ordered. ${reason instanceof Error ? reason.message : 'Check your balance and available inventory, then try again.'}`),
    });
  };
  const toggleColumn = (columnId: CatalogColumn) => {
    setVisibleColumns((current) => current.includes(columnId)
      ? current.filter((column) => column !== columnId)
      : [...current, columnId]);
  };
  const resetFilters = () => {
    setBaseId('all');
    setSearchTerm('');
    setCatalogFilters(emptyCatalogFilters);
    setDraftCatalogFilters(emptyCatalogFilters);
  };
  const openFilters = () => {
    setDraftCatalogFilters({ ...catalogFilters });
    setFiltersOpen(true);
  };
  const applyCatalogFilters = () => {
    setCatalogFilters({ ...draftCatalogFilters, zip: draftCatalogFilters.zip.trim() });
    setFiltersOpen(false);
  };
  const updateDraftFilter = <K extends keyof CatalogFilters>(key: K, value: CatalogFilters[K]) => {
    setDraftCatalogFilters((current) => ({ ...current, [key]: value }));
  };
  useEffect(() => {
    try { window.localStorage.setItem(catalogColumnStorageKey, JSON.stringify(visibleColumns)); }
    catch { /* Column preferences remain usable for this visit when browser storage is unavailable. */ }
  }, [visibleColumns]);
  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => products.some((product) => product.id === id && product.availableCount > 0)).slice(0, 50));
  }, [products]);
  useEffect(() => { document.title = 'Buy Cards | ReplenishCC'; }, []);
  return <MemberGuard title="Buy Cards">{() => <section className="gift-page">
    <header className="gift-heading">
      <div><div className="gift-eyebrow"><span className="gift-live-dot" /> Authorized inventory</div><h1>Buy Cards</h1><p>Browse authorized listings and purchase with your account balance.</p></div>
      <Link className="gift-orders-link" href="/my-card-orders" data-testid="link-card-order-history"><Clipboard /> My card orders <ArrowRight /></Link>
    </header>
    {notice && <div className="gift-notice" role="status" data-testid="status-card-purchase">{notice}<Link href="/my-card-orders">View order history</Link><button aria-label="Dismiss purchase notice" onClick={() => setNotice('')} data-testid="button-dismiss-purchase-notice">×</button></div>}
    <section className="catalog-primary-controls" aria-label="Search and choose a base">
      <label className="gift-catalog-filter-field gift-catalog-search-field">
        <span>Search listings</span>
        <span className="gift-catalog-search-input"><Search aria-hidden="true" /><input type="search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Name, brand, type, issuer or location" aria-label="Search card listings by name, description, brand, type, issuer, or location" data-testid="input-card-catalog-search" /></span>
      </label>
      <label className="gift-catalog-filter-field catalog-base-select">
        <span>Base</span>
        <select value={baseId} onChange={(event) => setBaseId(event.target.value)} aria-label="Choose a card base" data-testid="select-card-base" disabled={productsQuery.isLoading || productsQuery.isError || products.length === 0}>
          <option value="all">All Bases</option>
          {products.map((product) => <option value={product.id} key={product.id}>{product.name}</option>)}
        </select>
      </label>
    </section>
    {productsQuery.isLoading ? <div className="gift-grid" aria-label="Loading card listings" data-testid="loading-card-products">{[1,2,3].map((i) => <div className="gift-product-skeleton" key={i}><i/><i/><i/><i/></div>)}</div>
      : productsQuery.isError ? <div className="gift-query-error" role="alert" data-testid="error-card-products">Catalog couldn’t be loaded. <button onClick={() => void productsQuery.refetch()} data-testid="button-retry-card-products"><RefreshCw /> Try again</button></div>
      : products.length === 0 ? <div className="gift-empty" data-testid="empty-card-catalog"><CreditCard /><h2>No card listings yet</h2><p>Once a listing is added, it will appear here along with its base and filters.</p></div>
      : <>
        <div className="gift-catalog-controls">
          <button type="button" className="quiet-button gift-filter-trigger" onClick={openFilters} aria-haspopup="dialog" aria-expanded={filtersOpen} data-testid="button-toggle-card-filters">
            <SlidersHorizontal aria-hidden="true" /> Filters {activeFilterCount > 0 && <span className="catalog-filter-count" aria-label={`${activeFilterCount} active filters`} data-testid="text-active-card-filter-count">{activeFilterCount}</span>} <ChevronRight className="chooser-chevron" aria-hidden="true" />
          </button>
          <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
            <DialogContent className="catalog-filter-dialog" data-testid="dialog-card-catalog-filters">
              <DialogHeader className="catalog-filter-header">
                <DialogTitle>Filters</DialogTitle>
                <p>Refine authorized inventory using listing details.</p>
              </DialogHeader>
              <div className="catalog-filter-body">
                <section className="catalog-filter-group" aria-labelledby="catalog-group-card-details">
                  <h3 id="catalog-group-card-details">Card details</h3>
                  <label className="catalog-filter-field" htmlFor="select-card-brand-filter">Brand
                    <select id="select-card-brand-filter" value={draftCatalogFilters.brand} onChange={(event) => updateDraftFilter('brand', event.target.value)} data-testid="select-card-brand-filter">
                      <option value="">All brands</option>{catalogOptions.brand.map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </label>
                  <label className="catalog-filter-field" htmlFor="select-card-type-filter">Card type
                    <select id="select-card-type-filter" value={draftCatalogFilters.cardType} onChange={(event) => updateDraftFilter('cardType', event.target.value)} data-testid="select-card-type-filter">
                      <option value="">All types</option>{catalogOptions.cardType.map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </label>
                  <label className="catalog-filter-field" htmlFor="select-card-issuer-filter">Issuer
                    <select id="select-card-issuer-filter" value={draftCatalogFilters.issuer} onChange={(event) => updateDraftFilter('issuer', event.target.value)} data-testid="select-card-issuer-filter">
                      <option value="">All issuers</option>{catalogOptions.issuer.map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </label>
                  <label className="catalog-filter-field" htmlFor="select-card-price-filter">Price
                  <select id="select-card-price-filter" value={draftCatalogFilters.price} onChange={(event) => updateDraftFilter('price', event.target.value as CatalogPriceFilter)} aria-label="Filter by price" data-testid="select-card-price-filter">
                    <option value="all">Any price</option><option value="under-25">Under $25</option><option value="25-50">$25 to under $50</option><option value="50-100">$50 to under $100</option><option value="100-plus">$100 and up</option>
                  </select>
                  </label>
                </section>
                <section className="catalog-filter-group" aria-labelledby="catalog-group-location">
                  <h3 id="catalog-group-location">Location</h3>
                  <label className="catalog-filter-field" htmlFor="select-card-state-filter">State
                    <select id="select-card-state-filter" value={draftCatalogFilters.state} onChange={(event) => updateDraftFilter('state', event.target.value)} data-testid="select-card-state-filter">
                      <option value="">All states</option>{catalogOptions.state.map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </label>
                  <label className="catalog-filter-field" htmlFor="select-card-city-filter">City
                    <select id="select-card-city-filter" value={draftCatalogFilters.city} onChange={(event) => updateDraftFilter('city', event.target.value)} data-testid="select-card-city-filter">
                      <option value="">All cities</option>{catalogOptions.city.map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </label>
                  <label className="catalog-filter-field" htmlFor="input-card-zip-filter">ZIP
                    <input id="input-card-zip-filter" type="search" inputMode="numeric" autoComplete="postal-code" value={draftCatalogFilters.zip} onChange={(event) => updateDraftFilter('zip', event.target.value)} placeholder="Any ZIP code" aria-label="Filter by ZIP code" data-testid="input-card-zip-filter" />
                  </label>
                  <label className="catalog-filter-field" htmlFor="select-card-address-filter">Public address
                    <select id="select-card-address-filter" value={draftCatalogFilters.address} onChange={(event) => updateDraftFilter('address', event.target.value as CatalogPresenceFilter)} data-testid="select-card-address-filter">
                      <option value="all">Any</option><option value="yes">Address listed</option><option value="no">No address listed</option>
                    </select>
                  </label>
                </section>
                <section className="catalog-filter-group" aria-labelledby="catalog-group-included-details">
                  <h3 id="catalog-group-included-details">Included details</h3>
                  <label className="catalog-filter-field" htmlFor="select-card-email-filter">Email available
                    <select id="select-card-email-filter" value={draftCatalogFilters.email} onChange={(event) => updateDraftFilter('email', event.target.value as CatalogPresenceFilter)} data-testid="select-card-email-filter">
                      <option value="all">Any</option><option value="yes">Included</option><option value="no">Not included</option>
                    </select>
                  </label>
                  <label className="catalog-filter-field" htmlFor="select-card-phone-filter">Phone available
                    <select id="select-card-phone-filter" value={draftCatalogFilters.phone} onChange={(event) => updateDraftFilter('phone', event.target.value as CatalogPresenceFilter)} data-testid="select-card-phone-filter">
                      <option value="all">Any</option><option value="yes">Included</option><option value="no">Not included</option>
                    </select>
                  </label>
                  <p className="catalog-filter-privacy-note"><LockKeyhole aria-hidden="true" /> Filters only use public listing details and availability indicators.</p>
                </section>
              </div>
              <div className="catalog-filter-footer">
                <button type="button" className="catalog-filter-reset" onClick={() => setDraftCatalogFilters(emptyCatalogFilters)} data-testid="button-reset-dialog-card-filters">Reset selections</button>
                <button type="button" className="catalog-filter-apply" onClick={applyCatalogFilters} data-testid="button-show-filter-results">
                  Show {draftResultCount} result{draftResultCount === 1 ? '' : 's'}
                </button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        <div className="catalog-selection-bar">
          <div><strong>{selectedProducts.length} selected</strong><span>{selectedProducts.length ? ` · Estimated total ${money(selectedTotalCents)}` : ' · Choose one card from each listing'}</span></div>
          <button type="button" className="catalog-buy-selected" onClick={purchaseSelected} disabled={!selectedProducts.length || bulkPurchase.isPending || purchase.isPending} data-testid="button-buy-selected">
            <ShoppingCart aria-hidden="true" />{bulkPurchase.isPending ? 'Processing…' : `Buy Selected${selectedProducts.length ? ` (${selectedProducts.length})` : ''}`}
          </button>
        </div>
        <div className="gift-column-control catalog-columns-after">
          <span className="gift-column-visibility-label">Column Visibility</span>
          <details className="column-chooser gift-column-chooser">
            <summary className="quiet-button" data-testid="button-choose-card-columns"><Columns3 /> Columns <ChevronRight className="chooser-chevron" /></summary>
            <div className="column-chooser-menu" role="group" aria-label="Choose visible card listing columns">
              <p className="gift-column-note">Base stays visible. Choose which details and actions to show; private card credentials never appear as columns.</p>
              {catalogColumns.map((column) => <label key={column.id} className="column-choice">
                <input type="checkbox" checked={visibleColumns.includes(column.id)} onChange={() => toggleColumn(column.id)} data-testid={`checkbox-card-column-${column.id}`} />
                <span>{column.label}</span>
              </label>)}
            </div>
          </details>
        </div>
        <div className="gift-catalog-results" role="status" data-testid="text-card-catalog-results">
          Showing <strong>{filteredProducts.length}</strong> of {products.length} listings
          {activeFilterCount > 0 && <button type="button" onClick={resetFilters} data-testid="button-clear-card-filters"><RotateCcw /> Clear filters</button>}
        </div>
        {filteredProducts.length === 0 ? <div className="gift-empty gift-filter-empty" data-testid="empty-filtered-card-catalog"><Search /><h2>No matching listings</h2><p>Try changing the search text or filters.</p><button type="button" className="gift-primary-link" onClick={resetFilters} data-testid="button-reset-card-filters">Reset filters <RotateCcw /></button></div>
          : <div className="gift-catalog-table-wrap" role="region" aria-label="Card listings" tabIndex={0}>
            <table className="gift-catalog-table">
              <thead><tr><th scope="col" className="catalog-select-cell"><input type="checkbox" aria-label="Select all available filtered listings" checked={allVisibleSelected} disabled={!selectableProducts.length} onChange={() => setSelectedIds((current) => allVisibleSelected ? current.filter((id) => !selectableProducts.some((product) => product.id === id)) : [...new Set([...current, ...selectableProducts.map((product) => product.id)])].slice(0, 50))} /></th><th scope="col">Base</th>{visibleColumns.map((column) => <th scope="col" key={column} className={column === 'actions' ? 'catalog-actions-cell' : undefined}>{catalogColumns.find((item) => item.id === column)?.label}</th>)}</tr></thead>
              <tbody>{filteredProducts.map((product) => <tr key={product.id} data-testid={`row-gift-product-${product.id}`}>
                <td className="catalog-select-cell"><input type="checkbox" aria-label={`Select one ${product.name} card`} checked={selectedIds.includes(product.id)} disabled={product.availableCount < 1 || (selectedIds.length >= 50 && !selectedIds.includes(product.id))} onChange={() => toggleSelection(product.id)} data-testid={`checkbox-select-card-${product.id}`} /></td>
                <td><div className="gift-catalog-product"><div><strong data-testid={`text-gift-product-name-${product.id}`}>{product.name}</strong></div></div></td>
                {visibleColumns.includes('brand') && <td data-testid={`text-gift-card-brand-${product.id}`}>{product.brand || '—'}</td>}
                {visibleColumns.includes('cardType') && <td data-testid={`text-gift-card-type-${product.id}`}>{product.cardType || '—'}</td>}
                {visibleColumns.includes('issuer') && <td data-testid={`text-gift-card-issuer-${product.id}`}>{product.issuer || '—'}</td>}
                {visibleColumns.includes('city') && <td data-testid={`text-gift-city-${product.id}`}>{productLocationValue(product, 'city')}</td>}
                {visibleColumns.includes('state') && <td data-testid={`text-gift-state-${product.id}`}>{productLocationValue(product, 'state')}</td>}
                {visibleColumns.includes('regionZip') && <td data-testid={`text-gift-region-zip-${product.id}`}>{productLocationValue(product, 'regionZip')}</td>}
                {visibleColumns.includes('price') && <td className="gift-catalog-price" data-testid={`text-gift-member-price-${product.id}`}>{money(product.priceCents)}</td>}
                {visibleColumns.includes('actions') && <td className="catalog-actions-cell"><div className="gift-catalog-actions">
                  <button className="gift-info-button" type="button" onClick={() => setInfoProductId(product.id)} data-testid={`button-info-card-${product.id}`}><Info /> Info</button>
                  <button className="gift-purchase-button" type="button" disabled={purchase.isPending || bulkPurchase.isPending || product.availableCount < 1} onClick={() => purchaseOne(product.id)} aria-label={`Buy one ${product.name}`} data-testid={`button-purchase-card-${product.id}`}>{purchase.isPending ? 'Working…' : 'Buy 1'} <ShoppingCart /></button>
                </div></td>}
              </tr>)}</tbody>
            </table>
          </div>}
        {filteredProducts.length > 0 && <p className="gift-catalog-scroll-note">{visibleColumns.includes('actions') ? 'Swipe to browse columns. Info and Buy 1 are in the Actions column.' : 'Actions are hidden; turn on Actions in Columns to view Info and Buy 1.'}</p>}
      </>}
    <Dialog open={!!infoProduct} onOpenChange={(open) => { if (!open) setInfoProductId(null); }}>
      {infoProduct && <DialogContent className="card-detail-dialog" data-testid={`dialog-card-info-${infoProduct.id}`}>
        <DialogHeader className="card-detail-heading">
          <span className="card-detail-eyebrow">CARD DETAILS</span>
          <DialogTitle>{infoProduct.name}</DialogTitle>
          <DialogDescription data-testid={`text-card-info-description-${infoProduct.id}`}>{infoProduct.description || 'Authorized gift-card listing'}</DialogDescription>
        </DialogHeader>
        <dl className="card-detail-facts">
          {cardInfoFacts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd data-testid={fact.testId}>{fact.value}</dd></div>)}
        </dl>
        <section className="card-detail-locations" aria-labelledby={`card-info-locations-${infoProduct.id}`}>
          <h3 id={`card-info-locations-${infoProduct.id}`}>Public locations</h3>
          <p>One location is shown for each available card. Your order history will show the location for the card you receive.</p>
          {infoProduct.availableCardLocations.length > 0
            ? <ol>{infoProduct.availableCardLocations.map((location, index) => <li key={`${index}-${location.address}-${location.regionZip ?? ''}`} data-testid={`text-card-info-location-${infoProduct.id}-${index}`}>
              <span>Card {index + 1}</span>
              <address>
                <strong>{location.address || 'Address not specified'}</strong>
                <span>{[location.city, location.state].filter(Boolean).join(', ') || 'City/state not specified'}</span>
                {location.regionZip && <span>{location.regionZip}</span>}
              </address>
            </li>)}</ol>
            : <p>No cards are currently available.</p>}
        </section>
        <section className="card-detail-features" aria-labelledby={`card-info-features-${infoProduct.id}`}>
          <h3 id={`card-info-features-${infoProduct.id}`}>Available Features</h3>
          <ul>
            {cardInfoFeatures.map((feature) => <li className="card-detail-feature" key={feature.label}>
              <span>{feature.label}</span>
              <span className={`card-detail-status${feature.available ? ' is-available' : ''}`} data-testid={feature.testId}>
                {feature.available && <span className="card-detail-status-icon"><Check aria-hidden="true" /></span>}
                <span>{feature.available ? 'Available' : 'Not included'}</span>
              </span>
            </li>)}
          </ul>
        </section>
        <p className="card-detail-purchase-summary"><Check aria-hidden="true" /> One card per order · paid from account balance · details delivered to private order history.</p>
        <p className="card-detail-private-note"><LockKeyhole aria-hidden="true" /> Full card credentials are only available to the purchaser after checkout.</p>
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
  const orders = ordersQuery.data?.orders ?? [];
  const exportOrders = () => {
    if (orders.length === 0) return;
    const orderSections = orders.map((order, orderIndex) => [
      `Order ${orderIndex + 1}`,
      `ID: ${plainTextLine(order.id)}`,
      `Purchased: ${date(order.createdAt)}`,
      `Listing: ${plainTextLine(order.productName)}`,
      `Description: ${plainTextLine(order.description)}`,
      `Quantity: ${order.quantity}`,
      `Unit price: ${money(order.unitPriceCents)}`,
      `Total paid: ${money(order.totalCents)}`,
      `Delivered cards (${order.deliveredCards.length}):`,
      ...(order.deliveredCards.length
        ? order.deliveredCards.flatMap((card, cardIndex) => [
          `Card ${cardIndex + 1}`,
          `Card number: ${plainTextLine(card.cardNumber)}`,
          `Expiration: ${plainTextLine(card.expiration)}`,
          `Security code: ${plainTextLine(card.securityCode)}`,
          ...(card.email ? [`Email: ${plainTextLine(card.email)}`] : []),
          ...(card.phone ? [`Phone: ${plainTextLine(card.phone)}`] : []),
          ...(card.publicLocation ? [`Public location: ${[
            card.publicLocation.address,
            card.publicLocation.city,
            card.publicLocation.state,
            card.publicLocation.regionZip,
          ].filter(Boolean).map(plainTextLine).join(', ') || 'Not specified'}`] : []),
        ])
        : ['None']),
    ].join('\n'));
    const fileDate = new Date().toISOString().slice(0, 10);
    downloadTextFile(
      `replenishcc-card-orders-${fileDate}.txt`,
      [
        'ReplenishCC — My Card Orders',
        `Exported: ${date(new Date().toISOString())}`,
        'Contains full card credentials in plain text. Store this file securely.',
        '',
        orderSections.join('\n\n'),
      ].join('\n'),
    );
  };
  return <MemberGuard title="My card orders">{() => <section className="gift-page">
    <header className="gift-heading"><div><div className="gift-eyebrow">Private delivery ledger</div><h1>Your card <em>orders.</em></h1><p>Complete credentials for cards purchased by this account. Keep these details private.</p></div><div className="workspace-heading-actions"><button type="button" className="workspace-secondary-button" onClick={exportOrders} disabled={orders.length === 0} title="Downloads full card credentials in plain text. Store the file securely." data-testid="button-export-card-orders"><Download aria-hidden="true" /> Export .txt</button><Link className="gift-orders-link" href="/buy-cards" data-testid="link-back-to-card-catalog"><CreditCard /> Browse cards <ArrowRight /></Link></div></header>
    <div className="gift-assurance"><span><LockKeyhole /> Visible to account owner</span><span><ShieldCheck /> Secure delivery record</span></div>
    {ordersQuery.isLoading ? <div className="gift-orders-loading" data-testid="loading-card-orders">{[1,2].map((n) => <div className="gift-order-skeleton" key={n}/>)}</div>
      : ordersQuery.isError ? <div className="gift-query-error" role="alert" data-testid="error-card-orders">Order history couldn’t be loaded. <button onClick={() => void ordersQuery.refetch()} data-testid="button-retry-card-orders"><RefreshCw /> Try again</button></div>
      : orders.length === 0 ? <div className="gift-empty" data-testid="empty-card-orders"><Clipboard /><h2>Your delivery ledger is empty</h2><p>After a purchase, the full card details will appear here for this account only.</p><Link href="/buy-cards" className="gift-primary-link" data-testid="link-shop-first-card">Browse available cards <ArrowRight /></Link></div>
      : <div className="gift-orders-list">{orders.map((order) => <article className="gift-order" key={order.id} data-testid={`card-order-${order.id}`}>
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
      ...(card.email ? [['Email', visible ? card.email : '••••••••', card.email, 'email']] : []),
      ...(card.phone ? [['Phone', visible ? card.phone : '••••••••', card.phone, 'phone']] : []),
    ].map(([label, display, raw, field]) => <div className="gift-credential-field" key={field}><small>{label}</small><strong data-testid={`text-credential-${field}-${orderId}-${index}`}>{display}</strong>{visible && raw && <button onClick={() => copy(raw, field)} aria-label={`Copy ${label}`} data-testid={`button-copy-${field}-${orderId}-${index}`}>{copied === `${orderId}-${index}-${field}` ? <Check /> : <Clipboard />}<span>{copied === `${orderId}-${index}-${field}` ? 'Copied' : 'Copy'}</span></button>}{copied === `failed-${orderId}-${index}-${field}` && <small className="gift-copy-error" role="status">Clipboard unavailable. Select and copy manually.</small>}</div>)}</div>
    {card.publicLocation && <div className="gift-card-public-location" data-testid={`text-card-public-location-${orderId}-${index}`}>
      <small>Public location</small>
      <strong>{[
        card.publicLocation.address,
        [card.publicLocation.city, card.publicLocation.state].filter(Boolean).join(', '),
        card.publicLocation.regionZip,
      ].filter(Boolean).join(' · ') || 'Not specified'}</strong>
    </div>}
  </section>;
}

const stockSchema = z.object({
  productId: z.string().min(1, 'Choose a base'),
  cards: z.string()
    .trim()
    .min(1, 'Paste or import at least one card')
    .max(100_000, 'Keep the batch under 100 KB')
});
type StockForm = z.infer<typeof stockSchema>;

export function AdminCardInventoryPage() {
  const queryClient = useQueryClient();
  const session = useGetAuthMe();
  const [, setLocation] = useLocation();
  const products = useGetAdminGiftCardProducts({ query: { queryKey: getGetAdminGiftCardProductsQueryKey() } });
  const create = useCreateAdminGiftCardProduct();
  const addStock = useAddAdminGiftCardStock();
  const remove = useDeleteAdminGiftCardProduct();
  const restore = useRestoreAdminGiftCardProduct();
  const updateMetadata = useUpdateAdminGiftCardProductMetadata();
  const [feedback, setFeedback] = useState('');
  const [stockFileName, setStockFileName] = useState('');
  const [stockFileError, setStockFileError] = useState('');
  const stockFileInput = useRef<HTMLInputElement>(null);
  const [editingMetadata, setEditingMetadata] = useState<{ productId: string; productName: string } | null>(null);
  const [metadataDraft, setMetadataDraft] = useState({ address: '', state: '', city: '', regionZip: '', cardType: '', issuer: '', brand: '' });
  const form = useForm<BaseForm>({ resolver: zodResolver(baseSchema), defaultValues: { name: '', price: 0 } });
  const stockForm = useForm<StockForm>({ resolver: zodResolver(stockSchema), defaultValues: { productId: '', cards: '' } });
  const stockText = stockForm.watch('cards') ?? '';
  const stockImport = useMemo(() => parseCardStockInput(stockText), [stockText]);
  const stockCards = stockImport.cards;
  const stockIssueCount = stockCards.filter((card) => card.issues.length > 0).length;
  const stockLocationCounts = {
    address: stockCards.filter((card) => card.address).length,
    state: stockCards.filter((card) => card.state).length,
    city: stockCards.filter((card) => card.city).length,
    zip: stockCards.filter((card) => card.regionZip).length,
  };
  const stockContactCounts = {
    email: stockCards.filter((card) => card.email).length,
    phone: stockCards.filter((card) => card.phone).length,
  };
  const rows = products.data?.products ?? [];
  const selectedStockProduct = rows.find((product) => product.id === stockForm.watch('productId'));
  const totalStock = useMemo(() => rows.reduce((sum, item) => sum + (item.isArchived ? 0 : item.availableCount), 0), [rows]);
  useEffect(() => { document.title = 'Bases | ReplenishCC Admin'; }, []);
  useEffect(() => { if (!session.isLoading && (session.isError || !session.data?.authenticated)) setLocation('/login'); else if (!session.isLoading && session.data?.user && !session.data.user.isDepositAdmin) setLocation('/dashboard'); }, [session.isLoading, session.isError, session.data?.authenticated, session.data?.user, setLocation]);
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: getGetAdminGiftCardProductsQueryKey() }); void queryClient.invalidateQueries({ queryKey: getGetGiftCardProductsQueryKey() }); };
  const loadStockFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    const isTextMime = file.type.startsWith('text/') || file.type === 'application/json' || file.type === 'application/x-ndjson';
    if (!STOCK_FILE_EXTENSIONS.has(extension) && !isTextMime) {
      setStockFileError('Choose a text, CSV, TSV, JSON, or JSON Lines file. Binary files are not supported.');
      input.value = '';
      return;
    }
    if (file.size > MAX_STOCK_FILE_BYTES) {
      setStockFileError('Keep the file under 100 KB. Split larger uploads into separate batches.');
      input.value = '';
      return;
    }
    try {
      const text = await file.text();
      if (!text.trim()) {
        setStockFileError('That file is empty. Choose another file or paste card data.');
        input.value = '';
        return;
      }
      stockForm.setValue('cards', text, { shouldDirty: true, shouldValidate: true });
      setStockFileName(file.name);
      setStockFileError('');
      setFeedback('');
    } catch {
      setStockFileError('The file could not be read as text. Choose a supported text, CSV, TSV, JSON, or JSON Lines file.');
      input.value = '';
    }
  };
  const saveMetadata = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingMetadata) return;
    const regionZip = metadataDraft.regionZip.trim();
    if (regionZip && !/^\d{5}(?:-\d{4})?$/.test(regionZip)) {
      setFeedback('Enter a valid 5-digit ZIP or ZIP+4 for the base region.');
      return;
    }
    const cardType = metadataDraft.cardType.trim();
    const issuer = metadataDraft.issuer.trim();
    const brand = metadataDraft.brand.trim();
    const address = metadataDraft.address.trim();
    const state = metadataDraft.state.trim();
    const city = metadataDraft.city.trim();
    if (!cardType || !issuer || !brand || [cardType, issuer, brand].some((value) => value.length > 80)) {
      setFeedback('Enter a card type, issuer, and brand (up to 80 characters each).');
      return;
    }
    if (address.length > 255 || state.length > 80 || city.length > 120) {
      setFeedback('Address, state, or city exceeds its maximum length.');
      return;
    }
    updateMetadata.mutate(
      { productId: editingMetadata.productId, data: { address, state, city, regionZip: regionZip || null, cardType, issuer, brand } },
      {
        onSuccess: () => {
          setEditingMetadata(null);
          invalidate();
          setFeedback('Base location defaults and card metadata updated.');
        },
        onError: () => setFeedback('Base metadata could not be updated. Try again.'),
      },
    );
  };
  if (session.isLoading || !session.data?.user?.isDepositAdmin) return <MemberShell pageTitle="Bases" user={null} loading shellMode="force" />;
  return <section className="gift-admin">
    <header className="gift-admin-heading"><div><div className="gift-eyebrow">Restricted operations · inventory only</div><h2>Bases</h2><p>Set a base name and per-card price, then upload encrypted card stock. Credentials are intentionally excluded from this table.</p></div><div className="gift-admin-stat"><small>Available cards</small><strong data-testid="text-admin-total-stock">{products.isLoading ? '—' : totalStock}</strong></div></header>
    {feedback && <div className="gift-notice" role="status" data-testid="status-admin-card-action">{feedback}<button onClick={() => setFeedback('')} aria-label="Dismiss message" data-testid="button-dismiss-admin-message">×</button></div>}
    <div className="gift-admin-forms">
      <section className="gift-admin-panel"><div className="gift-admin-panel-title"><span>01</span><div><h3>Create a base</h3><p>The base name and Price apply to every card uploaded under it.</p></div></div>
        <Form {...form}><form onSubmit={form.handleSubmit((values) => {
          const priceCents = Math.round(values.price * 100);
            create.mutate({ data: {
            name: values.name.trim(),
            description: '',
            regionZip: null,
            faceValueCents: priceCents,
            priceCents,
          } }, { onSuccess: () => { form.reset(); invalidate(); setFeedback('Base created. Import or paste card data to add stock.'); }, onError: () => setFeedback('Base could not be created. Review the values and try again.') });
        })} className="gift-form">
          <div className="gift-form-pair">
            <FormField control={form.control} name="name" render={({ field }) => <FormItem><FormLabel>Base name</FormLabel><FormControl><Input {...field} placeholder="Vanilla Visa · Standard" data-testid="input-admin-card-name" /></FormControl><FormMessage /></FormItem>} />
            <FormField control={form.control} name="price" render={({ field }) => <FormItem><FormLabel>Price (USD)</FormLabel><FormControl><Input {...field} type="number" min="0.01" max="10000" step="0.01" data-testid="input-admin-card-price" /></FormControl><FormMessage /></FormItem>} />
          </div>
          <button className="gift-admin-submit" disabled={create.isPending} data-testid="button-create-card-listing">{create.isPending ? 'Creating…' : 'Create base'} <ArrowRight /></button>
        </form></Form>
      </section>
      <section className="gift-admin-panel"><div className="gift-admin-panel-title"><span>02</span><div><h3>Upload cards</h3><p>Import or paste up to {MAX_CARDS_PER_BATCH} cards per batch. Fields are detected from common headers, delimiters, and labeled text. Active bases can receive additional batches.</p></div></div>
        <Form {...stockForm}><form onSubmit={stockForm.handleSubmit((values) => {
          const parsedBatch = parseCardStockInput(values.cards);
          if (!parsedBatch.cards.length) {
            setFeedback(parsedBatch.message || 'No card records were detected.');
            return;
          }
          if (parsedBatch.cards.length > MAX_CARDS_PER_BATCH) {
            setFeedback(`Split this upload into batches of no more than ${MAX_CARDS_PER_BATCH} cards.`);
            return;
          }
          const invalidCardIndex = parsedBatch.cards.findIndex((card) => card.issues.length > 0);
          if (invalidCardIndex >= 0) {
            setFeedback(`Card ${invalidCardIndex + 1} needs review: ${parsedBatch.cards[invalidCardIndex]!.issues.join(' ')}`);
            return;
          }
          if (selectedStockProduct?.isArchived) {
            setFeedback('Restore this base before uploading more cards.');
            return;
          }
          const cards: GiftCardCredential[] = parsedBatch.cards.map((card) => ({
            cardNumber: card.cardNumber,
            expiration: card.expiration,
            securityCode: card.securityCode,
            email: card.email,
            phone: card.phone,
            publicLocation: {
              address: card.address,
              state: card.state,
              city: card.city,
              regionZip: card.regionZip,
            },
          }));
          addStock.mutate({
            productId: values.productId,
            data: { cards },
          }, { onSuccess: (result) => {
            stockForm.reset();
            setStockFileName('');
            setStockFileError('');
            if (stockFileInput.current) stockFileInput.current.value = '';
            invalidate();
            const label = `${result.addedCount} card${result.addedCount === 1 ? '' : 's'}`;
            setFeedback(`${label} added. This base now has ${result.availableCount} available. ${result.binMetadataApplied ? 'BIN metadata auto-filled.' : 'BIN metadata was not applied; edit the base metadata if needed.'} ${result.locationMetadataApplied ? 'Per-card public locations saved.' : 'Base location defaults were used.'} ${result.redemptionZipApplied ? 'Per-card ZIP values saved.' : 'Base ZIP defaults were used where available.'}`);
          }, onError: () => setFeedback('Stock upload was rejected. Check the preview and try again.') });
        })} className="gift-form">
           <FormField control={stockForm.control} name="productId" render={({ field }) => <FormItem><FormLabel>Base</FormLabel><FormControl><select {...field} data-testid="select-admin-stock-product"><option value="">Select a base</option>{rows.map((product) => <option key={product.id} value={product.id} disabled={product.isArchived}>{product.name} · {product.isArchived ? 'archived — restore before use' : 'ready for more cards'}</option>)}</select></FormControl><FormMessage /></FormItem>} />
           <div className="gift-stock-file">
             <label htmlFor="input-admin-card-stock-file">Choose a card file</label>
             <input ref={stockFileInput} id="input-admin-card-stock-file" type="file" accept=".txt,.text,.csv,.tsv,.json,.jsonl,.ndjson,.log,.dat,text/*,application/json" onChange={(event) => void loadStockFile(event)} data-testid="input-admin-card-stock-file" />
             <span>Common text, CSV, TSV, JSON, or JSON Lines formats · maximum 100 KB</span>
             {stockFileName && <span className="gift-stock-file-name">Loaded: {stockFileName}</span>}
             {stockFileError && <span className="gift-stock-file-error" role="alert">{stockFileError}</span>}
           </div>
           <FormField control={stockForm.control} name="cards" render={({ field }) => <FormItem><FormLabel>Card data · {stockCards.length}/{MAX_CARDS_PER_BATCH} detected</FormLabel><FormControl><Textarea {...field} onChange={(event) => { field.onChange(event); setStockFileName(''); setStockFileError(''); setFeedback(''); }} rows={8} maxLength={100_000} placeholder="Import a file or paste CSV, TSV, JSON, labeled fields, or delimited card rows." data-testid="input-admin-card-stock" /></FormControl>
             <div className="gift-stock-detection" aria-live="polite"><span className={stockLocationCounts.address ? 'is-detected' : ''}>{stockLocationCounts.address ? <Check aria-hidden="true" /> : <i aria-hidden="true" />}Address {stockLocationCounts.address}/{stockCards.length}</span><span className={stockLocationCounts.state ? 'is-detected' : ''}>{stockLocationCounts.state ? <Check aria-hidden="true" /> : <i aria-hidden="true" />}State {stockLocationCounts.state}/{stockCards.length}</span><span className={stockLocationCounts.city ? 'is-detected' : ''}>{stockLocationCounts.city ? <Check aria-hidden="true" /> : <i aria-hidden="true" />}City {stockLocationCounts.city}/{stockCards.length}</span><span className={stockLocationCounts.zip ? 'is-detected' : ''}>{stockLocationCounts.zip ? <Check aria-hidden="true" /> : <i aria-hidden="true" />}ZIP {stockLocationCounts.zip}/{stockCards.length}</span><span className={stockContactCounts.email ? 'is-detected' : ''}>{stockContactCounts.email ? <Check aria-hidden="true" /> : <i aria-hidden="true" />}Email {stockContactCounts.email}/{stockCards.length}</span><span className={stockContactCounts.phone ? 'is-detected' : ''}>{stockContactCounts.phone ? <Check aria-hidden="true" /> : <i aria-hidden="true" />}Phone {stockContactCounts.phone}/{stockCards.length}</span></div>
             <div className="gift-stock-preview" aria-live="polite" data-testid="preview-admin-card-stock">
               <div className="gift-stock-preview-header"><strong>{stockCards.length ? `${stockCards.length} card${stockCards.length === 1 ? '' : 's'} detected · ${stockImport.format}` : stockImport.format}</strong><span>{stockCards.length ? `${stockCards.length - stockIssueCount} ready · ${stockIssueCount} need review` : ''}</span></div>
               {stockCards.length ? <div className="gift-stock-preview-list">
                 {stockCards.slice(0, 4).map((card, index) => <div className="gift-stock-preview-row" key={`${card.sourceRow}-${index}`}>
                   <span>Card {index + 1} · {card.cardNumber.length >= 4 ? `•••• ${card.cardNumber.slice(-4)}` : 'number missing'} · {card.expiration || 'expiration missing'}</span>
                   <span className={card.issues.length ? 'needs-review' : 'ready'}>{card.issues.length ? card.issues.join(' ') : 'Ready'}</span>
                 </div>)}
                 {stockCards.length > 4 && <span className="gift-stock-preview-more">Plus {stockCards.length - 4} more records</span>}
                 {stockCards.length > MAX_CARDS_PER_BATCH && <span className="gift-stock-file-error">Split this into batches of at most {MAX_CARDS_PER_BATCH} cards.</span>}
               </div> : <p>{stockImport.message}</p>}
             </div>
             <FormMessage />
           </FormItem>} />
           <div className="gift-upload-note"><LockKeyhole /> Address, state, city, and ZIP are public per card; each card can have a different location. Blank fields use the base defaults. BIN lookup uses the first 8 digits only after the batch is accepted.</div>
           <div className="gift-upload-note"><LockKeyhole /> Parsing stays in your browser. On upload, card credentials are sent to ReplenishCC and encrypted; actual credentials are revealed only to the purchaser.</div>
           <button className="gift-admin-submit" disabled={addStock.isPending || !rows.some((product) => !product.isArchived) || !selectedStockProduct || selectedStockProduct.isArchived || stockCards.length === 0 || stockCards.length > MAX_CARDS_PER_BATCH || stockIssueCount > 0 || Boolean(stockImport.message)} data-testid="button-upload-card-stock">{addStock.isPending ? 'Uploading…' : `Upload ${stockCards.length || ''} card${stockCards.length === 1 ? '' : 's'}`} <ArrowRight /></button>
         </form></Form>
      </section>
    </div>
      <section className="gift-inventory-panel"><header><div><h3>Bases</h3><p>Price, base location defaults, contact-presence indicators, and available quantity only. Archived bases are hidden from members; their stock and purchase history are preserved. Actual card details stay private.</p></div><button onClick={() => void products.refetch()} aria-label="Refresh bases" data-testid="button-refresh-card-inventory"><RefreshCw /></button></header>
      {products.isLoading ? <div className="gift-admin-loading" data-testid="loading-admin-card-inventory"><i/><i/><i/></div>
      : products.isError ? <div className="gift-query-error" role="alert" data-testid="error-admin-card-inventory">Inventory unavailable. <button onClick={() => void products.refetch()} data-testid="button-retry-admin-card-inventory">Retry</button></div>
      : rows.length === 0 ? <div className="gift-admin-empty" data-testid="empty-admin-card-inventory">No bases created yet. Create a base above to begin.</div>
        : <div className="gift-table-wrap">
          <table className="gift-table">
             <thead><tr><th>Base</th><th>Status</th><th>Default address</th><th>Default state</th><th>Default city</th><th>Default ZIP</th><th>Card type</th><th>Issuer</th><th>Brand</th><th>Price</th><th>Email in stock</th><th>Phone in stock</th><th>Available</th><th>Batch status</th><th>Created</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{rows.map((product) => <tr key={product.id} data-testid={`row-card-inventory-${product.id}`}>
               <td><strong>{product.name}</strong></td>
               <td><span data-testid={`text-card-base-status-${product.id}`}>{product.isArchived ? 'Archived' : 'Active'}</span></td>
              <td>{product.address || '—'}</td><td>{product.state || '—'}</td><td>{product.city || '—'}</td><td>{product.regionZip || '—'}</td>
              <td>{product.cardType || '—'}</td><td>{product.issuer || '—'}</td><td>{product.brand || '—'}</td>
              <td>{money(product.priceCents)}</td>
              <td><ContactIndicator available={product.hasEmail} label="Email" /></td><td><ContactIndicator available={product.hasPhone} label="Phone" /></td>
                <td><span className="gift-count-chip">{product.availableCount}</span></td><td>{product.isArchived ? 'Archived' : product.hasHistory ? 'Ready for more cards' : 'Ready for first upload'}</td><td>{date(product.createdAt)}</td>
              <td>
                <button className="gift-edit" type="button" onClick={() => { setEditingMetadata({ productId: product.id, productName: product.name }); setMetadataDraft({ address: product.address, state: product.state, city: product.city, regionZip: product.regionZip ?? '', cardType: product.cardType, issuer: product.issuer, brand: product.brand }); }} data-testid={`button-edit-card-metadata-${product.id}`}><Pencil /> Edit metadata</button>{' '}
                {product.isArchived
                  ? <button className="gift-edit" disabled={restore.isPending || remove.isPending} title="Restore this base to member sales" onClick={() => restore.mutate({ productId: product.id }, { onSuccess: () => { invalidate(); setFeedback('Base restored to member sales. Its inventory and purchase history are unchanged.'); }, onError: () => setFeedback('Base could not be restored. Try again.') })} data-testid={`button-restore-card-listing-${product.id}`}><RotateCcw /> Restore</button>
                  : <button className="gift-delete" disabled={remove.isPending || restore.isPending} title={product.hasHistory ? 'Archive while preserving its stock and purchase history' : 'Delete this empty base'} onClick={() => {
                    const confirmation = `Remove base “${product.name}”? Empty bases are deleted. Bases with inventory or order history are archived and preserved, including purchased-card history, credentials, and accounting records.`;
                    if (!window.confirm(confirmation)) return;
                    remove.mutate({ productId: product.id }, { onSuccess: (result) => { invalidate(); setFeedback(result.action === 'archived' ? 'Base archived. Its stock, purchase history, credentials, and accounting are preserved.' : 'Empty base deleted.'); }, onError: () => setFeedback('Base could not be deleted or archived. Try again.') });
                  }} data-testid={product.hasHistory ? `button-archive-card-listing-${product.id}` : `button-delete-card-listing-${product.id}`}>{product.hasHistory ? <Archive /> : <Trash2 />} {product.hasHistory ? 'Archive' : 'Delete'}</button>}
              </td>
            </tr>)}</tbody>
          </table>
        </div>}
    </section>
      <Dialog open={!!editingMetadata} onOpenChange={(open) => { if (!open && !updateMetadata.isPending) setEditingMetadata(null); }}>
        <DialogContent className="gift-info-dialog">
          <DialogHeader className="gift-info-dialog-head">
            <div><DialogTitle>Edit base metadata</DialogTitle><DialogDescription>{editingMetadata?.productName} · Public fallback values used when an uploaded card omits a location field.</DialogDescription></div>
          </DialogHeader>
          <form className="gift-form" onSubmit={saveMetadata}>
            <label htmlFor="edit-card-address">Address</label>
            <Input id="edit-card-address" value={metadataDraft.address} onChange={(event) => setMetadataDraft((current) => ({ ...current, address: event.target.value }))} maxLength={255} data-testid="input-edit-card-address" />
            <label htmlFor="edit-card-state">State</label>
            <Input id="edit-card-state" value={metadataDraft.state} onChange={(event) => setMetadataDraft((current) => ({ ...current, state: event.target.value }))} maxLength={80} data-testid="input-edit-card-state" />
            <label htmlFor="edit-card-city">City</label>
            <Input id="edit-card-city" value={metadataDraft.city} onChange={(event) => setMetadataDraft((current) => ({ ...current, city: event.target.value }))} maxLength={120} data-testid="input-edit-card-city" />
            <label htmlFor="edit-card-region-zip">ZIP</label>
            <Input id="edit-card-region-zip" value={metadataDraft.regionZip} onChange={(event) => setMetadataDraft((current) => ({ ...current, regionZip: event.target.value }))} inputMode="numeric" maxLength={10} placeholder="5-digit ZIP or ZIP+4" data-testid="input-edit-card-region-zip" />
            <label htmlFor="edit-card-type">Card type</label>
            <Input id="edit-card-type" value={metadataDraft.cardType} onChange={(event) => setMetadataDraft((current) => ({ ...current, cardType: event.target.value }))} maxLength={80} data-testid="input-edit-card-type" />
            <label htmlFor="edit-card-issuer">Issuer</label>
            <Input id="edit-card-issuer" value={metadataDraft.issuer} onChange={(event) => setMetadataDraft((current) => ({ ...current, issuer: event.target.value }))} maxLength={80} data-testid="input-edit-card-issuer" />
            <label htmlFor="edit-card-brand">Brand</label>
            <Input id="edit-card-brand" value={metadataDraft.brand} onChange={(event) => setMetadataDraft((current) => ({ ...current, brand: event.target.value }))} maxLength={80} data-testid="input-edit-card-brand" />
            <p className="gift-zip-note">These public defaults are used only for blank fields during upload; editing them does not change locations already saved on individual cards. Card number, expiration, security code, email, and phone stay private.</p>
            <button type="submit" className="gift-admin-submit" disabled={updateMetadata.isPending} data-testid="button-save-card-metadata">{updateMetadata.isPending ? 'Saving…' : 'Save metadata'} <Check /></button>
          </form>
        </DialogContent>
      </Dialog>
  </section>;
}