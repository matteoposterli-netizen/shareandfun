-- Admin section: dedicated `admins` table + helper + full-access RLS policies.
-- Admins are auth.users whose id is listed in public.admins. They are NOT
-- profiles (they do not have a business role of proprietario/stagionale).
-- Create admins manually via the Supabase dashboard:
--   1) Authentication → Users → Add user (email+password)
--   2) SQL: INSERT INTO public.admins (user_id) VALUES ('<uuid-from-step-1>');

CREATE TABLE IF NOT EXISTS public.admins (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

-- An admin can see their own row (used by the client to verify admin status
-- after login). No insert/update/delete policies: admin provisioning is
-- service-role only, via the Supabase dashboard.
DROP POLICY IF EXISTS admins_self_select ON public.admins;
CREATE POLICY admins_self_select ON public.admins
  FOR SELECT USING (user_id = (SELECT auth.uid()));

-- Helper: SECURITY DEFINER so it can read public.admins without being
-- blocked by RLS when called from other policies.
CREATE OR REPLACE FUNCTION public.is_admin(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.admins WHERE user_id = uid);
$$;

REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;

-- ============================================================
-- Admin-full-access policies (one per table/command).
-- These are additive: an admin passes if `is_admin(auth.uid())` is true;
-- non-admin users continue to go through the existing business policies.
-- ============================================================

-- profiles
DROP POLICY IF EXISTS profiles_admin_select ON public.profiles;
DROP POLICY IF EXISTS profiles_admin_insert ON public.profiles;
DROP POLICY IF EXISTS profiles_admin_update ON public.profiles;
DROP POLICY IF EXISTS profiles_admin_delete ON public.profiles;
CREATE POLICY profiles_admin_select ON public.profiles
  FOR SELECT USING (public.is_admin((SELECT auth.uid())));
CREATE POLICY profiles_admin_insert ON public.profiles
  FOR INSERT WITH CHECK (public.is_admin((SELECT auth.uid())));
CREATE POLICY profiles_admin_update ON public.profiles
  FOR UPDATE USING (public.is_admin((SELECT auth.uid())))
  WITH CHECK (public.is_admin((SELECT auth.uid())));
CREATE POLICY profiles_admin_delete ON public.profiles
  FOR DELETE USING (public.is_admin((SELECT auth.uid())));

-- stabilimenti
DROP POLICY IF EXISTS stabilimenti_admin_select ON public.stabilimenti;
DROP POLICY IF EXISTS stabilimenti_admin_insert ON public.stabilimenti;
DROP POLICY IF EXISTS stabilimenti_admin_update ON public.stabilimenti;
DROP POLICY IF EXISTS stabilimenti_admin_delete ON public.stabilimenti;
CREATE POLICY stabilimenti_admin_select ON public.stabilimenti
  FOR SELECT USING (public.is_admin((SELECT auth.uid())));
CREATE POLICY stabilimenti_admin_insert ON public.stabilimenti
  FOR INSERT WITH CHECK (public.is_admin((SELECT auth.uid())));
CREATE POLICY stabilimenti_admin_update ON public.stabilimenti
  FOR UPDATE USING (public.is_admin((SELECT auth.uid())))
  WITH CHECK (public.is_admin((SELECT auth.uid())));
CREATE POLICY stabilimenti_admin_delete ON public.stabilimenti
  FOR DELETE USING (public.is_admin((SELECT auth.uid())));

-- ombrelloni
DROP POLICY IF EXISTS ombrelloni_admin_select ON public.ombrelloni;
DROP POLICY IF EXISTS ombrelloni_admin_insert ON public.ombrelloni;
DROP POLICY IF EXISTS ombrelloni_admin_update ON public.ombrelloni;
DROP POLICY IF EXISTS ombrelloni_admin_delete ON public.ombrelloni;
CREATE POLICY ombrelloni_admin_select ON public.ombrelloni
  FOR SELECT USING (public.is_admin((SELECT auth.uid())));
CREATE POLICY ombrelloni_admin_insert ON public.ombrelloni
  FOR INSERT WITH CHECK (public.is_admin((SELECT auth.uid())));
CREATE POLICY ombrelloni_admin_update ON public.ombrelloni
  FOR UPDATE USING (public.is_admin((SELECT auth.uid())))
  WITH CHECK (public.is_admin((SELECT auth.uid())));
CREATE POLICY ombrelloni_admin_delete ON public.ombrelloni
  FOR DELETE USING (public.is_admin((SELECT auth.uid())));

-- clienti_stagionali
DROP POLICY IF EXISTS clienti_stagionali_admin_select ON public.clienti_stagionali;
DROP POLICY IF EXISTS clienti_stagionali_admin_insert ON public.clienti_stagionali;
DROP POLICY IF EXISTS clienti_stagionali_admin_update ON public.clienti_stagionali;
DROP POLICY IF EXISTS clienti_stagionali_admin_delete ON public.clienti_stagionali;
CREATE POLICY clienti_stagionali_admin_select ON public.clienti_stagionali
  FOR SELECT USING (public.is_admin((SELECT auth.uid())));
CREATE POLICY clienti_stagionali_admin_insert ON public.clienti_stagionali
  FOR INSERT WITH CHECK (public.is_admin((SELECT auth.uid())));
CREATE POLICY clienti_stagionali_admin_update ON public.clienti_stagionali
  FOR UPDATE USING (public.is_admin((SELECT auth.uid())))
  WITH CHECK (public.is_admin((SELECT auth.uid())));
CREATE POLICY clienti_stagionali_admin_delete ON public.clienti_stagionali
  FOR DELETE USING (public.is_admin((SELECT auth.uid())));

-- disponibilita
DROP POLICY IF EXISTS disponibilita_admin_select ON public.disponibilita;
DROP POLICY IF EXISTS disponibilita_admin_insert ON public.disponibilita;
DROP POLICY IF EXISTS disponibilita_admin_update ON public.disponibilita;
DROP POLICY IF EXISTS disponibilita_admin_delete ON public.disponibilita;
CREATE POLICY disponibilita_admin_select ON public.disponibilita
  FOR SELECT USING (public.is_admin((SELECT auth.uid())));
CREATE POLICY disponibilita_admin_insert ON public.disponibilita
  FOR INSERT WITH CHECK (public.is_admin((SELECT auth.uid())));
CREATE POLICY disponibilita_admin_update ON public.disponibilita
  FOR UPDATE USING (public.is_admin((SELECT auth.uid())))
  WITH CHECK (public.is_admin((SELECT auth.uid())));
CREATE POLICY disponibilita_admin_delete ON public.disponibilita
  FOR DELETE USING (public.is_admin((SELECT auth.uid())));

-- transazioni
DROP POLICY IF EXISTS transazioni_admin_select ON public.transazioni;
DROP POLICY IF EXISTS transazioni_admin_insert ON public.transazioni;
DROP POLICY IF EXISTS transazioni_admin_update ON public.transazioni;
DROP POLICY IF EXISTS transazioni_admin_delete ON public.transazioni;
CREATE POLICY transazioni_admin_select ON public.transazioni
  FOR SELECT USING (public.is_admin((SELECT auth.uid())));
CREATE POLICY transazioni_admin_insert ON public.transazioni
  FOR INSERT WITH CHECK (public.is_admin((SELECT auth.uid())));
CREATE POLICY transazioni_admin_update ON public.transazioni
  FOR UPDATE USING (public.is_admin((SELECT auth.uid())))
  WITH CHECK (public.is_admin((SELECT auth.uid())));
CREATE POLICY transazioni_admin_delete ON public.transazioni
  FOR DELETE USING (public.is_admin((SELECT auth.uid())));
