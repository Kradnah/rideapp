-- CreateTable
CREATE TABLE "trip_route_points" (
    "id" BIGSERIAL NOT NULL,
    "trip_id" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "point" geography(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint("lng", "lat"), 4326)::geography) STORED,

    CONSTRAINT "trip_route_points_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trip_route_points_trip_id_at_idx" ON "trip_route_points"("trip_id", "at");

-- AddForeignKey
ALTER TABLE "trip_route_points" ADD CONSTRAINT "trip_route_points_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
