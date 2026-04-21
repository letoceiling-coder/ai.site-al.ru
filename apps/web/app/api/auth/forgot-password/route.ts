import { prisma } from "@ai/db";
import { randomToken, sha256 } from "@/lib/crypto";
import { ok } from "@/lib/http";

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email : "";

  if (!email.includes("@")) {
    return ok({ sent: true });
  }

  const user: any = await prisma.user.findFirst({
    where: { email: email.toLowerCase(), deletedAt: null },
  });

  if (!user) {
    return ok({ sent: true });
  }

  const token = randomToken();
  await prisma.passwordResetToken.create({
    data: {
      tenantId: user.tenantId,
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 1000 * 60 * 30),
    },
  });

  // TODO: send email via transactional provider.
  return ok({ sent: true, resetTokenPreview: token });
}
