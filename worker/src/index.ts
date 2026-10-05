import { z } from 'zod';
import type { Env } from './env';
import { handle } from './router';

// Szczegóły błędów walidacji trafiają do użytkownika, a brief wymaga komunikatów po polsku.
z.config(z.locales.pl());

export default {
  fetch: handle,
} satisfies ExportedHandler<Env>;
