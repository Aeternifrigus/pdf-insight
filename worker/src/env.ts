export interface Env {
  /** "gemini" (domyślnie) lub "openai" (dowolne API zgodne z OpenAI, np. Groq). */
  LLM_PROVIDER?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  /** Lista dozwolonych originów oddzielona przecinkami. */
  ALLOWED_ORIGINS?: string;
  /** Opcjonalny binding Cloudflare Rate Limiting (patrz wrangler.toml). */
  RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** Osobny limit dla tłumaczeń (tłumaczenie dokumentu to wiele krótkich żądań). */
  RATE_LIMITER_TRANSLATE?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}
