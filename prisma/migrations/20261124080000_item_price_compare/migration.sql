-- Additive only: optional price comparison fields (UVP + cheapest offer)
ALTER TABLE "items" ADD COLUMN "rrpValue" INTEGER;
ALTER TABLE "items" ADD COLUMN "rrpCurrency" TEXT;
ALTER TABLE "items" ADD COLUMN "bestPriceValue" INTEGER;
ALTER TABLE "items" ADD COLUMN "bestPriceCurrency" TEXT;
ALTER TABLE "items" ADD COLUMN "bestPriceShop" TEXT;
ALTER TABLE "items" ADD COLUMN "bestPriceUrl" TEXT;
ALTER TABLE "items" ADD COLUMN "bestPriceCheckedAt" DATETIME;
ALTER TABLE "items" ADD COLUMN "bestPriceRefValue" INTEGER;
ALTER TABLE "items" ADD COLUMN "bestPriceRefWindow" TEXT;

-- CreateTable
CREATE TABLE "item_best_price_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" INTEGER NOT NULL,
    "value" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "shop" TEXT,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "item_best_price_history_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "item_best_price_history_itemId_checkedAt_idx" ON "item_best_price_history"("itemId", "checkedAt");
