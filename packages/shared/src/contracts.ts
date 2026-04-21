export type ApiSuccess<T> = {
  ok: true;
  data: T;
};

export type ApiError = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export const adminModules = [
  "integrations",
  "agents",
  "knowledge",
  "assistants",
  "dialogs",
  "api_keys",
  "leads",
  "telegram",
  "analytics",
  "usage",
  "settings",
  "avito",
] as const;

export type AdminModule = (typeof adminModules)[number];

export type RbacAction = "read" | "create" | "update" | "delete";

export type RoleCode = "owner" | "admin" | "manager" | "viewer";

export type RestContract = {
  module: AdminModule;
  path: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  requiredPermission: `${AdminModule}.${RbacAction}`;
};

export type SocketEventContract = {
  channel: "jobs" | "dialogs" | "ingestion" | "integrations" | "system";
  event: string;
  payloadSchema: string;
};
