import { useState } from "react";
import { Check, CheckCircle2, LockKeyhole } from "lucide-react";
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

function FeatureRow({
  label,
  available,
}: {
  label: string;
  available: boolean;
}) {
  return (
    <li className="card-detail-feature">
      <span>{label}</span>
      <span className={available ? "card-detail-status is-available" : "card-detail-status"}>
        <CheckCircle2 aria-hidden="true" />
        {available ? "Available" : "Not included"}
      </span>
    </li>
  );
}

export function CardInfoReferenceMatch() {
  const [open, setOpen] = useState(true);
  const locationAvailable = Boolean(
    listing.address || listing.city || listing.state || listing.regionZip,
  );
  const facts = [
    { label: "City", value: listing.city },
    { label: "ZIP", value: listing.regionZip },
    { label: "Brand", value: listing.brand },
    { label: "Type", value: listing.cardType },
    { label: "State", value: listing.state },
    { label: "Issuer", value: listing.issuer },
    { label: "Address", value: listing.address },
    { label: "Base", value: listing.name },
    { label: "Face value", value: money(listing.faceValueCents) },
    { label: "Available stock", value: `${listing.availableCount} cards` },
    { label: "Price", value: money(listing.priceCents) },
  ];

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
            className="card-detail-dialog"
          >
            <DialogHeader className="card-detail-heading">
              <span className="card-detail-eyebrow">CARD DETAILS</span>
              <DialogTitle>{listing.name}</DialogTitle>
              <DialogDescription>
                {listing.description}
              </DialogDescription>
            </DialogHeader>
            <dl className="card-detail-facts">
              {facts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value || "Not specified"}</dd>
                </div>
              ))}
            </dl>
            <section className="card-detail-features" aria-labelledby="card-detail-features-heading">
              <h3 id="card-detail-features-heading">Available Features</h3>
              <ul>
                <FeatureRow label="Email address" available={listing.hasEmail} />
                <FeatureRow label="Address details" available={locationAvailable} />
                <FeatureRow label="Phone number" available={listing.hasPhone} />
              </ul>
            </section>
            <p className="card-detail-purchase-summary">
              <Check aria-hidden="true" />
              One card per order · paid from account balance · details delivered to private order history.
            </p>
            <p className="card-detail-private-note">
              <LockKeyhole aria-hidden="true" />
              Full card credentials are only available to the purchaser after checkout.
            </p>
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