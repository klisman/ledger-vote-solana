import { NextResponse } from "next/server";
import { CLUSTER, VALIDATOR_RPC_URL } from "@/lib/cluster";

export async function POST(request: Request) {
  if (CLUSTER !== "localnet") {
    return NextResponse.json({ error: "RPC proxy is localnet-only" }, { status: 404 });
  }

  const upstream = await fetch(VALIDATOR_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });

  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
    },
  });
}
