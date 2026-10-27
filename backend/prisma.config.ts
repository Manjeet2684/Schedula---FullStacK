import { defineConfig } from 'prisma/config';
import { env } from 'node:process';

export default defineConfig({
  earlyAccess: true,
  schema: './prisma/schema.prisma',
  datasource: {
    url: env['DATABASE_URL']!,
  },
});
