export interface Env {
  /**
   * "gemini" (domyślnie) lub "openai" (dowolne API zgodne z OpenAI, np. Groq).
   * "workers-ai" używa wyłącznie Cloudflare Workers AI (przydatne do testu).
   * Przy "gemini" ustawiony OPENAI_API_KEY (Groq) oraz binding AI z WORKERS_AI_MODEL
   * włączają zapasowych dostawców w tej kolejności.
   */
  LLM_PROVIDER?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  /** Modele zapasowe po przecinku, używane przy przeciążeniu lub limicie modelu głównego. */
  GEMINI_FALLBACK_MODELS?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  /** Limit max_tokens dostawcy zgodnego z OpenAI (Groq: 8192). */
  OPENAI_MAX_TOKENS?: string;
  /** Groq: "hidden" usuwa rozumowanie modelu z treści odpowiedzi (inaczej JSON jest zepsuty). */
  OPENAI_REASONING_FORMAT?: string;
  /** Groq: "none" wyłącza rozumowanie modelu, cały limit tokenów idzie na odpowiedź. */
  OPENAI_REASONING_EFFORT?: string;
  /** Binding Cloudflare Workers AI ([ai] w wrangler.toml); bez klucza API. */
  AI?: { run(model: string, inputs: Record<string, unknown>): Promise<unknown> };
  /** Model Workers AI; jego ustawienie razem z bindingiem włącza Workers AI jako zapasowego. */
  WORKERS_AI_MODEL?: string;
  WORKERS_AI_MAX_TOKENS?: string;
  /** Lista dozwolonych originów oddzielona przecinkami. */
  ALLOWED_ORIGINS?: string;
  /** Opcjonalny binding Cloudflare Rate Limiting (patrz wrangler.toml). */
  RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** Osobny limit dla tłumaczeń (tłumaczenie dokumentu to wiele krótkich żądań). */
  RATE_LIMITER_TRANSLATE?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}
