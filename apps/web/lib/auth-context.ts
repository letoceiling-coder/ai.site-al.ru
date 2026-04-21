import { cookies } from "next/headers";
import { verifyAccessToken } from "@ai/auth";
import { prisma } from "@ai/db";

export type AuthContext = {
  userId: string;
  tenantId: string;
  email: string;
};

export async function getAuthContext(): Promise<AuthContext | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  if (!token) {
    return null;
  }

  try {
    const payload = await verifyAccessToken(token);
    const user: any = await prisma.user.findFirst({
      where: {
        id: payload.sub,
        tenantId: payload.tenantId,
        deletedAt: null,
      },
      select: {
        id: true,
        tenantId: true,
        email: true,
      },
    });

    if (!user) {
      return null;
    }

    return {
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
    };
  } catch {
    return null;
  }
}
