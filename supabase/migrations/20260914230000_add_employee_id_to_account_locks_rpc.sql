DROP FUNCTION IF EXISTS public.get_account_locks_for_admin(uuid);

CREATE FUNCTION public.get_account_locks_for_admin(p_admin_id uuid)
RETURNS TABLE (
  id uuid,
  identifier text,
  identifier_type text,
  lock_until timestamptz,
  lock_reason text,
  failed_attempts integer,
  created_at timestamptz,
  unlocked_at timestamptz,
  unlocked_by uuid,
  user_id uuid,
  username text,
  employee_id text,
  admin_username text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_role text;
BEGIN
  SELECT role
  INTO v_admin_role
  FROM public.admins
  WHERE admins.id = p_admin_id;

  IF v_admin_role IN ('super_admin', 'emergency_admin') THEN
    RETURN QUERY
    SELECT
      al.id,
      al.identifier,
      al.identifier_type,
      al.lock_until,
      al.lock_reason,
      al.failed_attempts,
      al.created_at,
      al.unlocked_at,
      al.unlocked_by,
      al.user_id,
      u.username,
      u.employee_id,
      a.username AS admin_username
    FROM public.account_locks al
    LEFT JOIN public.users u ON al.user_id = u.id
    LEFT JOIN public.admins a ON u.admin_id = a.id
    WHERE al.unlocked_at IS NULL
      AND al.lock_until > now()
    ORDER BY al.created_at DESC;
  ELSE
    RETURN QUERY
    SELECT
      al.id,
      al.identifier,
      al.identifier_type,
      al.lock_until,
      al.lock_reason,
      al.failed_attempts,
      al.created_at,
      al.unlocked_at,
      al.unlocked_by,
      al.user_id,
      u.username,
      u.employee_id,
      a.username AS admin_username
    FROM public.account_locks al
    LEFT JOIN public.users u ON al.user_id = u.id
    LEFT JOIN public.admins a ON u.admin_id = a.id
    WHERE al.unlocked_at IS NULL
      AND al.lock_until > now()
      AND (
        al.identifier_type = 'ip'
        OR (al.identifier_type = 'username' AND u.admin_id = p_admin_id)
      )
    ORDER BY al.created_at DESC;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_account_locks_for_admin(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.get_account_locks_for_admin IS 'Returns active account lock records with the employee ID for username locks.';
