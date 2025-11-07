-- Add capability metadata columns for connections and model catalog
ALTER TABLE "connections"
ADD COLUMN "defaultCapabilitiesJson" TEXT NOT NULL DEFAULT '{}';

ALTER TABLE "model_catalog"
ADD COLUMN "capabilitiesJson" TEXT NOT NULL DEFAULT '{}';
