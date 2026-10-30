// Runs before each integration / API flow test file is loaded, so modules
// that read env on import (ConfigModule.forRoot) already see the test DB.
import { useTestDatabase } from './test-db';

useTestDatabase();
