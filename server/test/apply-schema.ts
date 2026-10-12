import { env } from 'cloudflare:workers';

const bindings = env as typeof env & { DB: D1Database; TEST_SCHEMA: string };
const statements = JSON.parse(bindings.TEST_SCHEMA) as string[];
await bindings.DB.batch(statements.map((statement) => bindings.DB.prepare(statement)));
