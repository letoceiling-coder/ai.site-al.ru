import type { RoleCode } from "@ai/shared";

const rolePower: Record<RoleCode, number> = {
  owner: 4,
  admin: 3,
  manager: 2,
  viewer: 1,
};

export function hasRole(required: RoleCode, current: RoleCode) {
  return rolePower[current] >= rolePower[required];
}

export function can(permission: string, grantedPermissions: string[]) {
  return grantedPermissions.includes(permission);
}
