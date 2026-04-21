import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const permissionMatrix = [
  { module: "integrations", actions: ["read", "create", "update", "delete"] },
  { module: "agents", actions: ["read", "create", "update", "delete"] },
  { module: "knowledge", actions: ["read", "create", "update", "delete"] },
  { module: "assistants", actions: ["read", "create", "update", "delete"] },
  { module: "dialogs", actions: ["read", "create", "update", "delete"] },
  { module: "api_keys", actions: ["read", "create", "update", "delete"] },
  { module: "leads", actions: ["read", "create", "update", "delete"] },
  { module: "telegram", actions: ["read", "create", "update", "delete"] },
  { module: "analytics", actions: ["read"] },
  { module: "usage", actions: ["read"] },
  { module: "settings", actions: ["read", "update"] },
  { module: "avito", actions: ["read", "create", "update", "delete"] },
];

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: "default" },
    update: {},
    create: {
      slug: "default",
      name: "Default Workspace",
      timezone: "Europe/Moscow",
    },
  });

  const roleCodes = ["owner", "admin", "manager", "viewer"] as const;

  for (const code of roleCodes) {
    await prisma.role.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code } },
      update: {},
      create: {
        tenantId: tenant.id,
        code,
        title: code.toUpperCase(),
      },
    });
  }

  for (const entry of permissionMatrix) {
    for (const action of entry.actions) {
      await prisma.permission.upsert({
        where: {
          tenantId_module_action: {
            tenantId: tenant.id,
            module: entry.module,
            action,
          },
        },
        update: {},
        create: {
          tenantId: tenant.id,
          module: entry.module,
          action,
          title: `${entry.module}.${action}`,
        },
      });
    }
  }
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
