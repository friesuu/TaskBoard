import { Pool } from 'pg';

// The test database, straight through SQL. The tests use it to set things up and to check what was saved
// without going through the backend's code, so they work the same whichever backend they're testing.
let pool: Pool | undefined;

// Runs one SQL statement and returns its rows, e.g. await sql('SELECT position FROM tasks WHERE id = $1', [id])
export async function sql<Row = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<Row[]> {
  // Made on first use: by then setup-env.ts has set the test database's details
  pool ??= new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  return (await pool.query(text, params)).rows as Row[];
}

// One row's one value, e.g. await sqlValue('SELECT count(*)::int FROM tasks')
export async function sqlValue<T>(text: string, params: unknown[] = []): Promise<T> {
  const [row] = await sql(text, params);
  if (!row) throw new Error(`No row for: ${text}`);
  return Object.values(row)[0] as T;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
