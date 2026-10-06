-- Day list: one Tenant's pickups in instant order. The query is a half-open range on pickup_at.
CREATE INDEX "transfers_tenant_pickup_at" ON "app"."transfers" USING btree ("tenant_id","pickup_at");