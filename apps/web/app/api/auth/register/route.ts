import { prisma } from "@ai/db";
import { hashPassword } from "@ai/auth";
import { fail, ok } from "@/lib/http";

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const displayName = typeof body.displayName === "string" ? body.displayName : "";
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (displayName.length < 2 || !email.includes("@") || password.length < 8) {
    return fail("Некорректный payload");
  }

  const existingUser = await prisma.user.findFirst({
    where: { email: email.toLowerCase(), deletedAt: null },
    select: { id: true },
  });
  if (existingUser) {
    return fail("Пользователь с таким email уже существует", "EMAIL_EXISTS", 409);
  }

  const passwordHash = await hashPassword(password);
  const result = await prisma.$transaction(async (tx: any) => {
    const emailPrefix = email.toLowerCase().split("@")[0] ?? "workspace";
    const slugBase = emailPrefix
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "workspace";
    const tenantSlug = `${slugBase}-${Date.now().toString(36).slice(-6)}`;
    const tenantName = displayName.trim();

    const tenant = await tx.tenant.create({
      data: {
        name: tenantName,
        slug: tenantSlug,
      },
    });

    const user = await tx.user.create({
      data: {
        tenantId: tenant.id,
        email: email.toLowerCase(),
        passwordHash,
        displayName,
      },
    });

    const ownerRole = await tx.role.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: "owner" } },
      update: {},
      create: { tenantId: tenant.id, code: "owner", title: "OWNER" },
    });

    await tx.membership.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        roleId: ownerRole.id,
        status: "ACTIVE",
      },
    });

    return { tenantId: tenant.id, userId: user.id };
  });

  return ok(result, 201);
}
