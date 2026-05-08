-- CreateTable
CREATE TABLE "_meta" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "_meta_pkey" PRIMARY KEY ("id")
);
