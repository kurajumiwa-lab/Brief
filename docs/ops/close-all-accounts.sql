-- =====================================================================
-- Brief: close every account (accounts only; business records are kept)
-- =====================================================================
--
-- What this does, in plain words:
--   * Every account can no longer sign in (password replaced with a value
--     that can never match, the same way the app closes a single account).
--   * Each account's name, email, phone, address, tax and registration
--     details are removed.
--   * Stock is set to zero and business claims are withdrawn, so nothing
--     advertises a business that has been closed.
--   * Trade history, payments, ledgers and orders are KEPT, attached to an
--     anonymous account id. Deleting them would break the audit trail.
--
-- What this does NOT do (look at these separately if they matter to you):
--   * Chat messages and posts (chat, social, outside, park) have their TEXT
--     replaced with "Removed". Attachments and shared deal details are
--     cleared. The rows themselves stay, so the structure is intact.
--   * Reviews, notifications, uploaded image and voice files (media_objects)
--     are NOT changed by this script. Ask for them separately if needed.
--
-- HOW TO RUN (Supabase website, SQL Editor, on your phone):
--   1. Take a backup first (Database -> Backups).
--   2. Paste and run SECTION 1 alone. Check the number it shows.
--   3. Paste and run SECTION 2 (everything from BEGIN to COMMIT).
--   4. Run SECTION 3. Every number must be 0.
--
-- Safe to run twice. Accounts already closed are skipped.
-- =====================================================================


-- ---------------------------------------------------------------------
-- SECTION 1 — preview (read only, changes nothing)
-- ---------------------------------------------------------------------
SELECT count(*) AS accounts_to_close
FROM vendors
WHERE vendor_handle NOT LIKE 'closed\_%';

SELECT
  (SELECT count(*) FROM chat_messages)        AS chat_messages_to_clear,
  (SELECT count(*) FROM social_posts)         AS social_posts_to_clear,
  (SELECT count(*) FROM outside_posts)        AS outside_posts_to_clear,
  (SELECT count(*) FROM caesar_park_posts)    AS park_posts_to_clear;


-- ---------------------------------------------------------------------
-- SECTION 2 — apply (all or nothing)
-- ---------------------------------------------------------------------
BEGIN;

CREATE TEMP TABLE _to_close ON COMMIT DROP AS
SELECT id FROM vendors WHERE vendor_handle NOT LIKE 'closed\_%';

-- Identity: same fields the app clears when one account closes.
-- The id-based values are unique and reveal nothing about the person.
UPDATE vendors v SET
  vendor_handle        = 'closed_' || substr(replace(v.id::text, '-', ''), 1, 12),
  business_name        = 'Closed account',
  email                = 'closed_' || substr(replace(v.id::text, '-', ''), 1, 12) || '@closed.invalid',
  phone                = NULL,
  physical_location    = NULL,
  business_description = NULL,
  business_categories  = '[]'::jsonb,
  home_storefront_config = '{}'::jsonb,
  allow_direct_calls   = false,
  hide_exact_location  = true,
  geo_lat              = NULL,
  geo_lng              = NULL,
  password_hash        = '!closed'
WHERE v.id IN (SELECT id FROM _to_close);

-- Business profile: registration, tax and address details.
UPDATE vendor_profiles SET
  business_registration = NULL,
  tax_id                = NULL,
  warehouse_address     = NULL,
  operating_hours       = NULL
WHERE vendor_id IN (SELECT id FROM _to_close);

-- Withdraw what would advertise a business that no longer exists.
UPDATE stock_items SET quantity_available = 0
WHERE vendor_id IN (SELECT id FROM _to_close);

UPDATE business_claims SET status = 'withdrawn'
WHERE vendor_id IN (SELECT id FROM _to_close);

-- Membership: remove personal details and take them out of the directory.
UPDATE member_profiles SET
  display_name        = NULL,
  category            = NULL,
  professional_class  = NULL,
  bio                 = NULL,
  directory_visible   = false,
  show_contact        = false,
  membership_status   = 'suspended'
WHERE vendor_id IN (SELECT id FROM _to_close);

-- Messages and posts: replace the text, clear attachments and shared details.
-- Text must stay non-empty because the database requires it.
UPDATE chat_messages SET
  content       = 'Removed',
  attachments   = NULL,
  deal_data     = NULL,
  shared_stock_id = NULL,
  is_pinned     = false;

UPDATE social_posts SET
  body      = 'Removed',
  image_url = NULL,
  status    = 'removed';

UPDATE outside_posts SET
  title     = NULL,
  body      = 'Removed by Brief',
  media     = '[]'::jsonb,
  tags      = '[]'::jsonb,
  location  = NULL,
  geo_lat   = NULL,
  geo_lng   = NULL,
  status    = 'removed';

UPDATE caesar_park_posts SET
  body   = 'Removed',
  status = 'removed';

COMMIT;


-- ---------------------------------------------------------------------
-- SECTION 3 — check (every number must be 0)
-- ---------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM vendors WHERE vendor_handle NOT LIKE 'closed\_%')   AS still_open,
  (SELECT count(*) FROM chat_messages WHERE content <> 'Removed')            AS messages_not_cleared,
  (SELECT count(*) FROM social_posts WHERE status <> 'removed')              AS social_posts_not_cleared,
  (SELECT count(*) FROM outside_posts WHERE status <> 'removed')             AS outside_posts_not_cleared,
  (SELECT count(*) FROM caesar_park_posts WHERE status <> 'removed')         AS park_posts_not_cleared;
