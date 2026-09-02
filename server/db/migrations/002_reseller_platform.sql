BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_role_valid'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_role_valid CHECK (role IN ('user', 'admin'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS providers (
  id uuid PRIMARY KEY,
  name varchar(80) NOT NULL,
  slug varchar(80) NOT NULL,
  provider_kind text NOT NULL,
  base_url text NOT NULL,
  credential_nonce bytea NOT NULL,
  credential_ciphertext bytea NOT NULL,
  credential_auth_tag bytea NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT providers_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT providers_slug_not_blank CHECK (length(btrim(slug)) > 0),
  CONSTRAINT providers_kind_valid CHECK (
    provider_kind IN ('openrouter', 'deepseek', 'alibaba', 'openai_compatible')
  ),
  CONSTRAINT providers_base_url_valid CHECK (
    base_url ~* '^https?://[^[:space:]]+$'
  ),
  CONSTRAINT providers_nonce_not_empty CHECK (octet_length(credential_nonce) > 0),
  CONSTRAINT providers_ciphertext_not_empty CHECK (octet_length(credential_ciphertext) > 0),
  CONSTRAINT providers_auth_tag_not_empty CHECK (octet_length(credential_auth_tag) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS providers_slug_unique
  ON providers (slug);

CREATE INDEX IF NOT EXISTS providers_enabled_idx
  ON providers (enabled, created_at DESC);

CREATE TABLE IF NOT EXISTS models (
  id uuid PRIMARY KEY,
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  provider_model_id varchar(160) NOT NULL,
  display_name varchar(120) NOT NULL,
  description text NOT NULL DEFAULT '',
  context_window integer NOT NULL DEFAULT 0,
  max_output_tokens integer NOT NULL DEFAULT 0,
  input_price_micros bigint NOT NULL DEFAULT 0,
  output_price_micros bigint NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT models_provider_id_not_blank CHECK (length(btrim(provider_model_id)) > 0),
  CONSTRAINT models_display_name_not_blank CHECK (length(btrim(display_name)) > 0),
  CONSTRAINT models_context_window_non_negative CHECK (context_window >= 0),
  CONSTRAINT models_max_output_tokens_non_negative CHECK (max_output_tokens >= 0),
  CONSTRAINT models_input_price_non_negative CHECK (input_price_micros >= 0),
  CONSTRAINT models_output_price_non_negative CHECK (output_price_micros >= 0),
  CONSTRAINT models_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS models_provider_model_unique
  ON models (provider_id, provider_model_id);

CREATE INDEX IF NOT EXISTS models_enabled_idx
  ON models (enabled, created_at DESC);

CREATE INDEX IF NOT EXISTS models_provider_idx
  ON models (provider_id, created_at DESC);

CREATE TABLE IF NOT EXISTS client_model_entitlements (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, model_id)
);

CREATE INDEX IF NOT EXISTS client_model_entitlements_model_idx
  ON client_model_entitlements (model_id, enabled);

CREATE INDEX IF NOT EXISTS client_model_entitlements_user_idx
  ON client_model_entitlements (user_id, enabled);

CREATE TABLE IF NOT EXISTS inference_usage (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  api_key_id uuid REFERENCES api_keys(id) ON DELETE SET NULL,
  provider_id uuid REFERENCES providers(id) ON DELETE SET NULL,
  model_id uuid REFERENCES models(id) ON DELETE SET NULL,
  status text NOT NULL,
  upstream_status integer,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  latency_ms integer,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inference_usage_status_not_blank CHECK (length(btrim(status)) > 0),
  CONSTRAINT inference_usage_prompt_tokens_non_negative CHECK (prompt_tokens >= 0),
  CONSTRAINT inference_usage_completion_tokens_non_negative CHECK (completion_tokens >= 0),
  CONSTRAINT inference_usage_total_tokens_non_negative CHECK (total_tokens >= 0),
  CONSTRAINT inference_usage_latency_non_negative CHECK (latency_ms IS NULL OR latency_ms >= 0),
  CONSTRAINT inference_usage_upstream_status_valid CHECK (
    upstream_status IS NULL OR upstream_status BETWEEN 100 AND 599
  )
);

CREATE INDEX IF NOT EXISTS inference_usage_user_created_idx
  ON inference_usage (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS inference_usage_model_created_idx
  ON inference_usage (model_id, created_at DESC);

CREATE INDEX IF NOT EXISTS inference_usage_created_idx
  ON inference_usage (created_at DESC);

INSERT INTO schema_migrations (version)
VALUES ('002_reseller_platform')
ON CONFLICT (version) DO NOTHING;

COMMIT;
