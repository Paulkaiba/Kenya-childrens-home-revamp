--
-- PostgreSQL database dump
--

-- Dumped from database version 16.3
-- Dumped by pg_dump version 16.3

-- Started on 2026-11-04 00:43:42

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 2 (class 3079 OID 16813)
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- TOC entry 5009 (class 0 OID 0)
-- Dependencies: 2
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- TOC entry 265 (class 1255 OID 17007)
-- Name: next_order_serial(date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.next_order_serial(p_day date DEFAULT CURRENT_DATE) RETURNS text
    LANGUAGE sql
    AS $$
  INSERT INTO order_serial_counter AS c (day, last_number) VALUES (p_day, 1)
  ON CONFLICT (day) DO UPDATE SET last_number = c.last_number + 1
  RETURNING 'KBK-' || to_char(c.day, 'YYYYMMDD') || '-' || lpad(c.last_number::text, 4, '0');
$$;


ALTER FUNCTION public.next_order_serial(p_day date) OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 222 (class 1259 OID 16925)
-- Name: closed_date; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.closed_date (
    closed_on date NOT NULL,
    reason text
);


ALTER TABLE public.closed_date OWNER TO postgres;

--
-- TOC entry 221 (class 1259 OID 16919)
-- Name: closed_weekday; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.closed_weekday (
    weekday smallint NOT NULL,
    CONSTRAINT closed_weekday_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)))
);


ALTER TABLE public.closed_weekday OWNER TO postgres;

--
-- TOC entry 226 (class 1259 OID 16949)
-- Name: customer_order; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.customer_order (
    serial text NOT NULL,
    status text DEFAULT 'Received'::text NOT NULL,
    cancel_requested boolean DEFAULT false NOT NULL,
    fulfilment text DEFAULT 'pickup'::text NOT NULL,
    location text DEFAULT ''::text NOT NULL,
    delivery_fee numeric(10,2) DEFAULT 0 NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    total numeric(10,2) NOT NULL,
    customer_name text NOT NULL,
    customer_phone text NOT NULL,
    customer_email text NOT NULL,
    earliest_pickup timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_order_delivery_fee_check CHECK ((delivery_fee >= (0)::numeric)),
    CONSTRAINT customer_order_fulfilment_check CHECK ((fulfilment = ANY (ARRAY['pickup'::text, 'delivery'::text]))),
    CONSTRAINT customer_order_status_check CHECK ((status = ANY (ARRAY['Received'::text, 'Confirmed'::text, 'Baking'::text, 'Ready'::text, 'Collected'::text, 'Delivered'::text, 'Cancelled'::text]))),
    CONSTRAINT customer_order_total_check CHECK ((total >= (0)::numeric))
);


ALTER TABLE public.customer_order OWNER TO postgres;

--
-- TOC entry 228 (class 1259 OID 16983)
-- Name: order_line; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.order_line (
    id text NOT NULL,
    serial text NOT NULL,
    product_id text,
    name text NOT NULL,
    size_label text NOT NULL,
    flavour text,
    message text,
    qty integer NOT NULL,
    unit_price numeric(10,2) NOT NULL,
    bucket text NOT NULL,
    status text DEFAULT 'Received'::text NOT NULL,
    CONSTRAINT order_line_bucket_check CHECK ((bucket = ANY (ARRAY['bread'::text, 'cake'::text, 'pastry'::text]))),
    CONSTRAINT order_line_qty_check CHECK ((qty >= 1)),
    CONSTRAINT order_line_status_check CHECK ((status = ANY (ARRAY['Received'::text, 'Confirmed'::text, 'Baking'::text, 'Ready'::text, 'Collected'::text, 'Delivered'::text, 'Cancelled'::text]))),
    CONSTRAINT order_line_unit_price_check CHECK ((unit_price >= (0)::numeric))
);


ALTER TABLE public.order_line OWNER TO postgres;

--
-- TOC entry 227 (class 1259 OID 16970)
-- Name: order_pickup; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.order_pickup (
    serial text NOT NULL,
    bucket text NOT NULL,
    pickup_at timestamp with time zone NOT NULL,
    CONSTRAINT order_pickup_bucket_check CHECK ((bucket = ANY (ARRAY['bread'::text, 'cake'::text, 'pastry'::text])))
);


ALTER TABLE public.order_pickup OWNER TO postgres;

--
-- TOC entry 225 (class 1259 OID 16943)
-- Name: order_serial_counter; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.order_serial_counter (
    day date NOT NULL,
    last_number integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.order_serial_counter OWNER TO postgres;

--
-- TOC entry 216 (class 1259 OID 16850)
-- Name: product; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.product (
    id text NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    emoji text,
    description text DEFAULT ''::text NOT NULL,
    ingredients text[] DEFAULT '{}'::text[] NOT NULL,
    allergens text[] DEFAULT '{}'::text[] NOT NULL,
    is_custom boolean DEFAULT false NOT NULL,
    sold_out boolean DEFAULT false NOT NULL,
    hidden boolean DEFAULT false NOT NULL,
    image_url text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_category_check CHECK ((category = ANY (ARRAY['bread'::text, 'cake'::text, 'pastry'::text])))
);


ALTER TABLE public.product OWNER TO postgres;

--
-- TOC entry 218 (class 1259 OID 16881)
-- Name: product_flavour; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.product_flavour (
    product_id text NOT NULL,
    flavour text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.product_flavour OWNER TO postgres;

--
-- TOC entry 219 (class 1259 OID 16894)
-- Name: product_notice_rule; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.product_notice_rule (
    product_id text NOT NULL,
    over_qty integer NOT NULL,
    notice_hours integer NOT NULL,
    CONSTRAINT product_notice_rule_notice_hours_check CHECK ((notice_hours >= 0)),
    CONSTRAINT product_notice_rule_over_qty_check CHECK ((over_qty >= 0))
);


ALTER TABLE public.product_notice_rule OWNER TO postgres;

--
-- TOC entry 217 (class 1259 OID 16867)
-- Name: product_size; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.product_size (
    product_id text NOT NULL,
    size_id text NOT NULL,
    label text NOT NULL,
    price numeric(10,2) NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    CONSTRAINT product_size_price_check CHECK ((price >= (0)::numeric))
);


ALTER TABLE public.product_size OWNER TO postgres;

--
-- TOC entry 220 (class 1259 OID 16908)
-- Name: schedule_setting; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.schedule_setting (
    id smallint DEFAULT 1 NOT NULL,
    open_hour smallint NOT NULL,
    close_hour smallint NOT NULL,
    daily_capacity integer NOT NULL,
    CONSTRAINT schedule_setting_check CHECK ((open_hour < close_hour)),
    CONSTRAINT schedule_setting_close_hour_check CHECK (((close_hour >= 1) AND (close_hour <= 24))),
    CONSTRAINT schedule_setting_daily_capacity_check CHECK ((daily_capacity >= 1)),
    CONSTRAINT schedule_setting_id_check CHECK ((id = 1)),
    CONSTRAINT schedule_setting_open_hour_check CHECK (((open_hour >= 0) AND (open_hour <= 23)))
);


ALTER TABLE public.schedule_setting OWNER TO postgres;

--
-- TOC entry 224 (class 1259 OID 16933)
-- Name: staff; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.staff (
    id integer NOT NULL,
    name text NOT NULL,
    username text NOT NULL,
    password_hash text NOT NULL,
    role text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staff_role_check CHECK ((role = ANY (ARRAY['manager'::text, 'supervisor'::text, 'baker'::text])))
);


ALTER TABLE public.staff OWNER TO postgres;

--
-- TOC entry 223 (class 1259 OID 16932)
-- Name: staff_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.staff ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.staff_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 4997 (class 0 OID 16925)
-- Dependencies: 222
-- Data for Name: closed_date; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.closed_date (closed_on, reason) FROM stdin;
\.


--
-- TOC entry 4996 (class 0 OID 16919)
-- Dependencies: 221
-- Data for Name: closed_weekday; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.closed_weekday (weekday) FROM stdin;
0
\.


--
-- TOC entry 5001 (class 0 OID 16949)
-- Dependencies: 226
-- Data for Name: customer_order; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.customer_order (serial, status, cancel_requested, fulfilment, location, delivery_fee, notes, total, customer_name, customer_phone, customer_email, earliest_pickup, created_at, updated_at) FROM stdin;
KBK-20261018-0001	Received	f	pickup		0.00	Might come a bit early	385.00	Paul Kaiba	254757726256	orangecrucsh@gmail.com	2026-10-19 15:00:00+03	2026-10-18 22:23:39.529992+03	2026-10-18 22:23:39.529992+03
KBK-20261019-0001	Received	f	pickup		0.00		35.00	Nyaga Gacheru	254741196319	nyashgach2.0@gmail.com	2026-10-22 10:00:00+03	2026-10-19 13:06:31.189766+03	2026-10-19 13:06:31.189766+03
KBK-20261019-0002	Received	f	pickup		0.00		35.00	Nyaga Gacheru	254741196319	nyashgach2.0@gmail.com	2026-10-21 09:00:00+03	2026-10-19 13:31:57.692729+03	2026-10-19 13:31:57.692729+03
KBK-20261101-0001	Received	f	pickup		0.00		245.00	Paul Kaiba	254735444086	orangecrucsh@gmail.com	2026-11-02 15:00:00+03	2026-11-01 17:02:27.997742+03	2026-11-01 17:02:27.997742+03
KBK-20261102-0001	Received	f	pickup		0.00		140.00	Einsten	254722334455	einstein.munene@strathmore.edu	2026-11-02 16:00:00+03	2026-11-02 09:12:40.280993+03	2026-11-02 09:12:40.280993+03
KBK-20261102-0002	Received	f	pickup		0.00		4400.00	este munene	254722334455	einstein.munene@strathmore.edu	2026-11-03 10:00:00+03	2026-11-02 09:19:20.492751+03	2026-11-02 09:19:20.492751+03
KBK-20261102-0003	Received	f	pickup		0.00		125.00	este	254722334455	einstein.munene@strathmore.edu	2026-11-02 13:00:00+03	2026-11-02 10:14:57.156107+03	2026-11-02 10:14:57.156107+03
KBK-20261102-0004	Received	f	pickup		0.00		385.00	Jemima Moye	254722334455	jemima.moye@strathmore.edu	2026-11-03 16:00:00+03	2026-11-02 19:22:04.860036+03	2026-11-02 19:22:04.860036+03
KBK-20261102-0005	Received	f	pickup		0.00		385.00	Jemima Moye	254722334455	jemima.moye@strathmore.edu	2026-11-03 16:00:00+03	2026-11-02 19:30:11.700731+03	2026-11-02 19:30:11.700731+03
KBK-20261103-0001	Collected	f	pickup		0.00		140.00	Anthea K	254722334455	antheakirui@gmail.com	2026-11-04 09:00:00+03	2026-11-03 15:02:52.449456+03	2026-11-03 15:02:52.449456+03
\.


--
-- TOC entry 5003 (class 0 OID 16983)
-- Dependencies: 228
-- Data for Name: order_line; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.order_line (id, serial, product_id, name, size_label, flavour, message, qty, unit_price, bucket, status) FROM stdin;
KBK-20261018-0001-L1	KBK-20261018-0001	bb	Brown Bread	200g	\N	\N	11	35.00	bread	Ready
KBK-20261019-0001-L1	KBK-20261019-0001	wb	White Bread	200g	\N	\N	1	35.00	bread	Received
KBK-20261019-0002-L1	KBK-20261019-0002	wb	White Bread	200g	\N	\N	1	35.00	bread	Received
KBK-20261101-0001-L1	KBK-20261101-0001	wb	White Bread	200g	\N	\N	7	35.00	bread	Received
KBK-20261102-0001-L1	KBK-20261102-0001	wb	White Bread	200g	\N	\N	4	35.00	bread	Received
KBK-20261102-0003-L1	KBK-20261102-0003	qc	Queen Cakes	Each	\N	\N	5	25.00	pastry	Received
KBK-20261102-0005-L1	KBK-20261102-0005	bb	Brown Bread	200g	\N	\N	11	35.00	bread	Baking
KBK-20261102-0004-L1	KBK-20261102-0004	bb	Brown Bread	200g	\N	\N	11	35.00	bread	Baking
KBK-20261102-0002-L1	KBK-20261102-0002	ck	Celebration Cake	2 kg (16–20 people)	Mint chocolate	ppp	1	4400.00	cake	Baking
KBK-20261103-0001-L1	KBK-20261103-0001	bb	Brown Bread	200g	\N	\N	4	35.00	bread	Collected
\.


--
-- TOC entry 5002 (class 0 OID 16970)
-- Dependencies: 227
-- Data for Name: order_pickup; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.order_pickup (serial, bucket, pickup_at) FROM stdin;
KBK-20261018-0001	bread	2026-10-19 15:00:00+03
KBK-20261019-0001	bread	2026-10-22 10:00:00+03
KBK-20261019-0002	bread	2026-10-21 09:00:00+03
KBK-20261101-0001	bread	2026-11-02 15:00:00+03
KBK-20261102-0001	bread	2026-11-02 16:00:00+03
KBK-20261102-0002	cake	2026-11-03 10:00:00+03
KBK-20261102-0003	pastry	2026-11-02 13:00:00+03
KBK-20261102-0004	bread	2026-11-03 16:00:00+03
KBK-20261102-0005	bread	2026-11-03 16:00:00+03
KBK-20261103-0001	bread	2026-11-04 09:00:00+03
\.


--
-- TOC entry 5000 (class 0 OID 16943)
-- Dependencies: 225
-- Data for Name: order_serial_counter; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.order_serial_counter (day, last_number) FROM stdin;
2026-10-18	1
2026-10-19	2
2026-11-01	1
2026-11-02	5
2026-11-03	1
\.


--
-- TOC entry 4991 (class 0 OID 16850)
-- Dependencies: 216
-- Data for Name: product; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.product (id, name, category, emoji, description, ingredients, allergens, is_custom, sold_out, hidden, image_url, sort_order, created_at, updated_at) FROM stdin;
ck	Celebration Cake	cake	🎂	Iced to order, Ksh 2200/kg. Choose the size, flavour and message for each cake.	{"Wheat flour",Eggs,Butter,Sugar,Milk}	{Gluten,Eggs,Milk}	t	f	f	assets/site/cake-waves.jpg	3	2026-10-12 13:19:21.699167+03	2026-10-12 13:19:21.699167+03
ckb	Everyday Cake	cake	🎂	Our lighter-priced cake line, Ksh 1800/kg.	{"Wheat flour",Eggs,Butter,Sugar,Milk}	{Gluten,Eggs,Milk}	t	f	f	\N	4	2026-10-12 13:19:21.699167+03	2026-10-12 13:19:21.699167+03
ckf	Fruit Cake	cake	🎂	Dense fruit cake, Ksh 2700/kg.	{"Wheat flour","Mixed dried fruit",Eggs,Butter,Sugar}	{Gluten,Eggs,Milk}	t	f	f	\N	5	2026-10-12 13:19:21.699167+03	2026-10-12 13:19:21.699167+03
ckc	Custom / Designer Cake	cake	🎂	Birthday, occasion or designer cakes — final price confirmed by the bakery. Placeholder starting price shown.	{"Wheat flour",Eggs,Butter,Sugar,Milk}	{Gluten,Eggs,Milk}	t	f	f	assets/site/cake-thank-you.jpg	6	2026-10-12 13:19:21.699167+03	2026-10-12 13:19:21.699167+03
qc	Queen Cakes	pastry	🧁	Small individual sponge cakes.	{"Wheat flour",Eggs,Butter,Sugar}	{Gluten,Eggs,Milk}	f	f	f	assets/site/queen-cakes.jpg	7	2026-10-12 13:19:21.699167+03	2026-10-12 13:19:21.699167+03
scn	Scones	pastry	🥐	Classic plain scones.	{"Wheat flour",Butter,Milk,Sugar}	{Gluten,Milk}	f	f	f	\N	8	2026-10-12 13:19:21.699167+03	2026-10-12 13:19:21.699167+03
rgb	Ring Buns	pastry	🥯	Ring-shaped sweet buns.	{"Wheat flour",Yeast,Sugar,Butter}	{Gluten,Milk}	f	f	f	\N	9	2026-10-12 13:19:21.699167+03	2026-10-12 13:19:21.699167+03
rdb	Round Buns	pastry	🥯	Soft round buns.	{"Wheat flour",Yeast,Sugar,Butter}	{Gluten,Milk}	f	f	f	assets/site/bread-buns-crate.jpg	10	2026-10-12 13:19:21.699167+03	2026-10-12 13:19:21.699167+03
lr	Long Rolls	pastry	🥖	Long bread rolls.	{"Wheat flour",Yeast,Salt}	{Gluten}	f	f	f	assets/site/long-rolls.jpg	11	2026-10-12 13:19:21.699167+03	2026-10-12 13:19:21.699167+03
dn	Doughnuts	pastry	🍩	Classic sugared doughnuts.	{"Wheat flour",Sugar,Eggs,Oil}	{Gluten,Eggs}	f	f	f	assets/site/donuts-tray.jpg	12	2026-10-12 13:19:21.699167+03	2026-10-12 13:19:21.699167+03
mad	Madeira Cake	pastry	🍰	Classic dense Madeira loaf cake.	{"Wheat flour",Eggs,Butter,Sugar}	{Gluten,Eggs,Milk}	f	f	f	\N	13	2026-10-12 13:19:21.699167+03	2026-10-12 13:19:21.699167+03
tsc	Tea Scones	pastry	🥐	Scones sized for tea time.	{"Wheat flour",Butter,Milk,Sugar}	{Gluten,Milk}	f	f	f	\N	14	2026-10-12 13:19:21.699167+03	2026-10-12 13:19:21.699167+03
crs	Croissants	pastry	🥐	Buttery, flaky croissants.	{"Wheat flour",Butter,Yeast}	{Gluten,Milk}	f	f	f	\N	15	2026-10-12 13:19:21.699167+03	2026-10-12 13:19:21.699167+03
ckie	Cookies	pastry	🍪	Classic baked cookies.	{"Wheat flour",Butter,Sugar,Eggs}	{Gluten,Eggs,Milk}	f	f	f	\N	17	2026-10-12 13:19:21.699167+03	2026-10-12 13:19:21.699167+03
dan	Danish Pastries	pastry	🥐	Flaky Danish pastry.	{"Wheat flour",Butter,Sugar}	{Gluten,Milk}	f	f	f	\N	18	2026-10-12 13:19:21.699167+03	2026-10-12 13:19:21.699167+03
wb	White Bread	bread	🍞	Soft daily-baked white loaf.	{"Wheat flour",Yeast,Sugar,Salt,Milk}	{Gluten,Milk}	f	f	f	assets/site/kelvin-loaf-packs.jpg	1	2026-10-12 13:19:21.699167+03	2026-10-12 13:19:21.699167+03
bb	Brown Bread	bread	🍞	Wholemeal loaf, lightly sweetened.	{"Wheat flour","Whole wheat",Yeast,Sugar,Salt}	{Gluten}	f	f	f	assets/site/bread-loaves.jpg	2	2026-10-12 13:19:21.699167+03	2026-10-12 13:19:21.699167+03
sausage-rolls	Sausage Rolls	pastry	🌭	Savoury sausage-filled pastry.	{"Wheat flour","Sausage meat",Butter}	{Gluten}	t	f	f		0	2026-10-19 02:22:37.141421+03	2026-10-19 02:22:37.141421+03
\.


--
-- TOC entry 4993 (class 0 OID 16881)
-- Dependencies: 218
-- Data for Name: product_flavour; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.product_flavour (product_id, flavour, sort_order) FROM stdin;
ck	Mint chocolate	1
ck	Red velvet	2
ck	Chocolate	3
ck	Carrot	4
ck	Blueberry	5
ck	Butterscotch	6
ck	Bubblegum	7
ck	Lemon	8
ck	Cappuccino	9
ck	Chocolate fudge	10
ck	White forest	11
ck	Banana	12
ck	Marble	13
ck	Black forest	14
ck	Toffee	15
ck	Pinacolada	16
ckb	Vanilla	1
ckb	Strawberry	2
ckb	Marble	3
ckf	Classic	1
ckc	To discuss with bakery	1
\.


--
-- TOC entry 4994 (class 0 OID 16894)
-- Dependencies: 219
-- Data for Name: product_notice_rule; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.product_notice_rule (product_id, over_qty, notice_hours) FROM stdin;
wb	25	24
wb	50	48
bb	25	24
bb	50	48
ck	0	24
ck	2	48
ckb	0	24
ckb	2	48
ckf	0	24
ckf	2	48
ckc	0	24
ckc	2	48
qc	5	24
qc	10	48
scn	5	24
scn	10	48
rgb	5	24
rgb	10	48
rdb	5	24
rdb	10	48
lr	5	24
lr	10	48
dn	5	24
dn	10	48
mad	5	24
mad	10	48
tsc	5	24
tsc	10	48
crs	5	24
crs	10	48
ckie	5	24
ckie	10	48
dan	5	24
dan	10	48
\.


--
-- TOC entry 4992 (class 0 OID 16867)
-- Dependencies: 217
-- Data for Name: product_size; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.product_size (product_id, size_id, label, price, sort_order) FROM stdin;
ck	1kg	1 kg (8–10 people)	2200.00	1
ck	2kg	2 kg (16–20 people)	4400.00	2
ck	3kg	3 kg (24–30 people)	6600.00	3
ckb	1kg	1 kg (8–10 people)	1800.00	1
ckb	2kg	2 kg (16–20 people)	3600.00	2
ckb	3kg	3 kg (24–30 people)	5400.00	3
ckf	1kg	1 kg (8–10 people)	2700.00	1
ckf	2kg	2 kg (16–20 people)	5400.00	2
ckf	3kg	3 kg (24–30 people)	8100.00	3
ckc	1kg	1 kg (starting price)	3000.00	1
qc	each	Each	25.00	1
qc	packet	Packet of 9 (placeholder qty)	225.00	2
scn	each	Each	13.00	1
scn	packet	Packet of 20 (placeholder qty)	260.00	2
rgb	each	Each	8.00	1
rgb	packet	Packet of 12 (placeholder qty)	95.00	2
rdb	each	Each	15.00	1
rdb	packet	Packet of 6 (placeholder qty)	90.00	2
lr	each	Each	15.00	1
dn	each	Each	15.00	1
dn	packet	Packet of 6 (placeholder qty)	90.00	2
mad	470g	470g	130.00	1
mad	1kg	1kg	270.00	2
tsc	each	Each	35.00	1
tsc	packet	Packet of 6 (placeholder qty)	225.00	2
crs	each	Each	50.00	1
ckie	each	Each	20.00	1
ckie	packet	Packet of 10 (placeholder qty)	200.00	2
dan	each	Each	55.00	1
wb	200g	200g	35.00	0
wb	400g	400g	63.00	1
wb	800g	800g	123.00	2
bb	200g	200g	35.00	0
bb	400g	400g	63.00	1
bb	800g	800g	123.00	2
sausage-rolls	s0	Each	55.00	0
\.


--
-- TOC entry 4995 (class 0 OID 16908)
-- Dependencies: 220
-- Data for Name: schedule_setting; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.schedule_setting (id, open_hour, close_hour, daily_capacity) FROM stdin;
1	8	18	20
\.


--
-- TOC entry 4999 (class 0 OID 16933)
-- Dependencies: 224
-- Data for Name: staff; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.staff (id, name, username, password_hash, role, created_at) FROM stdin;
1	Amina Wafula	amina	$2a$10$LNK1w8ji49GXpHdde7bJbuGgh30xv92ITuFfcRYBlUC/kfHijP9fS	manager	2026-10-12 13:19:21.699167+03
3	Supervisor	supervisor	$2a$10$mWkn/a17x7.1BecxctDCMeEzgMpcLx9tcfEO207nvkng/dPv87PfG	supervisor	2026-10-12 13:19:21.699167+03
4	Peter Otieno	peter	$2a$10$pyt1T.lW6aJe4jLj7hlkVOTaZ2Mkf6UfxxjjTy3A.4Kktc4XdDuDy	baker	2026-10-12 13:19:21.699167+03
5	Paul Kaiba	paulk	$2y$10$.K9ari1drI.AC4.ds.llkui4p2H33dIgC//bMQutOca2BP52vijrW	manager	2026-10-19 12:09:29.535607+03
\.


--
-- TOC entry 5024 (class 0 OID 0)
-- Dependencies: 223
-- Name: staff_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.staff_id_seq', 5, true);


--
-- TOC entry 4826 (class 2606 OID 16931)
-- Name: closed_date closed_date_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.closed_date
    ADD CONSTRAINT closed_date_pkey PRIMARY KEY (closed_on);


--
-- TOC entry 4824 (class 2606 OID 16924)
-- Name: closed_weekday closed_weekday_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.closed_weekday
    ADD CONSTRAINT closed_weekday_pkey PRIMARY KEY (weekday);


--
-- TOC entry 4835 (class 2606 OID 16967)
-- Name: customer_order customer_order_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_order
    ADD CONSTRAINT customer_order_pkey PRIMARY KEY (serial);


--
-- TOC entry 4839 (class 2606 OID 16994)
-- Name: order_line order_line_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_line
    ADD CONSTRAINT order_line_pkey PRIMARY KEY (id);


--
-- TOC entry 4837 (class 2606 OID 16977)
-- Name: order_pickup order_pickup_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_pickup
    ADD CONSTRAINT order_pickup_pkey PRIMARY KEY (serial, bucket);


--
-- TOC entry 4831 (class 2606 OID 16948)
-- Name: order_serial_counter order_serial_counter_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_serial_counter
    ADD CONSTRAINT order_serial_counter_pkey PRIMARY KEY (day);


--
-- TOC entry 4818 (class 2606 OID 16888)
-- Name: product_flavour product_flavour_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_flavour
    ADD CONSTRAINT product_flavour_pkey PRIMARY KEY (product_id, flavour);


--
-- TOC entry 4820 (class 2606 OID 16902)
-- Name: product_notice_rule product_notice_rule_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_notice_rule
    ADD CONSTRAINT product_notice_rule_pkey PRIMARY KEY (product_id, over_qty);


--
-- TOC entry 4814 (class 2606 OID 16866)
-- Name: product product_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_pkey PRIMARY KEY (id);


--
-- TOC entry 4816 (class 2606 OID 16875)
-- Name: product_size product_size_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_size
    ADD CONSTRAINT product_size_pkey PRIMARY KEY (product_id, size_id);


--
-- TOC entry 4822 (class 2606 OID 16918)
-- Name: schedule_setting schedule_setting_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schedule_setting
    ADD CONSTRAINT schedule_setting_pkey PRIMARY KEY (id);


--
-- TOC entry 4828 (class 2606 OID 16941)
-- Name: staff staff_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_pkey PRIMARY KEY (id);


--
-- TOC entry 4832 (class 1259 OID 16968)
-- Name: customer_order_phone_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX customer_order_phone_idx ON public.customer_order USING btree (customer_phone);


--
-- TOC entry 4833 (class 1259 OID 16969)
-- Name: customer_order_pickup_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX customer_order_pickup_idx ON public.customer_order USING btree (earliest_pickup);


--
-- TOC entry 4840 (class 1259 OID 17006)
-- Name: order_line_product_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX order_line_product_idx ON public.order_line USING btree (product_id);


--
-- TOC entry 4841 (class 1259 OID 17005)
-- Name: order_line_serial_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX order_line_serial_idx ON public.order_line USING btree (serial);


--
-- TOC entry 4829 (class 1259 OID 16942)
-- Name: staff_username_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX staff_username_unique ON public.staff USING btree (lower(username));


--
-- TOC entry 4846 (class 2606 OID 17000)
-- Name: order_line order_line_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_line
    ADD CONSTRAINT order_line_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.product(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- TOC entry 4847 (class 2606 OID 16995)
-- Name: order_line order_line_serial_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_line
    ADD CONSTRAINT order_line_serial_fkey FOREIGN KEY (serial) REFERENCES public.customer_order(serial) ON DELETE CASCADE;


--
-- TOC entry 4845 (class 2606 OID 16978)
-- Name: order_pickup order_pickup_serial_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_pickup
    ADD CONSTRAINT order_pickup_serial_fkey FOREIGN KEY (serial) REFERENCES public.customer_order(serial) ON DELETE CASCADE;


--
-- TOC entry 4843 (class 2606 OID 16889)
-- Name: product_flavour product_flavour_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_flavour
    ADD CONSTRAINT product_flavour_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.product(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- TOC entry 4844 (class 2606 OID 16903)
-- Name: product_notice_rule product_notice_rule_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_notice_rule
    ADD CONSTRAINT product_notice_rule_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.product(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- TOC entry 4842 (class 2606 OID 16876)
-- Name: product_size product_size_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_size
    ADD CONSTRAINT product_size_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.product(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- TOC entry 5010 (class 0 OID 0)
-- Dependencies: 265
-- Name: FUNCTION next_order_serial(p_day date); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.next_order_serial(p_day date) TO kch_app;


--
-- TOC entry 5011 (class 0 OID 0)
-- Dependencies: 222
-- Name: TABLE closed_date; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.closed_date TO kch_app;


--
-- TOC entry 5012 (class 0 OID 0)
-- Dependencies: 221
-- Name: TABLE closed_weekday; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.closed_weekday TO kch_app;


--
-- TOC entry 5013 (class 0 OID 0)
-- Dependencies: 226
-- Name: TABLE customer_order; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.customer_order TO kch_app;


--
-- TOC entry 5014 (class 0 OID 0)
-- Dependencies: 228
-- Name: TABLE order_line; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.order_line TO kch_app;


--
-- TOC entry 5015 (class 0 OID 0)
-- Dependencies: 227
-- Name: TABLE order_pickup; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.order_pickup TO kch_app;


--
-- TOC entry 5016 (class 0 OID 0)
-- Dependencies: 225
-- Name: TABLE order_serial_counter; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.order_serial_counter TO kch_app;


--
-- TOC entry 5017 (class 0 OID 0)
-- Dependencies: 216
-- Name: TABLE product; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.product TO kch_app;


--
-- TOC entry 5018 (class 0 OID 0)
-- Dependencies: 218
-- Name: TABLE product_flavour; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.product_flavour TO kch_app;


--
-- TOC entry 5019 (class 0 OID 0)
-- Dependencies: 219
-- Name: TABLE product_notice_rule; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.product_notice_rule TO kch_app;


--
-- TOC entry 5020 (class 0 OID 0)
-- Dependencies: 217
-- Name: TABLE product_size; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.product_size TO kch_app;


--
-- TOC entry 5021 (class 0 OID 0)
-- Dependencies: 220
-- Name: TABLE schedule_setting; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.schedule_setting TO kch_app;


--
-- TOC entry 5022 (class 0 OID 0)
-- Dependencies: 224
-- Name: TABLE staff; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.staff TO kch_app;


--
-- TOC entry 5023 (class 0 OID 0)
-- Dependencies: 223
-- Name: SEQUENCE staff_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.staff_id_seq TO kch_app;


-- Completed on 2026-11-04 00:43:43

--
-- PostgreSQL database dump complete
--

