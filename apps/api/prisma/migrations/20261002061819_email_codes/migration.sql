-- CreateEnum
CREATE TYPE "EmailCodePurpose" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

-- CreateTable
CREATE TABLE "email_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "EmailCodePurpose" NOT NULL,
    "code_hmac" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_codes_user_id_purpose_created_at_idx" ON "email_codes"("user_id", "purpose", "created_at");

-- AddForeignKey
ALTER TABLE "email_codes" ADD CONSTRAINT "email_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
