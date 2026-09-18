CREATE OR REPLACE FUNCTION public.get_employee_management_snapshot(
  p_admin_session_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_admin_id uuid;
  v_admin_role text;
  v_result jsonb;
BEGIN
  SELECT context.admin_id, context.admin_role
  INTO v_admin_id, v_admin_role
  FROM private.get_financial_admin_context(p_admin_session_token) AS context;

  WITH scoped_admins AS (
    SELECT
      a.id,
      a.username,
      a.role,
      COALESCE(a.is_pinned, false) AS is_pinned
    FROM public.admins AS a
    WHERE (v_admin_role = 'super_admin' AND a.role <> 'emergency_admin')
      OR (v_admin_role = 'secondary_admin' AND a.id = v_admin_id)
  ),
  scoped_users AS (
    SELECT u.*
    FROM public.users AS u
    INNER JOIN scoped_admins AS a ON a.id = u.created_by
  ),
  wallet_stats AS (
    SELECT
      w.user_id,
      COALESCE(w.available_balance, 0) AS available_balance,
      COALESCE(w.frozen_balance, 0) AS frozen_balance
    FROM public.wallets AS w
    INNER JOIN scoped_users AS u ON u.id = w.user_id
  ),
  latest_verifications AS (
    SELECT DISTINCT ON (vr.user_id)
      vr.user_id,
      vr.real_name,
      vr.wallet_address,
      vr.phone,
      vr.email
    FROM public.verification_requests AS vr
    INNER JOIN scoped_users AS u ON u.id = vr.user_id
    WHERE vr.status = 'approved'
    ORDER BY vr.user_id, vr.created_at DESC NULLS LAST, vr.id DESC
  ),
  order_stats AS (
    SELECT
      o.user_id,
      COUNT(*)::bigint AS total_orders,
      COUNT(*) FILTER (
        WHERE o.created_at >= date_trunc('day', now())
      )::bigint AS today_orders,
      COUNT(*) FILTER (
        WHERE o.status = 'success'
          AND o.created_at >= date_trunc('day', now())
      )::bigint AS today_completed_orders,
      COUNT(*) FILTER (
        WHERE o.status = 'failure'
          AND o.created_at >= date_trunc('day', now())
      )::bigint AS failed_orders,
      COUNT(DISTINCT (o.created_at AT TIME ZONE 'UTC')::date)::bigint AS work_days
    FROM public.orders AS o
    INNER JOIN scoped_users AS u ON u.id = o.user_id
    GROUP BY o.user_id
  ),
  commission_stats AS (
    SELECT
      wt.user_id,
      COALESCE(SUM(wt.amount), 0) AS today_commission
    FROM public.wallet_transactions AS wt
    INNER JOIN scoped_users AS u ON u.id = wt.user_id
    WHERE wt.type = 'commission'
      AND wt.created_at >= date_trunc('day', now())
    GROUP BY wt.user_id
  ),
  pending_withdrawal_stats AS (
    SELECT
      w.user_id,
      SUM(w.amount) AS pending_amount,
      MAX(w.created_at) AS pending_date,
      jsonb_agg(
        jsonb_build_object(
          'id', w.id,
          'amount', w.amount,
          'created_at', w.created_at
        )
        ORDER BY w.created_at DESC NULLS LAST, w.id DESC
      ) AS pending_withdrawals
    FROM public.withdrawals AS w
    INNER JOIN scoped_users AS u ON u.id = w.user_id
    WHERE w.status = 'pending'
    GROUP BY w.user_id
  ),
  latest_dispatch_sessions AS (
    SELECT DISTINCT ON (ds.user_id)
      ds.user_id,
      ds.status,
      ds.ended_at,
      ds.last_activity_at
    FROM public.dispatch_sessions AS ds
    INNER JOIN scoped_users AS u ON u.id = ds.user_id
    ORDER BY ds.user_id, ds.started_at DESC NULLS LAST, ds.id DESC
  ),
  work_intervals AS (
    SELECT
      ws.id,
      ws.user_id,
      ws.start_time,
      CASE
        WHEN ws.end_time IS NOT NULL THEN ws.end_time
        WHEN ws.last_heartbeat_at IS NOT NULL
          THEN LEAST(now(), ws.last_heartbeat_at + interval '1 minute')
        ELSE LEAST(now(), ws.start_time + interval '1 minute')
      END AS effective_end
    FROM public.work_sessions AS ws
    INNER JOIN scoped_users AS u ON u.id = ws.user_id
  ),
  valid_work_intervals AS (
    SELECT
      wi.id,
      wi.user_id,
      wi.start_time,
      wi.effective_end,
      MAX(wi.effective_end) OVER (
        PARTITION BY wi.user_id
        ORDER BY wi.start_time, wi.effective_end, wi.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ) AS previous_max_end
    FROM work_intervals AS wi
    WHERE wi.effective_end > wi.start_time
  ),
  marked_work_intervals AS (
    SELECT
      vwi.*,
      CASE
        WHEN vwi.previous_max_end IS NULL OR vwi.start_time > vwi.previous_max_end THEN 1
        ELSE 0
      END AS starts_group
    FROM valid_work_intervals AS vwi
  ),
  grouped_work_intervals AS (
    SELECT
      mwi.*,
      SUM(mwi.starts_group) OVER (
        PARTITION BY mwi.user_id
        ORDER BY mwi.start_time, mwi.effective_end, mwi.id
        ROWS UNBOUNDED PRECEDING
      ) AS group_id
    FROM marked_work_intervals AS mwi
  ),
  merged_work_intervals AS (
    SELECT
      gwi.user_id,
      MIN(gwi.start_time) AS start_time,
      MAX(gwi.effective_end) AS end_time
    FROM grouped_work_intervals AS gwi
    GROUP BY gwi.user_id, gwi.group_id
  ),
  work_time_stats AS (
    SELECT
      mwi.user_id,
      ROUND(SUM(EXTRACT(epoch FROM (mwi.end_time - mwi.start_time))) / 60)::integer AS total_work_minutes,
      ROUND(SUM(
        CASE
          WHEN mwi.end_time > date_trunc('day', now())
            AND mwi.start_time < date_trunc('day', now()) + interval '1 day'
          THEN EXTRACT(epoch FROM (
            LEAST(mwi.end_time, date_trunc('day', now()) + interval '1 day')
            - GREATEST(mwi.start_time, date_trunc('day', now()))
          ))
          ELSE 0
        END
      ) / 60)::integer AS today_work_minutes
    FROM merged_work_intervals AS mwi
    GROUP BY mwi.user_id
  )
  SELECT jsonb_build_object(
    'admins', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'username', a.username,
          'role', a.role,
          'is_pinned', a.is_pinned
        )
        ORDER BY
          CASE WHEN a.role = 'super_admin' THEN 0 ELSE 1 END,
          a.is_pinned DESC,
          a.username,
          a.id
      )
      FROM scoped_admins AS a
    ), '[]'::jsonb),
    'employees', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', u.id,
          'username', u.username,
          'employee_id', u.employee_id,
          'is_verified', u.is_verified,
          'is_active', u.is_active,
          'total_income', u.total_income,
          'first_success_order_date', u.first_success_order_date,
          'created_by', u.created_by,
          'remarks', u.remarks,
          'tags', COALESCE(to_jsonb(u.tags), '[]'::jsonb),
          'is_pinned', COALESCE(u.is_pinned, false),
          'created_at', u.created_at,
          'updated_at', u.updated_at,
          'walletBalance', COALESCE(wallet.available_balance, 0) + COALESCE(wallet.frozen_balance, 0),
          'verification', CASE
            WHEN verification.user_id IS NULL THEN NULL
            ELSE jsonb_build_object(
              'real_name', verification.real_name,
              'wallet_address', verification.wallet_address,
              'phone', verification.phone,
              'email', verification.email
            )
          END,
          'todayOrders', COALESCE(orders.today_orders, 0),
          'todayCompletedOrders', COALESCE(orders.today_completed_orders, 0),
          'failedOrders', COALESCE(orders.failed_orders, 0),
          'todayCommission', COALESCE(commission.today_commission, 0),
          'totalWorkMinutes', COALESCE(work_time.total_work_minutes, 0),
          'todayWorkMinutes', COALESCE(work_time.today_work_minutes, 0),
          'workDays', COALESCE(orders.work_days, 0),
          'workStatus', CASE
            WHEN dispatch.user_id IS NULL THEN 'never_started'
            WHEN dispatch.status = 'online'
              AND dispatch.ended_at IS NULL
              AND dispatch.last_activity_at >= now() - interval '3 minutes'
            THEN 'online'
            ELSE 'offline'
          END,
          'totalOrders', COALESCE(orders.total_orders, 0),
          'accountBalance', COALESCE(wallet.available_balance, 0),
          'hasPendingWithdrawal', withdrawals.user_id IS NOT NULL,
          'pendingWithdrawalAmount', COALESCE(withdrawals.pending_amount, 0),
          'pendingWithdrawalDate', withdrawals.pending_date,
          'pendingWithdrawals', COALESCE(withdrawals.pending_withdrawals, '[]'::jsonb),
          'statsLoaded', true
        )
        ORDER BY u.created_at DESC, u.id DESC
      )
      FROM scoped_users AS u
      LEFT JOIN wallet_stats AS wallet ON wallet.user_id = u.id
      LEFT JOIN latest_verifications AS verification ON verification.user_id = u.id
      LEFT JOIN order_stats AS orders ON orders.user_id = u.id
      LEFT JOIN commission_stats AS commission ON commission.user_id = u.id
      LEFT JOIN pending_withdrawal_stats AS withdrawals ON withdrawals.user_id = u.id
      LEFT JOIN latest_dispatch_sessions AS dispatch ON dispatch.user_id = u.id
      LEFT JOIN work_time_stats AS work_time ON work_time.user_id = u.id
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE TABLE IF NOT EXISTS public.employee_presence_events (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  admin_id uuid NOT NULL REFERENCES public.admins(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('online', 'offline')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_presence_events_admin_id
  ON public.employee_presence_events(admin_id);

ALTER TABLE public.employee_presence_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.employee_presence_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.employee_presence_events TO anon, authenticated;

DROP POLICY IF EXISTS "Read employee presence signals" ON public.employee_presence_events;
CREATE POLICY "Read employee presence signals"
  ON public.employee_presence_events
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.emit_employee_presence_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid;
  v_admin_id uuid;
  v_status text;
  v_old_online boolean;
  v_new_online boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'online' OR NEW.ended_at IS NOT NULL THEN
      RETURN NEW;
    END IF;
    v_user_id := NEW.user_id;
    v_status := 'online';
  ELSIF TG_OP = 'DELETE' THEN
    v_user_id := OLD.user_id;
    v_status := 'offline';
  ELSE
    v_old_online := COALESCE(OLD.status = 'online' AND OLD.ended_at IS NULL, false);
    v_new_online := COALESCE(NEW.status = 'online' AND NEW.ended_at IS NULL, false);

    IF v_old_online = v_new_online THEN
      RETURN NEW;
    END IF;

    v_user_id := NEW.user_id;
    v_status := CASE WHEN v_new_online THEN 'online' ELSE 'offline' END;
  END IF;

  SELECT u.created_by
  INTO v_admin_id
  FROM public.users AS u
  WHERE u.id = v_user_id;

  IF v_admin_id IS NOT NULL THEN
    INSERT INTO public.employee_presence_events AS presence (
      user_id,
      admin_id,
      status,
      occurred_at
    ) VALUES (
      v_user_id,
      v_admin_id,
      v_status,
      now()
    )
    ON CONFLICT (user_id) DO UPDATE
    SET admin_id = EXCLUDED.admin_id,
        status = EXCLUDED.status,
        occurred_at = EXCLUDED.occurred_at;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.emit_employee_presence_event() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS dispatch_sessions_emit_presence_event ON public.dispatch_sessions;
CREATE TRIGGER dispatch_sessions_emit_presence_event
AFTER INSERT OR UPDATE OR DELETE ON public.dispatch_sessions
FOR EACH ROW
EXECUTE FUNCTION public.emit_employee_presence_event();

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'employee_presence_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.employee_presence_events;
  END IF;
END;
$do$;

CREATE OR REPLACE FUNCTION public.admin_set_employee_verification(
  p_admin_session_token uuid,
  p_user_id uuid,
  p_is_verified boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_admin_id uuid;
  v_admin_role text;
BEGIN
  IF p_is_verified IS NULL THEN
    RAISE EXCEPTION 'Verification status is required.';
  END IF;

  SELECT context.admin_id, context.admin_role
  INTO v_admin_id, v_admin_role
  FROM private.get_financial_admin_context(p_admin_session_token) AS context;

  PERFORM private.assert_admin_can_manage_user(v_admin_id, v_admin_role, p_user_id);

  UPDATE public.users
  SET is_verified = p_is_verified,
      updated_at = now()
  WHERE id = p_user_id;

  IF NOT p_is_verified THEN
    DELETE FROM public.verification_requests
    WHERE user_id = p_user_id
      AND status = 'approved';
  END IF;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_session_heartbeat_secure(
  p_user_id uuid,
  p_session_token uuid,
  p_tab_id text,
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_valid_user_id uuid;
  v_heartbeat_at timestamptz := clock_timestamp();
  v_work_sessions_updated integer;
BEGIN
  IF p_tab_id IS NULL OR btrim(p_tab_id) = '' THEN
    RAISE EXCEPTION 'Employee session is invalid or expired.';
  END IF;

  SELECT u.id
  INTO v_valid_user_id
  FROM public.employee_financial_sessions AS financial_session
  INNER JOIN public.users AS u ON u.id = financial_session.user_id
  INNER JOIN public.dispatch_sessions AS dispatch_session
    ON dispatch_session.id = p_session_id
   AND dispatch_session.user_id = u.id
  WHERE financial_session.user_id = p_user_id
    AND financial_session.token_hash = private.hash_financial_token(p_session_token)
    AND financial_session.revoked_at IS NULL
    AND financial_session.expires_at > now()
    AND financial_session.tab_id = p_tab_id
    AND financial_session.session_marker = u.current_session_token
    AND u.current_tab_id = p_tab_id
    AND u.is_active = true
    AND dispatch_session.status = 'online'
    AND dispatch_session.ended_at IS NULL
  FOR UPDATE OF financial_session, u, dispatch_session;

  IF v_valid_user_id IS NULL THEN
    RAISE EXCEPTION 'Employee session is invalid or expired.';
  END IF;

  UPDATE public.dispatch_sessions
  SET last_activity_at = v_heartbeat_at
  WHERE id = p_session_id
    AND user_id = v_valid_user_id
    AND status = 'online'
    AND ended_at IS NULL;

  UPDATE public.work_sessions
  SET last_heartbeat_at = v_heartbeat_at
  WHERE user_id = v_valid_user_id
    AND end_time IS NULL;

  GET DIAGNOSTICS v_work_sessions_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', p_session_id,
    'user_id', v_valid_user_id,
    'heartbeat_at', v_heartbeat_at,
    'work_sessions_updated', v_work_sessions_updated
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_employee_management_snapshot(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_employee_verification(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_session_heartbeat_secure(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_employee_management_snapshot(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_employee_verification(uuid, uuid, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_session_heartbeat_secure(uuid, uuid, text, uuid) TO anon, authenticated;
