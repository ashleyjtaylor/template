-- CreateTable
CREATE TABLE "outbox" (
    "entity_id" TEXT NOT NULL,
    "request_id" TEXT,
    "topic" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "target_queue" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("entity_id")
);

-- CreateIndex
CREATE INDEX "outbox_processed_at_created_at_idx" ON "outbox"("processed_at", "created_at");

-- CreateIndex
CREATE INDEX "outbox_request_id_idx" ON "outbox"("request_id");
