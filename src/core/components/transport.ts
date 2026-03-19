/**
 * Creates a viem transport from a comma-separated list of RPC URLs.
 * If multiple URLs are provided, uses viem's fallback transport for automatic failover.
 * If a single URL is provided, uses a plain http transport.
 *
 * RPCs are tried in order on failure. The first URL should be your most reliable
 * (archive-capable) node since viem's fallback only triggers on transport errors —
 * a non-archive node returning empty results for historical queries will NOT
 * trigger a fallback (it's a valid RPC response, just missing data).
 *
 * With rank=true, viem periodically pings all RPCs and auto-promotes the most
 * stable/fastest one to primary position.
 */

import { http, fallback, type Transport } from "viem";

export function createTransport(rpcUrls: string): Transport {
  const urls = rpcUrls
    .split(",")
    .map((u) => u.trim())
    .filter((u) => u.length > 0);

  if (urls.length === 0) {
    throw new Error("No RPC URLs provided");
  }

  if (urls.length === 1) {
    return http(urls[0]);
  }

  console.log(`[Transport] Using fallback transport with ${urls.length} RPCs`);
  return fallback(
    urls.map((url) => http(url)),
    { rank: true },
  );
}
