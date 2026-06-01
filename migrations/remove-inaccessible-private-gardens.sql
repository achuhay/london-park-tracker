-- Remove Private Garden parks that are not freely publicly accessible.
-- Keeps the 31 entries where open_to_public = 'Yes'.
-- Removes 193 parks: No (123), Occasionally (49), By appointment only (9),
-- Partially (10), to check (2).
DELETE FROM parks
WHERE site_type ILIKE '%private garden%'
AND open_to_public != 'Yes';
