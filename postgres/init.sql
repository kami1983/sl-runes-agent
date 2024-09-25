CREATE TABLE tokens (
  symbol TEXT PRIMARY KEY,
  canister TEXT NOT NULL,
  re_minimum_each TEXT NOT NULL,
  fee_ratio numeric NOT NULL,
  fee_address TEXT NOT NULL,
  create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX tokens_canister_idx ON public.tokens (canister);

CREATE TABLE rbot_settings (
  uid bigint PRIMARY KEY,
  language text NOT NULL
);

-- CREATE TABLE re_status (
--   id bigint PRIMARY KEY,
--   rune text NOT NULL,
--   uid bigint NOT NULL,
--   amount text NOT NULL,
--   count int4 NOT NULL,
--   expire_at text NOT NULL,
--   fee_amount text NOT NULL,
--   is_sent bool DEFAULT FALSE,
--   is_revoked bool DEFAULT FALSE,
--   is_done bool DEFAULT FALSE,
--   receiver TEXT,
--   send_time TIMESTAMP,
--   create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
-- );
-- CREATE INDEX re_status_send_time_idx ON public.re_status (send_time);

CREATE TABLE re_status(
    id bigint NOT NULL,
    rune text NOT NULL,
    uid bigint NOT NULL,
    amount text NOT NULL,
    count integer NOT NULL,
    expire_at text NOT NULL,
    fee_amount text NOT NULL,
    is_sent boolean DEFAULT false,
    is_revoked boolean DEFAULT false,
    is_done boolean DEFAULT false,
    receiver text,
    send_time timestamp without time zone,
    create_time timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    owner varchar(255),
    token_id varchar(255),
    is_random boolean,
    memo text,
    PRIMARY KEY(id)
);
CREATE INDEX re_status_send_time_idx ON re_status USING btree ("send_time");

CREATE TABLE snatch_status (
  id bigint NOT NULL,
  uid bigint NOT NULL,
  code int8 DEFAULT -1 NOT NULL,
  amount text NOT NULL,
  discard int8 DEFAULT 0 NOT NULL,
  create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_id_uid UNIQUE (id, uid)
);
CREATE INDEX snatch_status_create_time_idx ON public.snatch_status (create_time);

CREATE TABLE wallets (
  uid bigint PRIMARY KEY,
  principal TEXT NOT NULL,
  create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  channel bigint
);
CREATE INDEX wallets_create_time_idx ON public.wallets (create_time);

CREATE TABLE users (
  uid bigint PRIMARY KEY,
  username text,
  update_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE sl_location(  
    id bigint NOT NULL PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    rid bigint NOT NULL,
    location TEXT NOT NULL,
    status int8 DEFAULT 0 NOT NULL,
    create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX sl_location_create_time_idx ON public.sl_location (create_time);
CREATE INDEX sl_location_update_time_idx ON public.sl_location (update_time);
ALTER TABLE sl_location ADD CONSTRAINT unique_location_rid UNIQUE (rid);

CREATE TABLE global_vars (  
    id int NOT NULL PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    name VARCHAR(255),
    global_key VARCHAR(225) NOT NULL,
    global_value TEXT,
    status int8 DEFAULT 0 NOT NULL,
    UNIQUE (global_key)
);

