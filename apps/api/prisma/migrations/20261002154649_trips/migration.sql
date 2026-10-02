-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('REQUESTED', 'SEARCHING', 'NO_DRIVERS', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CancelledBy" AS ENUM ('PASSENGER', 'DRIVER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'FAKE_CARD');

-- CreateEnum
CREATE TYPE "TripEventActor" AS ENUM ('PASSENGER', 'DRIVER', 'SYSTEM', 'ADMIN');

-- CreateTable
CREATE TABLE "service_areas" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "area" geography(MultiPolygon, 4326) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "service_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fare_rules" (
    "id" UUID NOT NULL,
    "category" "VehicleCategory" NOT NULL,
    "base_cents" INTEGER NOT NULL,
    "per_km_cents" INTEGER NOT NULL,
    "per_min_cents" INTEGER NOT NULL,
    "min_fare_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'COP',
    "valid_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fare_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fare_quotes" (
    "id" UUID NOT NULL,
    "passenger_id" UUID NOT NULL,
    "fare_rule_id" UUID NOT NULL,
    "category" "VehicleCategory" NOT NULL,
    "origin_lat" DOUBLE PRECISION NOT NULL,
    "origin_lng" DOUBLE PRECISION NOT NULL,
    "destination_lat" DOUBLE PRECISION NOT NULL,
    "destination_lng" DOUBLE PRECISION NOT NULL,
    "origin_address" TEXT,
    "destination_address" TEXT,
    "destination_place_id" TEXT,
    "distance_m" INTEGER NOT NULL,
    "duration_s" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "polyline" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fare_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" UUID NOT NULL,
    "passenger_id" UUID NOT NULL,
    "driver_id" UUID,
    "vehicle_id" UUID,
    "quote_id" UUID NOT NULL,
    "category" "VehicleCategory" NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'REQUESTED',
    "payment_method" "PaymentMethod" NOT NULL,
    "origin_lat" DOUBLE PRECISION NOT NULL,
    "origin_lng" DOUBLE PRECISION NOT NULL,
    "destination_lat" DOUBLE PRECISION NOT NULL,
    "destination_lng" DOUBLE PRECISION NOT NULL,
    "origin" geography(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint("origin_lng", "origin_lat"), 4326)::geography) STORED,
    "destination" geography(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint("destination_lng", "destination_lat"), 4326)::geography) STORED,
    "origin_address" TEXT,
    "destination_address" TEXT,
    "destination_place_id" TEXT,
    "distance_m" INTEGER NOT NULL,
    "duration_s" INTEGER NOT NULL,
    "polyline" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "final_amount_cents" INTEGER,
    "pin" TEXT NOT NULL,
    "offers_declined" INTEGER NOT NULL DEFAULT 0,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMPTZ(3),
    "arrived_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by" "CancelledBy",
    "cancel_reason" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_events" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "from_status" "TripStatus",
    "to_status" "TripStatus" NOT NULL,
    "actor" "TripEventActor" NOT NULL,
    "actor_id" UUID,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta" JSONB,

    CONSTRAINT "trip_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_areas_name_key" ON "service_areas"("name");

-- CreateIndex
CREATE INDEX "service_areas_area_idx" ON "service_areas" USING GIST ("area");

-- CreateIndex
CREATE INDEX "fare_rules_category_valid_from_idx" ON "fare_rules"("category", "valid_from");

-- CreateIndex
CREATE INDEX "fare_quotes_passenger_id_created_at_idx" ON "fare_quotes"("passenger_id", "created_at");

-- CreateIndex
CREATE INDEX "fare_quotes_expires_at_idx" ON "fare_quotes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "trips_quote_id_key" ON "trips"("quote_id");

-- CreateIndex
CREATE INDEX "trips_passenger_id_requested_at_idx" ON "trips"("passenger_id", "requested_at" DESC);

-- CreateIndex
CREATE INDEX "trips_driver_id_requested_at_idx" ON "trips"("driver_id", "requested_at" DESC);

-- CreateIndex
CREATE INDEX "trips_status_idx" ON "trips"("status");

-- CreateIndex
CREATE INDEX "trips_requested_at_idx" ON "trips"("requested_at");

-- CreateIndex
CREATE INDEX "trips_origin_idx" ON "trips" USING GIST ("origin");

-- CreateIndex
CREATE INDEX "trips_destination_idx" ON "trips" USING GIST ("destination");

-- CreateIndex
CREATE INDEX "trip_events_trip_id_at_idx" ON "trip_events"("trip_id", "at");

-- AddForeignKey
ALTER TABLE "fare_quotes" ADD CONSTRAINT "fare_quotes_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fare_quotes" ADD CONSTRAINT "fare_quotes_fare_rule_id_fkey" FOREIGN KEY ("fare_rule_id") REFERENCES "fare_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "driver_profiles"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "fare_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_events" ADD CONSTRAINT "trip_events_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------
-- A mano (Prisma no expresa índices parciales ni CHECK).
-- ---------------------------------------------------------------------------------------

-- Un solo viaje activo por pasajero (8.8, paso 3) y por conductor: la BD gana cualquier carrera.
CREATE UNIQUE INDEX "trips_one_active_per_passenger" ON "trips"("passenger_id")
  WHERE "status" IN ('REQUESTED', 'SEARCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS');
CREATE UNIQUE INDEX "trips_one_active_per_driver" ON "trips"("driver_id")
  WHERE "status" IN ('DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS');

ALTER TABLE "trips" ADD CONSTRAINT "trips_pin_check" CHECK ("pin" ~ '^[0-9]{4}$');
ALTER TABLE "trips" ADD CONSTRAINT "trips_amounts_check"
  CHECK ("amount_cents" >= 0 AND ("final_amount_cents" IS NULL OR "final_amount_cents" >= 0));
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_check"
  CHECK ("status" IN ('REQUESTED', 'SEARCHING', 'NO_DRIVERS', 'CANCELLED') OR "driver_id" IS NOT NULL);
ALTER TABLE "fare_quotes" ADD CONSTRAINT "fare_quotes_amount_check"
  CHECK ("amount_cents" >= 0 AND "distance_m" >= 0 AND "duration_s" >= 0);
ALTER TABLE "fare_rules" ADD CONSTRAINT "fare_rules_amounts_check"
  CHECK ("base_cents" >= 0 AND "per_km_cents" >= 0 AND "per_min_cents" >= 0 AND "min_fare_cents" >= 0);

-- Zona de servicio de la demo: infra/geo/service-area.geojson (rectángulo aproximado, 7.4).
INSERT INTO "service_areas" ("name", "area") VALUES (
  'Girardot + Ricaurte + Flandes',
  ST_Multi(ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[[[-74.88,4.22],[-74.7,4.22],[-74.7,4.36],[-74.88,4.36],[-74.88,4.22]]]}'))::geography
);

-- Tarifas iniciales en centavos de COP (las mismas que DEMO_FARE_RULES de contracts).
INSERT INTO "fare_rules" ("id", "category", "base_cents", "per_km_cents", "per_min_cents", "min_fare_cents", "currency", "valid_from") VALUES
  (gen_random_uuid(), 'STANDARD', 300000, 120000, 20000, 600000, 'COP', '2026-01-01T00:00:00Z'),
  (gen_random_uuid(), 'MOTO', 200000, 80000, 10000, 400000, 'COP', '2026-01-01T00:00:00Z');
