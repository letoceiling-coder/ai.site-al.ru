import { socketContracts } from "@/lib/contracts";
import { ok } from "@/lib/http";

export async function GET() {
  return ok(socketContracts);
}
