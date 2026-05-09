-- AlterTable
ALTER TABLE "account" ADD COLUMN     "requestId" TEXT;

-- AlterTable
ALTER TABLE "session" ADD COLUMN     "requestId" TEXT;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "requestId" TEXT;

-- AlterTable
ALTER TABLE "verification" ADD COLUMN     "requestId" TEXT;

-- CreateIndex
CREATE INDEX "account_requestId_idx" ON "account"("requestId");

-- CreateIndex
CREATE INDEX "session_requestId_idx" ON "session"("requestId");

-- CreateIndex
CREATE INDEX "user_requestId_idx" ON "user"("requestId");

-- CreateIndex
CREATE INDEX "verification_requestId_idx" ON "verification"("requestId");
