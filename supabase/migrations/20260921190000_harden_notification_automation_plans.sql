ALTER TABLE public.notification_automation_executions
  ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES public.notification_automation_plans(id) ON DELETE SET NULL;

UPDATE public.notification_automation_executions AS execution
SET plan_id = task.plan_id
FROM public.notification_automation_tasks AS task
WHERE execution.task_id = task.id
  AND execution.plan_id IS NULL
  AND task.plan_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notification_automation_executions_plan_idx
  ON public.notification_automation_executions(owner_admin_id, plan_id, executed_at DESC);

CREATE OR REPLACE FUNCTION private.lock_notification_automation_configuration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('notification_automation_queue', 0));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS lock_notification_automation_tasks ON public.notification_automation_tasks;
CREATE TRIGGER lock_notification_automation_tasks
  BEFORE INSERT OR UPDATE OR DELETE
  ON public.notification_automation_tasks
  FOR EACH STATEMENT
  EXECUTE FUNCTION private.lock_notification_automation_configuration();

DROP TRIGGER IF EXISTS lock_notification_automation_plans ON public.notification_automation_plans;
CREATE TRIGGER lock_notification_automation_plans
  BEFORE INSERT OR UPDATE OR DELETE
  ON public.notification_automation_plans
  FOR EACH STATEMENT
  EXECUTE FUNCTION private.lock_notification_automation_configuration();

DROP TRIGGER IF EXISTS lock_notification_automation_plan_members ON public.notification_automation_plan_members;
CREATE TRIGGER lock_notification_automation_plan_members
  BEFORE INSERT OR UPDATE OR DELETE
  ON public.notification_automation_plan_members
  FOR EACH STATEMENT
  EXECUTE FUNCTION private.lock_notification_automation_configuration();

CREATE OR REPLACE FUNCTION private.snapshot_notification_automation_execution_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.plan_id IS NULL AND NEW.task_id IS NOT NULL THEN
    SELECT task.plan_id
    INTO NEW.plan_id
    FROM public.notification_automation_tasks AS task
    WHERE task.id = NEW.task_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS snapshot_notification_automation_execution_plan
  ON public.notification_automation_executions;
CREATE TRIGGER snapshot_notification_automation_execution_plan
  BEFORE INSERT OR UPDATE OF task_id
  ON public.notification_automation_executions
  FOR EACH ROW
  EXECUTE FUNCTION private.snapshot_notification_automation_execution_plan();

CREATE OR REPLACE FUNCTION private.capture_notification_automation_assignment_baseline(
  p_task public.notification_automation_tasks,
  p_user_id uuid,
  p_now timestamptz DEFAULT clock_timestamp()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_metric_result jsonb;
  v_metric numeric;
  v_period_key text;
  v_stage bigint;
BEGIN
  v_metric_result := private.calculate_automation_metric(p_task, p_user_id, p_now);
  v_metric := COALESCE((v_metric_result->>'metric')::numeric, 0);
  v_period_key := COALESCE(v_metric_result->>'period_key', 'all_time');
  v_stage := CASE
    WHEN p_task.trigger_type = 'annual_date' THEN 0
    WHEN p_task.trigger_mode = 'reach_once' AND v_metric >= p_task.threshold_value THEN 1
    WHEN p_task.trigger_mode = 'recurring' THEN floor(v_metric / p_task.threshold_value)::bigint
    ELSE 0
  END;

  INSERT INTO public.notification_automation_progress (
    task_id,
    user_id,
    last_metric,
    last_stage,
    last_period_key
  ) VALUES (
    p_task.id,
    p_user_id,
    v_metric,
    v_stage,
    v_period_key
  )
  ON CONFLICT (task_id, user_id) DO UPDATE
  SET last_metric = EXCLUDED.last_metric,
      last_stage = EXCLUDED.last_stage,
      last_period_key = EXCLUDED.last_period_key,
      updated_at = p_now;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_notification_automation_plan_members(
  p_admin_session_token uuid,
  p_plan_id uuid,
  p_user_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
  v_admin_role text;
  v_plan public.notification_automation_plans%ROWTYPE;
  v_user_id uuid;
  v_task public.notification_automation_tasks%ROWTYPE;
  v_user_ids uuid[] := COALESCE(p_user_ids, ARRAY[]::uuid[]);
  v_added_user_ids uuid[];
BEGIN
  SELECT context.admin_id, context.admin_role
  INTO v_admin_id, v_admin_role
  FROM private.get_financial_admin_context(p_admin_session_token) AS context;

  IF cardinality(v_user_ids) <> (
    SELECT count(DISTINCT requested_user_id)
    FROM unnest(v_user_ids) AS requested_user_id
  ) THEN
    RAISE EXCEPTION 'The employee selection contains duplicate accounts.';
  END IF;

  SELECT plan.*
  INTO v_plan
  FROM public.notification_automation_plans AS plan
  WHERE plan.id = p_plan_id
    AND plan.status <> 'archived'
    AND (
      plan.owner_admin_id = v_admin_id
      OR v_admin_role = 'super_admin'
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automation plan was not found or cannot manage employees.';
  END IF;

  PERFORM private.resolve_notification_automation_owner(
    v_admin_id,
    v_admin_role,
    v_plan.owner_admin_id
  );

  IF EXISTS (
    SELECT 1
    FROM unnest(v_user_ids) AS requested_user_id
    LEFT JOIN public.users AS employee ON employee.id = requested_user_id
    WHERE employee.id IS NULL
       OR employee.created_by <> v_plan.owner_admin_id
  ) THEN
    RAISE EXCEPTION 'An employee is outside the automation plan administrator group.';
  END IF;

  PERFORM employee.id
  FROM public.users AS employee
  WHERE employee.id = ANY(v_user_ids)
     OR EXISTS (
       SELECT 1
       FROM public.notification_automation_plan_members AS current_member
       WHERE current_member.plan_id = v_plan.id
         AND current_member.user_id = employee.id
     )
  ORDER BY employee.id
  FOR UPDATE;

  SELECT COALESCE(array_agg(requested_user_id), ARRAY[]::uuid[])
  INTO v_added_user_ids
  FROM unnest(v_user_ids) AS requested_user_id
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.notification_automation_plan_members AS existing_member
    WHERE existing_member.plan_id = v_plan.id
      AND existing_member.user_id = requested_user_id
  );

  DELETE FROM public.notification_automation_plan_members AS member
  WHERE member.plan_id = v_plan.id
    AND NOT (member.user_id = ANY(v_user_ids));

  DELETE FROM public.notification_automation_plan_members AS member
  WHERE member.plan_id <> v_plan.id
    AND member.user_id = ANY(v_user_ids);

  FOREACH v_user_id IN ARRAY v_added_user_ids
  LOOP
    INSERT INTO public.notification_automation_plan_members(plan_id, user_id)
    VALUES (v_plan.id, v_user_id);

    FOR v_task IN
      SELECT task.*
      FROM public.notification_automation_tasks AS task
      WHERE task.plan_id = v_plan.id
        AND task.status = 'active'
        AND task.recipient_scope = 'selected'
        AND (task.starts_at IS NULL OR task.starts_at <= clock_timestamp())
    LOOP
      PERFORM private.capture_notification_automation_assignment_baseline(v_task, v_user_id);
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'plan_id', v_plan.id,
    'member_count', (
      SELECT count(*)
      FROM public.notification_automation_plan_members AS member
      WHERE member.plan_id = v_plan.id
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_notification_automation_plan_for_employee(
  p_admin_session_token uuid,
  p_user_id uuid,
  p_plan_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
  v_admin_role text;
  v_employee public.users%ROWTYPE;
  v_plan public.notification_automation_plans%ROWTYPE;
  v_task public.notification_automation_tasks%ROWTYPE;
  v_current_plan_id uuid;
BEGIN
  SELECT context.admin_id, context.admin_role
  INTO v_admin_id, v_admin_role
  FROM private.get_financial_admin_context(p_admin_session_token) AS context;

  PERFORM private.assert_admin_can_manage_user(v_admin_id, v_admin_role, p_user_id);

  SELECT employee.*
  INTO v_employee
  FROM public.users AS employee
  WHERE employee.id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee account was not found.';
  END IF;

  SELECT member.plan_id
  INTO v_current_plan_id
  FROM public.notification_automation_plan_members AS member
  WHERE member.user_id = v_employee.id;

  IF p_plan_id IS NOT NULL THEN
    SELECT plan.*
    INTO v_plan
    FROM public.notification_automation_plans AS plan
    JOIN public.admins AS owner ON owner.id = plan.owner_admin_id
    WHERE plan.id = p_plan_id
      AND plan.owner_admin_id = v_employee.created_by
      AND plan.status = 'active'
      AND owner.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'The selected automation plan is not available for this employee.';
    END IF;
  END IF;

  IF p_plan_id IS NOT DISTINCT FROM v_current_plan_id THEN
    RETURN jsonb_build_object(
      'success', true,
      'user_id', v_employee.id,
      'plan_id', p_plan_id
    );
  END IF;

  DELETE FROM public.notification_automation_plan_members
  WHERE user_id = v_employee.id;

  IF p_plan_id IS NOT NULL THEN
    INSERT INTO public.notification_automation_plan_members(plan_id, user_id)
    VALUES (v_plan.id, v_employee.id);

    FOR v_task IN
      SELECT task.*
      FROM public.notification_automation_tasks AS task
      WHERE task.plan_id = v_plan.id
        AND task.status = 'active'
        AND task.recipient_scope = 'selected'
        AND (task.starts_at IS NULL OR task.starts_at <= clock_timestamp())
    LOOP
      PERFORM private.capture_notification_automation_assignment_baseline(v_task, v_employee.id);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_employee.id,
    'plan_id', p_plan_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_employee_account_with_automation_plan(
  p_admin_session_token uuid,
  p_username text,
  p_password text,
  p_employee_id text,
  p_created_by uuid,
  p_remarks text,
  p_automation_plan_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
  v_admin_role text;
  v_owner_admin_id uuid;
  v_user public.users%ROWTYPE;
  v_plan public.notification_automation_plans%ROWTYPE;
  v_task public.notification_automation_tasks%ROWTYPE;
  v_password_hash text;
BEGIN
  SELECT context.admin_id, context.admin_role
  INTO v_admin_id, v_admin_role
  FROM private.get_financial_admin_context(p_admin_session_token) AS context;

  v_owner_admin_id := private.resolve_notification_automation_owner(
    v_admin_id,
    v_admin_role,
    p_created_by
  );

  IF length(trim(COALESCE(p_username, ''))) = 0
    OR length(p_password) < 6
    OR length(trim(COALESCE(p_employee_id, ''))) = 0 THEN
    RAISE EXCEPTION 'Invalid employee account details.';
  END IF;

  IF p_automation_plan_id IS NOT NULL THEN
    SELECT plan.*
    INTO v_plan
    FROM public.notification_automation_plans AS plan
    WHERE plan.id = p_automation_plan_id
      AND plan.owner_admin_id = v_owner_admin_id
      AND plan.status = 'active';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'The selected automation plan is not available.';
    END IF;
  END IF;

  v_password_hash := extensions.crypt(p_password, extensions.gen_salt('bf', 10));

  INSERT INTO public.users (
    username,
    password_hash,
    employee_id,
    created_by,
    remarks
  ) VALUES (
    trim(p_username),
    v_password_hash,
    trim(p_employee_id),
    v_owner_admin_id,
    trim(COALESCE(p_remarks, ''))
  )
  RETURNING * INTO v_user;

  INSERT INTO public.financial_employee_credentials(user_id, password_hash)
  VALUES (v_user.id, v_password_hash);

  IF p_automation_plan_id IS NOT NULL THEN
    INSERT INTO public.notification_automation_plan_members(plan_id, user_id)
    VALUES (v_plan.id, v_user.id);
  END IF;

  FOR v_task IN
    SELECT task.*
    FROM public.notification_automation_tasks AS task
    WHERE task.status = 'active'
      AND (task.starts_at IS NULL OR task.starts_at <= clock_timestamp())
      AND (task.ends_at IS NULL OR task.ends_at > clock_timestamp())
      AND private.automation_task_applies_to_user(task, v_user.id)
  LOOP
    PERFORM private.capture_automation_baseline(v_task, v_user.id);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'user', to_jsonb(v_user) - 'password_hash',
    'automation_plan_id', p_automation_plan_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_notification_automation_executions_v2(
  p_admin_session_token uuid,
  p_owner_admin_id uuid,
  p_plan_id uuid DEFAULT NULL,
  p_all_plans boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
  v_admin_role text;
  v_owner_admin_id uuid;
BEGIN
  SELECT context.admin_id, context.admin_role
  INTO v_admin_id, v_admin_role
  FROM private.get_financial_admin_context(p_admin_session_token) AS context;

  v_owner_admin_id := private.resolve_notification_automation_owner(
    v_admin_id,
    v_admin_role,
    p_owner_admin_id
  );

  IF NOT p_all_plans AND p_plan_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.notification_automation_plans AS plan
    WHERE plan.id = p_plan_id
      AND plan.owner_admin_id = v_owner_admin_id
  ) THEN
    RAISE EXCEPTION 'The selected automation plan is not available.';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(execution_data ORDER BY (execution_data->>'executed_at') DESC)
    FROM (
      SELECT to_jsonb(execution.*)
        || jsonb_build_object(
          'task_name', COALESCE(task.name, execution.trigger_snapshot->>'task_name', '已移除任務'),
          'plan_id', execution.plan_id,
          'employee_username', COALESCE(employee.username, execution.employee_username),
          'owner_username', owner.username
        ) AS execution_data
      FROM public.notification_automation_executions AS execution
      LEFT JOIN public.notification_automation_tasks AS task ON task.id = execution.task_id
      LEFT JOIN public.users AS employee ON employee.id = execution.user_id
      LEFT JOIN public.admins AS owner ON owner.id = execution.owner_admin_id
      WHERE execution.owner_admin_id = v_owner_admin_id
        AND (
          p_all_plans
          OR execution.plan_id IS NOT DISTINCT FROM p_plan_id
        )
      ORDER BY execution.executed_at DESC
      LIMIT 200
    ) AS visible_executions
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION private.lock_notification_automation_configuration() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.snapshot_notification_automation_execution_plan() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.capture_notification_automation_assignment_baseline(public.notification_automation_tasks, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_notification_automation_executions_v2(uuid, uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_notification_automation_executions_v2(uuid, uuid, uuid, boolean) TO anon, authenticated, service_role;
