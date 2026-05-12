-- CreateTable
CREATE TABLE "sent_emails" (
    "entity_id" TEXT NOT NULL,
    "request_id" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT,
    "status" TEXT NOT NULL,
    "last_error" TEXT,
    "message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "sent_emails_pkey" PRIMARY KEY ("entity_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sent_emails_dedupe_key_key" ON "sent_emails"("dedupe_key");

-- CreateIndex
CREATE INDEX "sent_emails_created_at_idx" ON "sent_emails"("created_at" DESC);

-- CreateIndex
CREATE INDEX "sent_emails_recipient_created_at_idx" ON "sent_emails"("recipient", "created_at" DESC);

-- CreateIndex
CREATE INDEX "sent_emails_request_id_idx" ON "sent_emails"("request_id");
