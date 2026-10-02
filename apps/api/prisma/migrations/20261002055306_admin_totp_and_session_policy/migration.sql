-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "absolute_expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "amr" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "idle_seconds" INTEGER;

-- CreateTable
CREATE TABLE "admin_totp" (
    "user_id" UUID NOT NULL,
    "secret_enc" TEXT NOT NULL,
    "last_used_step" BIGINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_totp_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "admin_totp" ADD CONSTRAINT "admin_totp_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
