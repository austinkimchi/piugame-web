import { getPublicCatalogResponse } from "@/lib/public-catalog";
import { publicCatalogHttpResponse, publicCatalogOptionsResponse } from "@/lib/public-catalog-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ version: string }> }) {
  const { version } = await context.params;
  return publicCatalogHttpResponse(request, version, getPublicCatalogResponse);
}

export const HEAD = GET;

export function OPTIONS() {
  return publicCatalogOptionsResponse();
}
