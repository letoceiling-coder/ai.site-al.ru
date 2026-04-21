import { restContracts } from "@/lib/contracts";
import { ok } from "@/lib/http";

export async function GET() {
  return ok(restContracts);
}
