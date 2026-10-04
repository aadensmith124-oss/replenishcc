import { useState } from "react";
import {
  Check,
  ChevronDown,
  Columns3,
  Info,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  X,
} from "lucide-react";
import "./_group.css";

type ColumnId = "description" | "faceValue" | "availability" | "price";

const catalogColumns: { id: ColumnId; label: string }[] = [
  { id: "description", label: "Description" },
  { id: "faceValue", label: "Face value" },
  { id: "availability", label: "Available stock" },
  { id: "price", label: "Member price" },
];

// This is the current development catalog row; card credentials are never preview data.
const listing = {
  name: "Us good",
  description: "Us good 1-88",
  faceValue: "$1.88",
  price: "$1.88",
  availableCount: 0,
};

export function BuyCardsPreview() {
  const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>([
    "description",
    "faceValue",
    "availability",
    "price",
  ]);
  const [selectedBase, setSelectedBase] = useState("all");
  const [infoOpen, setInfoOpen] = useState(false);

  const toggleColumn = (columnId: ColumnId) => {
    setVisibleColumns((current) =>
      current.includes(columnId)
        ? current.filter((column) => column !== columnId)
        : [...current, columnId],
    );
  };

  return (
    <main className="replenish-preview">
      <section className="rc-catalog">
        <header className="rc-catalog-head">
          <div>
            <div className="rc-eyebrow">
              <span className="rc-eyebrow-dot" />
              Authorized inventory
            </div>
            <h1>Cards</h1>
            <p>Browse gift-card listings and buy one card at a time.</p>
          </div>
          <a className="rc-order-link" href="#orders">
            My card orders
            <ChevronDown aria-hidden="true" />
          </a>
        </header>

        <section aria-label="Bases" className="rc-bases">
          <div className="rc-base-heading">
            <strong>Bases</strong>
            <span>Choose a listing</span>
          </div>
          <div className="rc-base-options">
            <button
              aria-pressed={selectedBase === "all"}
              className={selectedBase === "all" ? "is-active" : ""}
              onClick={() => setSelectedBase("all")}
              type="button"
            >
              All bases <span>1</span>
            </button>
            <button
              aria-pressed={selectedBase === "us-good"}
              className={selectedBase === "us-good" ? "is-active" : ""}
              onClick={() => setSelectedBase("us-good")}
              type="button"
            >
              Us good <span>0</span>
            </button>
          </div>
        </section>

        <div className="rc-catalog-controls">
          <div className="rc-column-control">
            <span className="rc-control-label">Column Visibility</span>
            <details className="rc-column-details">
              <summary className="rc-control-trigger">
                <Columns3 aria-hidden="true" />
                Columns
                <ChevronDown aria-hidden="true" />
              </summary>
              <div className="rc-popover">
                <p>Base and actions stay visible.</p>
                {catalogColumns.map((column) => (
                  <label className="rc-column-option" key={column.id}>
                    <input
                      checked={visibleColumns.includes(column.id)}
                      onChange={() => toggleColumn(column.id)}
                      type="checkbox"
                    />
                    {column.label}
                  </label>
                ))}
              </div>
            </details>
          </div>

          <details className="rc-filter-details">
            <summary className="rc-control-trigger">
              <SlidersHorizontal aria-hidden="true" />
              Filters
              <ChevronDown aria-hidden="true" />
            </summary>
            <div className="rc-popover rc-filter-popover">
              <label>
                Search
                <span>
                  <Search aria-hidden="true" />
                  <input placeholder="Search listings" type="search" />
                </span>
              </label>
              <label>
                Stock
                <select defaultValue="all">
                  <option value="all">All listings</option>
                  <option value="out">Out of stock</option>
                </select>
              </label>
            </div>
          </details>
        </div>

        <div className="rc-table-scroll" role="region" aria-label="Card listings" tabIndex={0}>
          <table className="rc-table">
            <thead>
              <tr>
                <th scope="col">Base</th>
                {visibleColumns.map((columnId) => (
                  <th key={columnId} scope="col">
                    {catalogColumns.find((column) => column.id === columnId)?.label}
                  </th>
                ))}
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <div className="rc-base-cell">
                    <strong>{listing.name}</strong>
                  </div>
                </td>
                {visibleColumns.includes("description") && <td>{listing.description}</td>}
                {visibleColumns.includes("faceValue") && (
                  <td className="rc-face">{listing.faceValue}</td>
                )}
                {visibleColumns.includes("availability") && (
                  <td className="rc-stock">Out of stock</td>
                )}
                {visibleColumns.includes("price") && (
                  <td className="rc-price">{listing.price}</td>
                )}
                <td>
                  <div className="rc-actions">
                    <button className="rc-action" onClick={() => setInfoOpen(true)} type="button">
                      <Info aria-hidden="true" />
                      Info
                    </button>
                    <button className="rc-action rc-action-primary" disabled type="button">
                      <ShoppingCart aria-hidden="true" />
                      Buy 1
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="rc-scroll-note">Swipe to browse columns. Info and Buy 1 stay visible.</p>
      </section>

      {infoOpen && (
        <div
          className="rc-info-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) setInfoOpen(false);
          }}
          role="presentation"
        >
          <section aria-labelledby="rc-info-title" aria-modal="true" className="rc-info-dialog" role="dialog">
            <button
              aria-label="Close listing details"
              className="rc-info-close"
              onClick={() => setInfoOpen(false)}
              type="button"
            >
              <X aria-hidden="true" />
            </button>
            <h2 id="rc-info-title">{listing.name}</h2>
            <p>Authorized gift-card listing details</p>
            <dl className="rc-info-facts">
              <div>
                <dt>Base</dt>
                <dd>{listing.name}</dd>
              </div>
              <div>
                <dt>Description</dt>
                <dd>{listing.description}</dd>
              </div>
              <div>
                <dt>Face value</dt>
                <dd>{listing.faceValue}</dd>
              </div>
              <div>
                <dt>Member price</dt>
                <dd>{listing.price}</dd>
              </div>
              <div>
                <dt>Available stock</dt>
                <dd>{listing.availableCount} cards</dd>
              </div>
            </dl>
            <h3>Purchase details</h3>
            <ul className="rc-info-features">
              <li>
                <Check aria-hidden="true" /> One card per order
              </li>
              <li>
                <Check aria-hidden="true" /> Checkout uses account balance
              </li>
              <li>
                <Check aria-hidden="true" /> Card details appear in your private order history
              </li>
            </ul>
          </section>
        </div>
      )}
    </main>
  );
}