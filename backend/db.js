import { neon } from '@neondatabase/serverless';

let sqlInstance;

export default function sql(strings, ...values) {
  if (!sqlInstance) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }
    sqlInstance = neon(process.env.DATABASE_URL);
  }
  return sqlInstance(strings, ...values);
}
