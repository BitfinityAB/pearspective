import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './server/storage/schema.ts',
  out: './server/storage/migrations',
  dialect: 'sqlite',
});
