-- ONE-TIME LOCAL DEVELOPMENT BOOTSTRAP ONLY.
-- 1) Register an account through Schedula so that users.id exists.
-- 2) Replace the email below with that account's exact email.
-- 3) Run as the PostgreSQL database owner against your local/dev database.
-- Never expose the DB owner credentials or use this to grant public admin access.
BEGIN;
INSERT INTO user_roles (user_id, role)
SELECT id, 'ADMIN'::app_role
FROM users
WHERE lower(email) = lower('replace-with-your-account@example.com')
ON CONFLICT (user_id, role) DO NOTHING;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_roles WHERE role = 'ADMIN') THEN
    RAISE EXCEPTION 'No ADMIN role was created. Confirm that the email matches an existing user.';
  END IF;
END
$$;
COMMIT;
