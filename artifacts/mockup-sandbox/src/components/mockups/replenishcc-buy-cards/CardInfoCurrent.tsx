import { useState } from "react";
import { Check, LockKeyhole } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import "./_group.css";
import "./card-info-dialog.css";

const listing = {
  id: "sample-listing",
  name: "US-GOOD",
  description: "Authorized Visa prepaid gift-card listing.",
  address: "48 Cedar Avenue",
  state: "AZ",
  city: "Phoenix",
  regionZip: "85001",
  cardType: "PREPAID",
  issuer: "Example National Bank",
  brand: "VISA",
  faceValueCents: 10000,
  priceCents: 125,
  availableCount: 8,
  hasEmail: true,
  hasPhone: true,
};

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);

function ContactIndicator({
  available,
  label,
}: {
  available: boolean;
  label: string;
}) {
  return (
    <span
      className="gift-contact-indicator"
      aria-label={`${label}: ${available ? "included" : "not included"}`}
    >
      {available ? <Check aria-hidden="true" /> : <span aria-hidden="true">—</span>}
      <span>{available ? "Included" : "Not included"}</span>
    </span>
  );
}

export function CardInfoCurrent() {
  const [open, setOpen] = useState(true);

  return (
    <main className="card-info-demo">
      <div className="card-info-context" aria-hidden="true">
        <div className="card-info-context-head">
          <span>AUTHORIZED INVENTORY</span>
          <strong>Cards</strong>
        </div>
        <div className="card-info-context-row">
          <span>US-GOOD</span>
          <span>Prepaid</span>
          <span>$1.25</span>
        </div>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        {open && (
          <DialogContent
            className="gift-info-dialog"
          >
            <DialogHeader className="gift-info-dialog-head">
              <div>
                <DialogTitle>{listing.name}</DialogTitle>
                <DialogDescription>Authorized gift-card listing</DialogDescription>
              </div>
            </DialogHeader>
            <p
              className="gift-info-description"
            >
              {listing.description}
            </p>
            <dl className="gift-info-facts">
              <div><dt>Base</dt><dd>{listing.name}</dd></div>
              <div><dt>Address</dt><dd>{listing.address}</dd></div>
              <div><dt>State</dt><dd>{listing.state}</dd></div>
              <div><dt>City</dt><dd>{listing.city}</dd></div>
              <div><dt>ZIP</dt><dd>{listing.regionZip}</dd></div>
              <div><dt>Card type</dt><dd>{listing.cardType}</dd></div>
              <div><dt>Issuer</dt><dd>{listing.issuer}</dd></div>
              <div><dt>Brand</dt><dd>{listing.brand}</dd></div>
              <div><dt>Face value</dt><dd>{money(listing.faceValueCents)}</dd></div>
              <div>
                <dt>Email in stock</dt>
                <dd><ContactIndicator available={listing.hasEmail} label="Email" /></dd>
              </div>
              <div>
                <dt>Phone in stock</dt>
                <dd><ContactIndicator available={listing.hasPhone} label="Phone" /></dd>
              </div>
              <div><dt>Available stock</dt><dd>{listing.availableCount} cards</dd></div>
            </dl>
            <section className="gift-info-features">
              <h3>Purchase details</h3>
              <ul>
                <li><Check aria-hidden="true" /> One card per order</li>
                <li><Check aria-hidden="true" /> Checkout uses account balance</li>
                <li><Check aria-hidden="true" /> Card details appear in your private order history</li>
              </ul>
              <p className="gift-info-private-note">
                <LockKeyhole aria-hidden="true" />
                Full card credentials are only available to the purchaser after checkout.
              </p>
            </section>
          </DialogContent>
        )}
      </Dialog>
      {!open && (
        <button className="card-info-reopen" onClick={() => setOpen(true)} type="button">
          Reopen card details
        </button>
      )}
    </main>
  );
}