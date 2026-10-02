-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "rating_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rating_sum" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status_reason" TEXT;

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "provider" "PaymentMethod" NOT NULL,
    "provider_ref" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "captured_at" TIMESTAMPTZ(3),
    "confirmed_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ratings" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "from_user" UUID NOT NULL,
    "to_user" UUID NOT NULL,
    "score" SMALLINT NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_trip_id_key" ON "payments"("trip_id");

-- CreateIndex
CREATE INDEX "payments_status_created_at_idx" ON "payments"("status", "created_at");

-- CreateIndex
CREATE INDEX "ratings_to_user_created_at_idx" ON "ratings"("to_user", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ratings_trip_id_from_user_key" ON "ratings"("trip_id", "from_user");

-- CreateIndex
CREATE UNIQUE INDEX "push_tokens_token_key" ON "push_tokens"("token");

-- CreateIndex
CREATE INDEX "push_tokens_user_id_idx" ON "push_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reglas que Prisma no expresa (8.12): calificación de 1 a 5, comentario de 500 como máximo,
-- nadie se califica a sí mismo; importes y votos nunca negativos.
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_score_check" CHECK ("score" BETWEEN 1 AND 5);
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_comment_check" CHECK (char_length("comment") <= 500);
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_not_self_check" CHECK ("from_user" <> "to_user");
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check" CHECK ("amount_cents" >= 0);
ALTER TABLE "users" ADD CONSTRAINT "users_rating_check" CHECK ("rating_sum" >= 0 AND "rating_count" >= 0);

-- Ganancias del conductor (10.4): sus viajes completados por fecha de finalización.
CREATE INDEX "trips_driver_completed_idx" ON "trips"("driver_id", "completed_at") WHERE "status" = 'COMPLETED';
