-- Add streaming metrics to usage_metrics
ALTER TABLE "usage_metrics" ADD COLUMN "firstTokenLatencyMs" INTEGER;
ALTER TABLE "usage_metrics" ADD COLUMN "responseTimeMs" INTEGER;
ALTER TABLE "usage_metrics" ADD COLUMN "tokensPerSecond" REAL;
