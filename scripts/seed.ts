import { MongoClient } from "mongodb";
import { sampleHoldings } from "../lib/sample-data";

async function seed() {
  if (!process.env.MONGODB_URI)
    throw new Error("Set MONGODB_URI in .env.local before seeding.");
  const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
  });
  try {
    await client.connect();
    const collection = client
      .db(process.env.MONGODB_DB || "folio_poc")
      .collection("holdings");
    await collection.createIndex({ id: 1 }, { unique: true });
    const result = await collection.bulkWrite(
      sampleHoldings.map((holding) => ({
        updateOne: {
          filter: { id: holding.id },
          update: { $setOnInsert: holding },
          upsert: true,
        },
      })),
    );
    console.log(
      `Inserted ${result.upsertedCount} demo holdings. Existing records were left unchanged.`,
    );
  } finally {
    await client.close();
  }
}

void seed().catch(() => {
  console.error(
    "Seeding failed. Check MONGODB_URI, database permissions and the unique holdings.id index.",
  );
  process.exitCode = 1;
});
