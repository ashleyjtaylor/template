-- CreateTable
CREATE TABLE "audit_log" (
    "entity_id" TEXT NOT NULL,
    "request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "actor_impersonator_id" TEXT,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "details" JSONB NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("entity_id")
);

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_created_at_idx" ON "audit_log"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_resource_type_resource_id_created_at_idx" ON "audit_log"("resource_type", "resource_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_action_created_at_idx" ON "audit_log"("action", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_request_id_idx" ON "audit_log"("request_id");
