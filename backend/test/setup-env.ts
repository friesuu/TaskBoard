import { readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseEnv } from 'util';

// Runs before the tests (setupFiles in jest-e2e.json). The test settings in e2e.env win over backend/.env.
Object.assign(process.env, parseEnv(readFileSync(join(__dirname, 'e2e.env'), 'utf8')));
// Uploaded files go to a throwaway folder in the system's temp folder, never the real one
process.env.UPLOAD_DIR = join(tmpdir(), 'taskboard-e2e-uploads');

// The rest (database address and password, JWT_SECRET) from backend/.env. Values set above are kept.
try {
  process.loadEnvFile(join(__dirname, '..', '.env'));
} catch {
  // No .env file (e.g. on a server): the real environment variables are used
}
