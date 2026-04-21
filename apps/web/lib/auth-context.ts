import { cookies } from "next/headers";
import { verifyAccessToken } from "@ai/auth";
import { prisma } from "@ai/db";
import { sha256 } from "@/lib/crypto";

export type AuthContext = {
  userId: string;
  tenantId: string;
  email: string;
};

export async function getAuthContext(): Promise<AuthContext | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;

  if (token) {
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

      if (user) {
        return {
          userId: user.id,
          tenantId: user.tenantId,
          email: user.email,
        };
      }
    } catch {
      // fallback to refresh-token session below
    }
  }

  const refreshToken = cookieStore.get("refresh_token")?.value;
  if (!refreshToken) {
    return null;
  }

  const session: any = await prisma.session.findFirst({
    where: {
      refreshTokenHash: sha256(refreshToken),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: {
      user: {
        select: {
          id: true,
          tenantId: true,
          email: true,
          deletedAt: true,
        },
      },
    },
  });

  if (!session?.user || session.user.deletedAt) {
    return null;
  }

  return {
    userId: session.user.id,
    tenantId: session.user.tenantId,
    email: session.user.email,
  };
}
