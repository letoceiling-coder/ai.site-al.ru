import type { RestContract, SocketEventContract } from "@ai/shared";

export const restContracts: RestContract[] = [
  { module: "integrations", path: "/api/integrations", method: "GET", requiredPermission: "integrations.read" },
  { module: "integrations", path: "/api/integrations", method: "POST", requiredPermission: "integrations.create" },
  { module: "agents", path: "/api/agents", method: "GET", requiredPermission: "agents.read" },
  { module: "agents", path: "/api/agents", method: "POST", requiredPermission: "agents.create" },
  { module: "knowledge", path: "/api/knowledge", method: "GET", requiredPermission: "knowledge.read" },
  { module: "knowledge", path: "/api/knowledge", method: "POST", requiredPermission: "knowledge.create" },
  { module: "assistants", path: "/api/assistants", method: "GET", requiredPermission: "assistants.read" },
  { module: "assistants", path: "/api/assistants", method: "POST", requiredPermission: "assistants.create" },
  { module: "dialogs", path: "/api/dialogs", method: "GET", requiredPermission: "dialogs.read" },
  { module: "dialogs", path: "/api/dialogs", method: "POST", requiredPermission: "dialogs.create" },
  { module: "api_keys", path: "/api/api-keys", method: "GET", requiredPermission: "api_keys.read" },
  { module: "api_keys", path: "/api/api-keys", method: "POST", requiredPermission: "api_keys.create" },
  { module: "leads", path: "/api/leads", method: "GET", requiredPermission: "leads.read" },
  { module: "leads", path: "/api/leads", method: "POST", requiredPermission: "leads.create" },
  { module: "telegram", path: "/api/telegram-bot", method: "GET", requiredPermission: "telegram.read" },
  { module: "telegram", path: "/api/telegram-bot", method: "POST", requiredPermission: "telegram.create" },
  { module: "analytics", path: "/api/analytics", method: "GET", requiredPermission: "analytics.read" },
  { module: "usage", path: "/api/usage", method: "GET", requiredPermission: "usage.read" },
  { module: "settings", path: "/api/settings", method: "GET", requiredPermission: "settings.read" },
  { module: "settings", path: "/api/settings", method: "PATCH", requiredPermission: "settings.update" },
  { module: "avito", path: "/api/avito", method: "GET", requiredPermission: "avito.read" },
  { module: "avito", path: "/api/avito", method: "POST", requiredPermission: "avito.create" },
];

export const socketContracts: SocketEventContract[] = [
  { channel: "jobs", event: "job.created", payloadSchema: "JobEnvelope" },
  { channel: "jobs", event: "job.progress", payloadSchema: "JobEnvelope" },
  { channel: "jobs", event: "job.failed", payloadSchema: "JobEnvelope" },
  { channel: "dialogs", event: "dialog.message.stream", payloadSchema: "DialogMessageChunk" },
  { channel: "ingestion", event: "ingestion.updated", payloadSchema: "IngestionStatus" },
  { channel: "integrations", event: "webhook.received", payloadSchema: "WebhookEvent" },
  { channel: "system", event: "system.health", payloadSchema: "SystemHealthPayload" },
];
