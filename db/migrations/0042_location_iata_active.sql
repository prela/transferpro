-- One active Location per Tenant may hold a given IATA code.
-- An archived row keeps its code and does not block a later active Location.
-- Existing rows are not rewritten. A null code stays null.
CREATE UNIQUE INDEX "locations_iata_active" ON "app"."locations" USING btree ("tenant_id","iata") WHERE "app"."locations"."archived_at" is null and "app"."locations"."iata" is not null;