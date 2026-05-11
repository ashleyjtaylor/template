-- CreateTable
CREATE TABLE "organisation" (
    "entity_id" TEXT NOT NULL,
    "request_id" TEXT,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organisation_pkey" PRIMARY KEY ("entity_id")
);

-- CreateTable
CREATE TABLE "membership" (
    "entity_id" TEXT NOT NULL,
    "request_id" TEXT,
    "organisation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_pkey" PRIMARY KEY ("entity_id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "entity_id" TEXT NOT NULL,
    "request_id" TEXT,
    "organisation_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by_user_id" TEXT NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "accepted_by_user_id" TEXT,
    "revoked_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("entity_id")
);

-- CreateIndex
CREATE INDEX "organisation_request_id_idx" ON "organisation"("request_id");

-- CreateIndex
CREATE INDEX "membership_user_id_idx" ON "membership"("user_id");

-- CreateIndex
CREATE INDEX "membership_organisation_id_role_idx" ON "membership"("organisation_id", "role");

-- CreateIndex
CREATE INDEX "membership_request_id_idx" ON "membership"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "membership_organisation_id_user_id_key" ON "membership"("organisation_id", "user_id");

-- CreateIndex
CREATE INDEX "invitation_token_hash_idx" ON "invitation"("token_hash");

-- CreateIndex
CREATE INDEX "invitation_email_idx" ON "invitation"("email");

-- CreateIndex
CREATE INDEX "invitation_request_id_idx" ON "invitation"("request_id");

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisation"("entity_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisation"("entity_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_accepted_by_user_id_fkey" FOREIGN KEY ("accepted_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex (partial uniqueness — Prisma's schema can't express this).
-- At most one outstanding invite per (organisation, email); accepted or
-- revoked rows do not collide with new invites.
CREATE UNIQUE INDEX "invitation_organisation_id_email_pending_key"
  ON "invitation" ("organisation_id", "email")
  WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;
