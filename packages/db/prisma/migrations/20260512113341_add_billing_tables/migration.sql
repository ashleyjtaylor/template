-- Stripe billing foundation: subscription mirror + idempotency anchor +
-- the per-org customer link.
--
-- Subscription is one-row-per-org (UPSERTed by webhook). StripeEvent
-- short-circuits replays.

ALTER TABLE "organisation" ADD COLUMN "stripe_customer_id" TEXT;

CREATE UNIQUE INDEX "organisation_stripe_customer_id_key" ON "organisation"("stripe_customer_id");

CREATE TABLE "subscription" (
  "entity_id" TEXT NOT NULL,
  "organisation_id" TEXT NOT NULL,
  "stripe_subscription_id" TEXT NOT NULL,
  "stripe_customer_id" TEXT NOT NULL,
  "stripe_price_id" TEXT NOT NULL,
  "plan_key" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "current_period_start" TIMESTAMP(3) NOT NULL,
  "current_period_end" TIMESTAMP(3) NOT NULL,
  "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
  "canceled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "request_id" TEXT,
  CONSTRAINT "subscription_pkey" PRIMARY KEY ("entity_id")
);

CREATE UNIQUE INDEX "subscription_organisation_id_key" ON "subscription"("organisation_id");
CREATE UNIQUE INDEX "subscription_stripe_subscription_id_key" ON "subscription"("stripe_subscription_id");
CREATE INDEX "subscription_stripe_customer_id_idx" ON "subscription"("stripe_customer_id");
CREATE INDEX "subscription_status_idx" ON "subscription"("status");

ALTER TABLE "subscription"
  ADD CONSTRAINT "subscription_organisation_id_fkey"
  FOREIGN KEY ("organisation_id") REFERENCES "organisation"("entity_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "stripe_event" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stripe_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stripe_event_type_processed_at_idx" ON "stripe_event"("type", "processed_at" DESC);
