import { cookies } from "next/headers";
import { verifyAccessToken } from "@ai/auth";
import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  if (!token) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }

  try {
    const payload = await verifyAccessToken(token);
    const user = await prisma.user.findFirst({
      where: {
        id: payload.sub,
        tenantId: payload.tenantId,
        deletedAt: null,
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        tenantId: true,
        status: true,
      },
    });

    if (!user) {
      return fail("Unauthorized", "UNAUTHORIZED", 401);
    }

    return ok(user);
  } catch {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }
}
