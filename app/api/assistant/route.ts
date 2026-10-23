import { NextResponse } from "next/server";
import { createReport } from "@/lib/assistant";
import { requestSchema } from "@/lib/contracts";
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const requestUrl = new URL(request.url);
  const expectedOrigin = `${requestUrl.protocol}//${request.headers.get("host") || requestUrl.host}`;
  if (origin && origin !== expectedOrigin)
    return NextResponse.json(
      { error: "Cross-origin requests are not allowed." },
      { status: 403 },
    );
  try {
    const body = await request.text();
    if (body.length > 12000)
      return NextResponse.json(
        { error: "Request is too large." },
        { status: 413 },
      );
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON request." },
        { status: 400 },
      );
    }
    const input = requestSchema.safeParse(parsed);
    if (!input.success)
      return NextResponse.json(
        {
          error:
            "Enter a question of 3 to 2,000 characters and select a supported format.",
        },
        { status: 400 },
      );
    return NextResponse.json(
      await createReport(input.data.question, input.data.format),
    );
  } catch (error) {
    console.log(
      "Assistant request failed:test", error,
      error instanceof Error ? error.name : "Unknown error",
    );
    if (error instanceof OpenAI.APIConnectionError) {
      console.log("Cause", error.cause);
      console.log("Message", error.message);
    }
    return NextResponse.json(
      {
        error:
          "The report could not be generated. Check your server credentials, database connection and model access, then try again. No sample data has been substituted for a failed connection.",
      },
      { status: 502 },
    );
  }
}
