-- Email verification and password-reset tokens.
-- Run once on kch_bakery, as the postgres user, AFTER 001_customer_accounts.sql.

ALTER TABLE public.customer ADD COLUMN email_verified_at timestamptz;

CREATE TABLE public.customer_token (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id integer NOT NULL REFERENCES public.customer(id) ON DELETE CASCADE,
    purpose text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
    token_hash text NOT NULL,            -- sha256 of the token. The token itself only ever exists in the email link.
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customer_token_hash_idx ON public.customer_token (token_hash);
CREATE INDEX customer_token_customer_idx ON public.customer_token (customer_id, purpose);

GRANT ALL ON TABLE public.customer_token TO kch_app;