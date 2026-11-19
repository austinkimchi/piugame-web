import "server-only";

import * as tls from "node:tls";
import { PiuClient } from "@austinkimchi/piugame-sdk";

import { PIU_INTERMEDIATE_CA } from "@/lib/piu-tls-ca";
import type { PiuCatalogVersion } from "@/lib/types";

/** Only PIU SDK traffic receives chain assistance; global process trust is unchanged. */
export function createPiuClient(version: PiuCatalogVersion): PiuClient {
  // The app still uses Node 20 declarations; preserve actual runtime trust on Node 24.
  const runtimeTls = tls as typeof tls & { getCACertificates?: (type: "default") => string[] };
  if (typeof runtimeTls.getCACertificates !== "function") {
    throw new Error("Strict PIU TLS requires a Node runtime with tls.getCACertificates().");
  }
  return new PiuClient({
    version,
    ca: [...runtimeTls.getCACertificates("default"), PIU_INTERMEDIATE_CA],
    rejectUnauthorized: true,
    allowInsecureTlsFallback: false,
  });
}
