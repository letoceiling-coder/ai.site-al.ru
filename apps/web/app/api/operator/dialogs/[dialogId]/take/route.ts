import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";
import { takeOverDialog } from "@/lib/dialog-handoff";
import { publishOperatorEvent } from "@/lib/operator-events";

type Context = { params: Promise<{ dialogId: string }> };

export async function POST(_request: Request, context: Context) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }
  const { dialogId } = await context.params;
  if (!dialogId) {
    return fail("dialogId is required", "BAD_REQUEST", 400);
  }
  const handoff = await takeOverDialog(auth.tenantId, dialogId, {
    userId: auth.userId,
    email: auth.email,
  });
  if (!handoff) {
    return fail("Dialog not found", "NOT_FOUND", 404);
  }
  publishOperatorEvent({ type: "queue", tenantId: auth.tenantId });
  publishOperatorEvent({ type: "dialog-updated", tenantId: auth.tenantId, dialogId });
  return ok({ dialogId, handoff });
}
