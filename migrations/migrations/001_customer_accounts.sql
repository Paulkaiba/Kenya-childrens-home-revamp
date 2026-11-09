-- Customer accounts and order confirmation.
-- Run once on the kch_bakery database, as the postgres user.

CREATE TABLE public.customer (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL,
    email text NOT NULL,
    phone text NOT NULL,            -- stored as 2547XXXXXXXX / 2541XXXXXXXX
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customer_email_unique ON public.customer (lower(email));
CREATE UNIQUE INDEX customer_phone_unique ON public.customer (phone);

ALTER TABLE public.customer_order
    ADD COLUMN customer_id integer REFERENCES public.customer(id) ON DELETE SET NULL;
CREATE INDEX customer_order_customer_idx ON public.customer_order (customer_id);

-- Each collection (bread / cake / pastry) has its own pickup, so the customer confirms per collection.
ALTER TABLE public.order_pickup ADD COLUMN customer_confirmed_at timestamptz;

GRANT ALL ON TABLE public.customer TO kch_app;