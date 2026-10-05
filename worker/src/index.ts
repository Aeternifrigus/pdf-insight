import type { Env } from './env';
import { handle } from './router';

export default {
  fetch: handle,
} satisfies ExportedHandler<Env>;
