export const OFFICIAL_PROVIDER_ID = "openai";

const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

export function normalizeProviderId(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return PROVIDER_ID.test(normalized) ? normalized : null;
}
