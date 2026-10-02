-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "VehicleCategory" AS ENUM ('STANDARD', 'MOTO');

-- CreateEnum
CREATE TYPE "DriverDocumentType" AS ENUM ('DRIVER_LICENSE', 'VEHICLE_REGISTRATION', 'SOAT');

-- CreateEnum
CREATE TYPE "DriverDocumentStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "driver_profiles" (
    "user_id" UUID NOT NULL,
    "status" "DriverStatus" NOT NULL DEFAULT 'PENDING',
    "license_number_enc" TEXT NOT NULL,
    "license_last4" TEXT NOT NULL,
    "submitted_at" TIMESTAMPTZ(3),
    "status_reason" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "approved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "driver_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "plate" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "category" "VehicleCategory" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_documents" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "type" "DriverDocumentType" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "status" "DriverDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "driver_profiles_status_submitted_at_idx" ON "driver_profiles"("status", "submitted_at");

-- CreateIndex
CREATE INDEX "vehicles_plate_idx" ON "vehicles"("plate");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_driver_id_plate_key" ON "vehicles"("driver_id", "plate");

-- CreateIndex
CREATE UNIQUE INDEX "driver_documents_storage_key_key" ON "driver_documents"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "driver_documents_driver_id_type_key" ON "driver_documents"("driver_id", "type");

-- AddForeignKey
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "driver_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "driver_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Un solo vehículo activo por conductor (Prisma no expresa índices parciales).
CREATE UNIQUE INDEX "vehicles_one_active_per_driver" ON "vehicles"("driver_id") WHERE "active";
