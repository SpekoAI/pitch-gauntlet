import postgres from "postgres";

/**
 * Lazy postgres singleton. DATABASE_URL points at the shared viral-demos
 * Neon database; this app owns the `gauntlet` schema.
 */
let client: ReturnType<typeof postgres> | null = null;

export function db(): ReturnType<typeof postgres> {
  if (client) {
    return client;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not configured");
  }
  client = postgres(url, {
    ssl: "require",
    max: 2,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return client;
}

export function dbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
