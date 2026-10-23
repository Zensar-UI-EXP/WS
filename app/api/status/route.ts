import { NextResponse } from "next/server";
import { getPortfolio } from "@/lib/portfolio";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const portfolio = await getPortfolio({ assetClass: null, region: null });
    return NextResponse.json({
      llm: process.env.OPENAI_API_KEY ? "openai" : "demo",
      database: portfolio.source,
      portfolio,
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "MongoDB could not be read. Check the connection and seed the holdings collection.",
      },
      { status: 503 },
    );
  }
}
