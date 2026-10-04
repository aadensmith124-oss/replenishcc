import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { ArrowRight, Check, ChevronRight, Clipboard, Columns3, CreditCard, Download, Info, LockKeyhole, Pencil, RefreshCw, RotateCcw, Search, ShieldCheck, ShoppingCart, SlidersHorizontal, Trash2 } from 'lucide-react';
import {
  getGetAdminGiftCardProductsQueryKey, getGetAuthMeQueryKey, getGetGiftCardProductsQueryKey, getGetMyGiftCardOrdersQueryKey, getGetMyDepositsQueryKey,
  useAddAdminGiftCardStock, useCreateAdminGiftCardProduct, useDeleteAdminGiftCardProduct, useBulkPurchaseGiftCards,
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

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const date = (value: string) => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function detectStockContactFields(contactField: string) {
  let remaining = contactField.trim();
  let email: string | null = null;
  let phone: string | null = null;
  const emailMatch = emailPattern.exec(remaining);
  if (emailMatch) {
    email = emailMatch[0];
    remaining = remaining.replace(emailMatch[0], ' ');
  }

  const labelledPhone = /\b(?:phone|mobile|tel|telephone)\s*[:=]\s*(\+?\d[\d\s().-]{7,}\d)/i.exec(remaining);
  if (labelledPhone) {
    phone = labelledPhone[1]?.trim() ?? null;
    remaining = remaining.replace(labelledPhone[0], ' ');
  }
  const phoneCandidates: string[] = remaining.match(/\+?\d[\d\s().-]{7,}\d/g) ?? [];
  const phoneCandidate = phoneCandidates.find((candidate: string) => {
    const digits = candidate.replace(/\D/g, '').length;
    return digits >= 10 && digits <= 15;
  });
  if (!phone && phoneCandidate) phone = phoneCandidate.trim();
  return { email, phone };
}

function detectRedemptionRegionZip(text: string): string | null {
  const zipField = text.split('|')[6]?.trim() ?? '';
  return /^(\d{5}(?:-\d{4})?)$/.exec(zipField)?.[1] ?? /\b(\d{5}(?:-\d{4})?)\b/.exec(zipField)?.[1] ?? null;
}

function parseStockProductMetadata(line: string) {
  const fields = line.split('|').map((field) => field.trim());
  return {
    address: fields[3] ?? '',
    state: fields[4] ?? '',
    city: fields[5] ?? '',
    redemptionRegionZip: detectRedemptionRegionZip(line),
  };
}

const MAX_CARDS_PER_BATCH = 100;

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
    { label: 'City', value: infoProduct.city || 'Not specified', testId: `text-card-info-city-${infoProduct.id}` },
    { label: 'ZIP', value: infoProduct.regionZip || 'Not specified', testId: `text-card-info-region-zip-${infoProduct.id}` },
    { label: 'Brand', value: infoProduct.brand || 'Not specified' },
    { label: 'Type', value: infoProduct.cardType || 'Not specified' },
    { label: 'State', value: infoProduct.state || 'Not specified', testId: `text-card-info-state-${infoProduct.id}` },
    { label: 'Issuer', value: infoProduct.issuer || 'Not specified' },
    { label: 'Address', value: infoProduct.address || 'Not specified', testId: `text-card-info-address-${infoProduct.id}` },
    { label: 'Base', value: infoProduct.name },
    { label: 'Available stock', value: `${infoProduct.availableCount} cards`, testId: `text-card-info-stock-${infoProduct.id}` },
    { label: 'Price', value: money(infoProduct.priceCents), testId: `text-card-info-price-${infoProduct.id}` },
  ] : [];
  const cardInfoFeatures = infoProduct ? [
    { label: 'Email address', available: infoProduct.hasEmail, testId: `text-card-info-email-${infoProduct.id}` },
    {
      label: 'Address details',
      available: Boolean(infoProduct.address || infoProduct.city || infoProduct.state || infoProduct.regionZip),
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
                {visibleColumns.includes('city') && <td data-testid={`text-gift-city-${product.id}`}>{product.city || '—'}</td>}
                {visibleColumns.includes('state') && <td data-testid={`text-gift-state-${product.id}`}>{product.state || '—'}</td>}
                {visibleColumns.includes('regionZip') && <td data-testid={`text-gift-region-zip-${product.id}`}>{product.regionZip || '—'}</td>}
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
  </section>;
}

const stockSchema = z.object({
  productId: z.string().min(1, 'Choose a base'),
  cards: z.string()
    .min(1, 'Paste at least one card')
    .max(100_000, 'Keep the batch under 100 KB')
    .refine(
      (value) => value.split(/\r?\n/).filter((line) => line.trim()).length <= MAX_CARDS_PER_BATCH,
      `Upload no more than ${MAX_CARDS_PER_BATCH} cards at a time.`,
    ),
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
  const updateMetadata = useUpdateAdminGiftCardProductMetadata();
  const [feedback, setFeedback] = useState('');
  const [editingMetadata, setEditingMetadata] = useState<{ productId: string; productName: string } | null>(null);
  const [metadataDraft, setMetadataDraft] = useState({ address: '', state: '', city: '', regionZip: '', cardType: '', issuer: '', brand: '' });
  const form = useForm<BaseForm>({ resolver: zodResolver(baseSchema), defaultValues: { name: '', price: 0 } });
  const stockForm = useForm<StockForm>({ resolver: zodResolver(stockSchema), defaultValues: { productId: '', cards: '' } });
  const stockText = stockForm.watch('cards');
  const stockLines = stockText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const stockLine = stockLines[0] ?? '';
  const stockFields = stockLine.split('|').map((field) => field.trim());
  const stockDetection = detectStockContactFields(stockFields[7] ?? '');
  const stockRedemptionZip = detectRedemptionRegionZip(stockLine);
  const rows = products.data?.products ?? [];
  const selectedStockProduct = rows.find((product) => product.id === stockForm.watch('productId'));
  const totalStock = useMemo(() => rows.reduce((sum, item) => sum + item.availableCount, 0), [rows]);
  useEffect(() => { document.title = 'Bases | ReplenishCC Admin'; }, []);
  useEffect(() => { if (!session.isLoading && (session.isError || !session.data?.authenticated)) setLocation('/login'); else if (!session.isLoading && session.data?.user && !session.data.user.isDepositAdmin) setLocation('/dashboard'); }, [session.isLoading, session.isError, session.data?.authenticated, session.data?.user, setLocation]);
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: getGetAdminGiftCardProductsQueryKey() }); void queryClient.invalidateQueries({ queryKey: getGetGiftCardProductsQueryKey() }); };
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
          setFeedback('Public base metadata updated.');
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
          } }, { onSuccess: () => { form.reset(); invalidate(); setFeedback('Base created. Upload verified cards, one per line, to add stock.'); }, onError: () => setFeedback('Base could not be created. Review the values and try again.') });
        })} className="gift-form">
          <div className="gift-form-pair">
            <FormField control={form.control} name="name" render={({ field }) => <FormItem><FormLabel>Base name</FormLabel><FormControl><Input {...field} placeholder="Vanilla Visa · Standard" data-testid="input-admin-card-name" /></FormControl><FormMessage /></FormItem>} />
            <FormField control={form.control} name="price" render={({ field }) => <FormItem><FormLabel>Price (USD)</FormLabel><FormControl><Input {...field} type="number" min="0.01" max="10000" step="0.01" data-testid="input-admin-card-price" /></FormControl><FormMessage /></FormItem>} />
          </div>
          <button className="gift-admin-submit" disabled={create.isPending} data-testid="button-create-card-listing">{create.isPending ? 'Creating…' : 'Create base'} <ArrowRight /></button>
        </form></Form>
      </section>
      <section className="gift-admin-panel"><div className="gift-admin-panel-title"><span>02</span><div><h3>Upload cards</h3><p>Paste up to {MAX_CARDS_PER_BATCH} cards, one per line: number | expiration | security code | address | state | city | ZIP | optional email/phone. Each base accepts one initial batch; use a new base for a separate upload.</p></div></div>
        <Form {...stockForm}><form onSubmit={stockForm.handleSubmit((values) => {
          const lines = values.cards.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
          if (!lines.length || lines.length > MAX_CARDS_PER_BATCH) { setFeedback(`Upload between 1 and ${MAX_CARDS_PER_BATCH} cards, one card per line.`); return; }
          const metadataByLine = lines.map(parseStockProductMetadata);
          const locationKeys = ['address', 'state', 'city', 'redemptionRegionZip'] as const;
          const hasConflictingLocations = locationKeys.some((key) => {
            const values = new Set<string>();
            metadataByLine.forEach((metadata) => {
              const value = metadata[key]?.trim();
              if (value) values.add(value.toLowerCase());
            });
            return values.size > 1;
          });
          if (hasConflictingLocations) {
            setFeedback('Cards in one base must share the same public address, state, city, and ZIP. Create separate bases for different locations.');
            return;
          }
          const cards: GiftCardCredential[] = lines.map((line) => {
            const fields = line.split('|').map((part) => part.trim());
            const detected = detectStockContactFields(fields[7] ?? '');
            return {
              cardNumber: fields[0] ?? '',
              expiration: fields[1] ?? '',
              securityCode: fields[2] ?? '',
              email: detected.email,
              phone: detected.phone,
            };
          });
          const invalidLineIndex = cards.findIndex((card) => !card.cardNumber || !card.expiration || !card.securityCode);
          if (invalidLineIndex >= 0) { setFeedback(`Line ${invalidLineIndex + 1} must include card number, expiration, and security code separated by |.`); return; }
          const productMetadata = {
            address: metadataByLine.find((metadata) => metadata.address)?.address ?? '',
            state: metadataByLine.find((metadata) => metadata.state)?.state ?? '',
            city: metadataByLine.find((metadata) => metadata.city)?.city ?? '',
            redemptionRegionZip: metadataByLine.find((metadata) => metadata.redemptionRegionZip)?.redemptionRegionZip ?? null,
          };
          addStock.mutate({
            productId: values.productId,
            data: {
              cards,
              ...(productMetadata.address ? { address: productMetadata.address } : {}),
              ...(productMetadata.state ? { state: productMetadata.state } : {}),
              ...(productMetadata.city ? { city: productMetadata.city } : {}),
              ...(productMetadata.redemptionRegionZip ? { redemptionRegionZip: productMetadata.redemptionRegionZip } : {}),
            },
          }, { onSuccess: (result) => { stockForm.reset(); invalidate(); const label = `${result.addedCount} card${result.addedCount === 1 ? '' : 's'}`; setFeedback(`${label} added. ${result.binMetadataApplied ? 'BIN metadata auto-filled.' : 'BIN metadata was not applied; edit the base metadata if needed.'} ${result.locationMetadataApplied ? 'Public address/state/city columns updated.' : 'No address/state/city values supplied; existing columns were kept.'} ${result.redemptionZipApplied ? 'The detected ZIP was saved.' : 'No 5-digit ZIP detected; the existing ZIP was kept.'}`); }, onError: () => setFeedback('Stock upload was rejected. Check each line and try again.') });
        })} className="gift-form">
          <FormField control={stockForm.control} name="productId" render={({ field }) => <FormItem><FormLabel>Base</FormLabel><FormControl><select {...field} data-testid="select-admin-stock-product"><option value="">Select a base</option>{rows.map((product) => <option key={product.id} value={product.id} disabled={!product.canReceiveStock}>{product.name} · {product.canReceiveStock ? 'ready for batch upload' : 'batch already uploaded'}</option>)}</select></FormControl><FormMessage /></FormItem>} />
          <FormField control={stockForm.control} name="cards" render={({ field }) => <FormItem><FormLabel>Cards · one per line ({stockLines.length}/{MAX_CARDS_PER_BATCH})</FormLabel><FormControl><Textarea {...field} rows={8} maxLength={100_000} placeholder="number | expiration | security code | address | state | city | ZIP | email/phone&#10;One card on each line" data-testid="input-admin-card-stock" /></FormControl><div className="gift-stock-detection" aria-live="polite"><span className={stockFields[3] ? 'is-detected' : ''}>{stockFields[3] ? <Check aria-hidden="true" /> : <i aria-hidden="true" />}Address {stockFields[3] ? 'detected' : 'not detected'}</span><span className={stockFields[4] ? 'is-detected' : ''}>{stockFields[4] ? <Check aria-hidden="true" /> : <i aria-hidden="true" />}State {stockFields[4] ? 'detected' : 'not detected'}</span><span className={stockFields[5] ? 'is-detected' : ''}>{stockFields[5] ? <Check aria-hidden="true" /> : <i aria-hidden="true" />}City {stockFields[5] ? 'detected' : 'not detected'}</span><span className={stockRedemptionZip ? 'is-detected' : ''}>{stockRedemptionZip ? <Check aria-hidden="true" /> : <i aria-hidden="true" />}ZIP {stockRedemptionZip ? `detected · ${stockRedemptionZip}` : 'not detected'}</span><span className={stockDetection.email ? 'is-detected' : ''}>{stockDetection.email ? <Check aria-hidden="true" /> : <i aria-hidden="true" />}Email {stockDetection.email ? 'detected' : 'not detected'}</span><span className={stockDetection.phone ? 'is-detected' : ''}>{stockDetection.phone ? <Check aria-hidden="true" /> : <i aria-hidden="true" />}Phone {stockDetection.phone ? 'detected' : 'not detected'}</span></div><FormMessage /></FormItem>} />
          <div className="gift-upload-note"><LockKeyhole /> Public address, state, city, and ZIP are shared by the base; keep these fields consistent on every line. BIN lookup uses the first 8 digits only after the batch is accepted.</div>
          <div className="gift-upload-note"><LockKeyhole /> Card number, expiration, security code, and actual email/phone values are encrypted and revealed only to the purchaser.</div>
          <button className="gift-admin-submit" disabled={addStock.isPending || !rows.some((product) => product.canReceiveStock) || !selectedStockProduct?.canReceiveStock} data-testid="button-upload-card-stock">{addStock.isPending ? 'Uploading…' : `Upload ${stockLines.length || ''} card${stockLines.length === 1 ? '' : 's'}`} <ArrowRight /></button>
        </form></Form>
      </section>
    </div>
      <section className="gift-inventory-panel"><header><div><h3>Bases</h3><p>Price, public metadata, contact-presence indicators, and available quantity only. Actual card details stay private.</p></div><button onClick={() => void products.refetch()} aria-label="Refresh bases" data-testid="button-refresh-card-inventory"><RefreshCw /></button></header>
      {products.isLoading ? <div className="gift-admin-loading" data-testid="loading-admin-card-inventory"><i/><i/><i/></div>
      : products.isError ? <div className="gift-query-error" role="alert" data-testid="error-admin-card-inventory">Inventory unavailable. <button onClick={() => void products.refetch()} data-testid="button-retry-admin-card-inventory">Retry</button></div>
      : rows.length === 0 ? <div className="gift-admin-empty" data-testid="empty-admin-card-inventory">No bases created yet. Create a base above to begin.</div>
        : <div className="gift-table-wrap">
          <table className="gift-table">
            <thead><tr><th>Base</th><th>Address</th><th>State</th><th>City</th><th>ZIP</th><th>Card type</th><th>Issuer</th><th>Brand</th><th>Price</th><th>Email in stock</th><th>Phone in stock</th><th>Available</th><th>Batch status</th><th>Created</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{rows.map((product) => <tr key={product.id} data-testid={`row-card-inventory-${product.id}`}>
              <td><strong>{product.name}</strong></td>
              <td>{product.address || '—'}</td><td>{product.state || '—'}</td><td>{product.city || '—'}</td><td>{product.regionZip || '—'}</td>
              <td>{product.cardType || '—'}</td><td>{product.issuer || '—'}</td><td>{product.brand || '—'}</td>
              <td>{money(product.priceCents)}</td>
              <td><ContactIndicator available={product.hasEmail} label="Email" /></td><td><ContactIndicator available={product.hasPhone} label="Phone" /></td>
              <td><span className="gift-count-chip">{product.availableCount}</span></td><td>{product.canReceiveStock ? 'Ready for first batch' : 'Batch already uploaded'}</td><td>{date(product.createdAt)}</td>
              <td>
                <button className="gift-edit" type="button" onClick={() => { setEditingMetadata({ productId: product.id, productName: product.name }); setMetadataDraft({ address: product.address, state: product.state, city: product.city, regionZip: product.regionZip ?? '', cardType: product.cardType, issuer: product.issuer, brand: product.brand }); }} data-testid={`button-edit-card-metadata-${product.id}`}><Pencil /> Edit metadata</button>{' '}
                <button className="gift-delete" disabled={!product.canReceiveStock || remove.isPending} title={!product.canReceiveStock ? 'Bases with inventory or order history cannot be deleted' : 'Delete this empty base'} onClick={() => { if (window.confirm(`Delete base “${product.name}”? It must have no inventory or order history.`)) remove.mutate({ productId: product.id }, { onSuccess: () => { invalidate(); setFeedback('Empty base deleted.'); }, onError: () => setFeedback('Base could not be deleted. It has remaining stock or order history.') }); }} data-testid={`button-delete-card-listing-${product.id}`}><Trash2 /> Delete</button>
              </td>
            </tr>)}</tbody>
          </table>
        </div>}
    </section>
      <Dialog open={!!editingMetadata} onOpenChange={(open) => { if (!open && !updateMetadata.isPending) setEditingMetadata(null); }}>
        <DialogContent className="gift-info-dialog">
          <DialogHeader className="gift-info-dialog-head">
            <div><DialogTitle>Edit base metadata</DialogTitle><DialogDescription>{editingMetadata?.productName} · Address, state, city, and ZIP are public to catalog members.</DialogDescription></div>
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
            <p className="gift-zip-note">Address, state, city, and ZIP appear as public catalog columns. Card number, expiration, security code, email, and phone stay private.</p>
            <button type="submit" className="gift-admin-submit" disabled={updateMetadata.isPending} data-testid="button-save-card-metadata">{updateMetadata.isPending ? 'Saving…' : 'Save metadata'} <Check /></button>
          </form>
        </DialogContent>
      </Dialog>
  </section>;
}