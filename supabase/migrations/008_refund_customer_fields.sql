alter table if exists refund_request
  add column if not exists customer_name text,
  add column if not exists customer_email text;

create index if not exists refund_request_customer_email_idx
  on refund_request(customer_email);
