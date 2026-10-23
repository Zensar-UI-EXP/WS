import { MongoClient } from "mongodb";
import {
  filterSchema,
  holdingSchema,
  type Holding,
  type Portfolio,
  type PortfolioFilter,
} from "./contracts";
import { sampleHoldings } from "./sample-data";

const globalMongo = globalThis as typeof globalThis & {
  mongoPromise?: Promise<MongoClient>;
};

export async function database() {
  if (!process.env.MONGODB_URI) throw new Error("MongoDB is not configured.");
  if (!globalMongo.mongoPromise) {
    const client = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    globalMongo.mongoPromise = client.connect().catch((error: unknown) => {
      globalMongo.mongoPromise = undefined;
      throw error;
    });
  }
  return (await globalMongo.mongoPromise).db(
    process.env.MONGODB_DB || "folio_poc",
  );
}

export function summarize(
  holdings: Holding[],
  filter: PortfolioFilter,
  source: Portfolio["source"],
): Portfolio {
  const selected = holdings.filter(
    (holding) =>
      (!filter.assetClass || holding.assetClass === filter.assetClass) &&
      (!filter.region || holding.region === filter.region),
  );
  const total = selected.reduce((sum, holding) => sum + holding.value, 0);
  const cost = selected.reduce((sum, holding) => sum + holding.cost, 0);
  return {
    holdings: selected,
    total,
    cost,
    gain: total - cost,
    gainPercent: cost ? ((total - cost) / cost) * 100 : 0,
    asOf: selected.length
      ? selected.map((holding) => holding.asOf).sort()[0]
      : null,
    source,
    filter,
  };
}

export async function getPortfolio(input: unknown): Promise<Portfolio> {
  const filter = filterSchema.parse(input);
  if (!process.env.MONGODB_URI)
    return summarize(sampleHoldings, filter, "demo");
  const query: Record<string, string> = {};
  if (filter.assetClass) query.assetClass = filter.assetClass;
  if (filter.region) query.region = filter.region;
  const documents = await (
    await database()
  )
    .collection("holdings")
    .find(query, { projection: { _id: 0 } })
    .limit(201)
    .toArray();
  if (documents.length > 200)
    throw new Error(
      "This POC supports up to 200 matching holdings. Narrow your filters.",
    );
  return summarize(
    documents.map((document) => holdingSchema.parse(document)),
    filter,
    "mongodb",
  );
}
