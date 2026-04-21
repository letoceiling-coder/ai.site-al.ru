export const realtimeChannels = [
  "jobs",
  "dialogs",
  "ingestion",
  "integrations",
  "system",
] as const;

export type RealtimeChannel = (typeof realtimeChannels)[number];

export type RealtimeEventEnvelope<TPayload = unknown> = {
  tenantId: string;
  channel: RealtimeChannel;
  event: string;
  payload: TPayload;
  createdAt: string;
};

export function tenantRoom(tenantId: string) {
  return `tenant:${tenantId}`;
}
