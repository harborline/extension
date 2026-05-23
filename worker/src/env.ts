// Bindings declared in wrangler.toml + the SIDEBAR_TOKEN secret.
export interface Env {
  DB: D1Database
  VECTORS: VectorizeIndex
  AI: Ai
  BLOBS: R2Bucket
  INGEST?: Workflow              // optional — code must work without it
  ASSETS?: Fetcher               // static SPA bundle; absent in plain-API tests
  SIDEBAR_TOKEN: string
  MAIL_APP_URL?: string
}

// Workers AI model ids used by the Worker.
export const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5" as const
export const EMBED_DIMS = 768 as const
export const TRANSCRIBE_MODEL = "@cf/openai/whisper" as const
export const OCR_MODEL = "@cf/llava-hf/llava-1.5-7b-hf" as const

// AI Gateway id from the account's existing config. Per CLAUDE.md, dynamic/*
// routes are broken inside a Worker; we route specific @cf/* models through
// gateway "x" instead. Swap to dynamic/* when upstream is fixed.
export const AI_GATEWAY_ID = "x" as const
