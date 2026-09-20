ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS delivery_mode text;

ALTER TABLE public.notification_automation_tasks
  ADD COLUMN IF NOT EXISTS delivery_mode text;

ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS delivery_mode text;

ALTER TABLE public.message_recipients
  ADD COLUMN IF NOT EXISTS delivery_channel text,
  ADD COLUMN IF NOT EXISTS delivery_claim_token uuid,
  ADD COLUMN IF NOT EXISTS delivery_claim_channel text,
  ADD COLUMN IF NOT EXISTS delivery_claim_until timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

UPDATE public.messages
SET delivery_mode = CASE message_type
  WHEN 'login_popup' THEN 'login_only'
  ELSE 'realtime_only'
END
WHERE delivery_mode IS NULL;

UPDATE public.notification_automation_tasks
SET delivery_mode = CASE message_type
  WHEN 'login_popup' THEN 'login_only'
  ELSE 'realtime_only'
END
WHERE delivery_mode IS NULL;

UPDATE public.message_templates
SET delivery_mode = CASE message_type
  WHEN 'login_popup' THEN 'login_only'
  ELSE 'realtime_only'
END
WHERE delivery_mode IS NULL;

UPDATE public.message_recipients AS recipient
SET delivery_channel = 'login_popup',
    delivered_at = COALESCE(recipient.shown_at, recipient.created_at)
FROM public.messages AS message
WHERE message.id = recipient.message_id
  AND message.delivery_mode = 'login_only'
  AND recipient.is_shown = true
  AND recipient.delivery_channel IS NULL;

ALTER TABLE public.messages
  ALTER COLUMN delivery_mode SET NOT NULL,
  ALTER COLUMN delivery_mode SET DEFAULT 'realtime_only';

ALTER TABLE public.notification_automation_tasks
  ALTER COLUMN delivery_mode SET NOT NULL,
  ALTER COLUMN delivery_mode SET DEFAULT 'realtime_only';

ALTER TABLE public.message_templates
  ALTER COLUMN delivery_mode SET NOT NULL,
  ALTER COLUMN delivery_mode SET DEFAULT 'realtime_only';

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_delivery_mode_check,
  ADD CONSTRAINT messages_delivery_mode_check CHECK (
    delivery_mode IN ('realtime_only', 'login_only', 'realtime_with_login_fallback')
  );

ALTER TABLE public.notification_automation_tasks
  DROP CONSTRAINT IF EXISTS notification_automation_tasks_delivery_mode_check,
  ADD CONSTRAINT notification_automation_tasks_delivery_mode_check CHECK (
    delivery_mode IN ('realtime_only', 'login_only', 'realtime_with_login_fallback')
  );

ALTER TABLE public.message_templates
  DROP CONSTRAINT IF EXISTS message_templates_delivery_mode_check,
  ADD CONSTRAINT message_templates_delivery_mode_check CHECK (
    delivery_mode IN ('realtime_only', 'login_only', 'realtime_with_login_fallback')
  );

ALTER TABLE public.message_recipients
  DROP CONSTRAINT IF EXISTS message_recipients_delivery_channel_check,
  ADD CONSTRAINT message_recipients_delivery_channel_check CHECK (
    delivery_channel IS NULL OR delivery_channel IN ('realtime', 'login_popup')
  ),
  DROP CONSTRAINT IF EXISTS message_recipients_delivery_claim_channel_check,
  ADD CONSTRAINT message_recipients_delivery_claim_channel_check CHECK (
    delivery_claim_channel IS NULL OR delivery_claim_channel IN ('realtime', 'login_popup')
  ),
  DROP CONSTRAINT IF EXISTS message_recipients_delivery_claim_consistency_check,
  ADD CONSTRAINT message_recipients_delivery_claim_consistency_check CHECK (
    (delivery_claim_token IS NULL AND delivery_claim_channel IS NULL AND delivery_claim_until IS NULL)
    OR
    (delivery_claim_token IS NOT NULL AND delivery_claim_channel IS NOT NULL AND delivery_claim_until IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS message_recipients_pending_delivery_idx
  ON public.message_recipients(recipient_id, created_at, id)
  WHERE delivery_channel IS NULL;

CREATE INDEX IF NOT EXISTS message_recipients_delivery_claim_idx
  ON public.message_recipients(delivery_claim_until)
  WHERE delivery_claim_token IS NOT NULL;

CREATE OR REPLACE FUNCTION private.sync_notification_delivery_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, private, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.delivery_mode IS NULL
      OR (NEW.delivery_mode = 'realtime_only' AND NEW.message_type = 'login_popup') THEN
      NEW.delivery_mode := CASE NEW.message_type
        WHEN 'login_popup' THEN 'login_only'
        ELSE 'realtime_only'
      END;
    ELSE
      NEW.message_type := CASE NEW.delivery_mode
        WHEN 'realtime_only' THEN 'realtime'
        ELSE 'login_popup'
      END;
    END IF;
  ELSIF NEW.delivery_mode IS DISTINCT FROM OLD.delivery_mode THEN
    NEW.message_type := CASE NEW.delivery_mode
      WHEN 'realtime_only' THEN 'realtime'
      ELSE 'login_popup'
    END;
  ELSIF NEW.message_type IS DISTINCT FROM OLD.message_type THEN
    NEW.delivery_mode := CASE NEW.message_type
      WHEN 'login_popup' THEN 'login_only'
      ELSE 'realtime_only'
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_messages_delivery_mode ON public.messages;
CREATE TRIGGER sync_messages_delivery_mode
BEFORE INSERT OR UPDATE OF message_type, delivery_mode ON public.messages
FOR EACH ROW
EXECUTE FUNCTION private.sync_notification_delivery_mode();

CREATE OR REPLACE FUNCTION private.inherit_automation_message_delivery_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_delivery_mode text;
BEGIN
  IF NEW.automation_execution_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT task.delivery_mode
  INTO v_delivery_mode
  FROM public.notification_automation_executions AS execution
  JOIN public.notification_automation_tasks AS task ON task.id = execution.task_id
  WHERE execution.id = NEW.automation_execution_id;

  IF v_delivery_mode IS NOT NULL AND NEW.delivery_mode IS DISTINCT FROM v_delivery_mode THEN
    UPDATE public.messages
    SET delivery_mode = v_delivery_mode
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inherit_automation_message_delivery_mode ON public.messages;
CREATE TRIGGER inherit_automation_message_delivery_mode
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION private.inherit_automation_message_delivery_mode();

DROP TRIGGER IF EXISTS sync_notification_automation_tasks_delivery_mode ON public.notification_automation_tasks;
CREATE TRIGGER sync_notification_automation_tasks_delivery_mode
BEFORE INSERT OR UPDATE OF message_type, delivery_mode ON public.notification_automation_tasks
FOR EACH ROW
EXECUTE FUNCTION private.sync_notification_delivery_mode();

DROP TRIGGER IF EXISTS sync_message_templates_delivery_mode ON public.message_templates;
CREATE TRIGGER sync_message_templates_delivery_mode
BEFORE INSERT OR UPDATE OF message_type, delivery_mode ON public.message_templates
FOR EACH ROW
EXECUTE FUNCTION private.sync_notification_delivery_mode();

CREATE OR REPLACE FUNCTION public.send_admin_message_with_delivery(
  p_admin_session_token uuid,
  p_recipient_ids uuid[],
  p_title text,
  p_content text,
  p_delivery_mode text,
  p_priority text,
  p_reward_amount numeric,
  p_operation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_message_type text;
  v_result jsonb;
  v_message_id uuid;
  v_current_mode text;
BEGIN
  IF p_delivery_mode NOT IN ('realtime_only', 'login_only', 'realtime_with_login_fallback') THEN
    RAISE EXCEPTION 'Unsupported notification delivery mode.';
  END IF;

  v_message_type := CASE p_delivery_mode
    WHEN 'realtime_only' THEN 'realtime'
    ELSE 'login_popup'
  END;

  v_result := public.send_admin_message_secure(
    p_admin_session_token,
    p_recipient_ids,
    p_title,
    p_content,
    v_message_type,
    p_priority,
    p_reward_amount,
    p_operation_id
  );

  v_message_id := (v_result ->> 'message_id')::uuid;

  SELECT delivery_mode
  INTO v_current_mode
  FROM public.messages
  WHERE id = v_message_id
  FOR UPDATE;

  IF v_current_mode NOT IN (p_delivery_mode, CASE v_message_type WHEN 'realtime' THEN 'realtime_only' ELSE 'login_only' END) THEN
    RAISE EXCEPTION 'The operation ID was already used with a different delivery mode.';
  END IF;

  UPDATE public.messages
  SET delivery_mode = p_delivery_mode
  WHERE id = v_message_id;

  RETURN v_result || jsonb_build_object('delivery_mode', p_delivery_mode);
END;
$$;

CREATE OR REPLACE FUNCTION public.save_notification_automation_task_with_delivery(
  p_admin_session_token uuid,
  p_task_id uuid,
  p_name text,
  p_description text,
  p_trigger_type text,
  p_trigger_mode text,
  p_threshold_value numeric,
  p_minimum_daily_orders integer,
  p_minimum_daily_work_minutes integer,
  p_recipient_scope text,
  p_recipient_ids uuid[],
  p_title_template text,
  p_content_template text,
  p_delivery_mode text,
  p_priority text,
  p_reward_enabled boolean,
  p_reward_amount numeric,
  p_is_shared_template boolean,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_message_type text;
  v_result jsonb;
  v_task_id uuid;
BEGIN
  IF p_delivery_mode NOT IN ('realtime_only', 'login_only', 'realtime_with_login_fallback') THEN
    RAISE EXCEPTION 'Unsupported notification delivery mode.';
  END IF;

  v_message_type := CASE p_delivery_mode
    WHEN 'realtime_only' THEN 'realtime'
    ELSE 'login_popup'
  END;

  v_result := public.save_notification_automation_task(
    p_admin_session_token,
    p_task_id,
    p_name,
    p_description,
    p_trigger_type,
    p_trigger_mode,
    p_threshold_value,
    p_minimum_daily_orders,
    p_minimum_daily_work_minutes,
    p_recipient_scope,
    p_recipient_ids,
    p_title_template,
    p_content_template,
    v_message_type,
    p_priority,
    p_reward_enabled,
    p_reward_amount,
    p_is_shared_template,
    p_starts_at,
    p_ends_at
  );

  v_task_id := (v_result ->> 'task_id')::uuid;

  UPDATE public.notification_automation_tasks
  SET delivery_mode = p_delivery_mode
  WHERE id = v_task_id;

  RETURN v_result || jsonb_build_object('delivery_mode', p_delivery_mode);
END;
$$;

CREATE OR REPLACE FUNCTION public.save_notification_automation_task_copy_with_delivery(
  p_admin_session_token uuid,
  p_source_task_id uuid,
  p_task_id uuid,
  p_name text,
  p_description text,
  p_trigger_type text,
  p_trigger_mode text,
  p_threshold_value numeric,
  p_minimum_daily_orders integer,
  p_minimum_daily_work_minutes integer,
  p_recipient_scope text,
  p_recipient_ids uuid[],
  p_title_template text,
  p_content_template text,
  p_delivery_mode text,
  p_priority text,
  p_reward_enabled boolean,
  p_reward_amount numeric,
  p_is_shared_template boolean,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_message_type text;
  v_result jsonb;
  v_task_id uuid;
BEGIN
  IF p_delivery_mode NOT IN ('realtime_only', 'login_only', 'realtime_with_login_fallback') THEN
    RAISE EXCEPTION 'Unsupported notification delivery mode.';
  END IF;

  v_message_type := CASE p_delivery_mode
    WHEN 'realtime_only' THEN 'realtime'
    ELSE 'login_popup'
  END;

  v_result := public.save_notification_automation_task_copy(
    p_admin_session_token,
    p_source_task_id,
    p_task_id,
    p_name,
    p_description,
    p_trigger_type,
    p_trigger_mode,
    p_threshold_value,
    p_minimum_daily_orders,
    p_minimum_daily_work_minutes,
    p_recipient_scope,
    p_recipient_ids,
    p_title_template,
    p_content_template,
    v_message_type,
    p_priority,
    p_reward_enabled,
    p_reward_amount,
    p_is_shared_template,
    p_starts_at,
    p_ends_at
  );

  v_task_id := (v_result ->> 'task_id')::uuid;

  UPDATE public.notification_automation_tasks
  SET delivery_mode = p_delivery_mode
  WHERE id = v_task_id;

  RETURN v_result || jsonb_build_object('delivery_mode', p_delivery_mode);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_realtime_notification_delivery(
  p_user_id uuid,
  p_session_token uuid,
  p_tab_id text,
  p_recipient_id uuid,
  p_lease_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_recipient public.message_recipients%ROWTYPE;
  v_message public.messages%ROWTYPE;
  v_claim_token uuid := gen_random_uuid();
  v_lease_seconds integer := LEAST(GREATEST(COALESCE(p_lease_seconds, 120), 30), 300);
BEGIN
  IF NOT public.validate_employee_session(p_user_id, p_session_token, p_tab_id) THEN
    RAISE EXCEPTION 'Employee session is invalid or expired.';
  END IF;

  UPDATE public.message_recipients AS recipient
  SET delivery_claim_token = v_claim_token,
      delivery_claim_channel = 'realtime',
      delivery_claim_until = clock_timestamp() + make_interval(secs => v_lease_seconds)
  FROM public.messages AS message
  WHERE recipient.id = p_recipient_id
    AND recipient.recipient_id = p_user_id
    AND message.id = recipient.message_id
    AND message.delivery_mode IN ('realtime_only', 'realtime_with_login_fallback')
    AND recipient.delivery_channel IS NULL
    AND (recipient.delivery_claim_token IS NULL OR recipient.delivery_claim_until <= clock_timestamp())
    AND (message.expires_at IS NULL OR message.expires_at > clock_timestamp())
  RETURNING recipient.* INTO v_recipient;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_message
  FROM public.messages
  WHERE id = v_recipient.message_id;

  RETURN jsonb_build_object(
    'claim_token', v_claim_token,
    'recipient', to_jsonb(v_recipient),
    'message', to_jsonb(v_message)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.has_pending_employee_login_notifications(
  p_user_id uuid,
  p_session_token uuid,
  p_tab_id text,
  p_combined_only boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
BEGIN
  IF NOT public.validate_employee_session(p_user_id, p_session_token, p_tab_id) THEN
    RAISE EXCEPTION 'Employee session is invalid or expired.';
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.message_recipients AS recipient
    JOIN public.messages AS message ON message.id = recipient.message_id
    WHERE recipient.recipient_id = p_user_id
      AND recipient.delivery_channel IS NULL
      AND recipient.is_shown = false
      AND (recipient.delivery_claim_token IS NULL OR recipient.delivery_claim_until <= clock_timestamp())
      AND (message.expires_at IS NULL OR message.expires_at > clock_timestamp())
      AND (
        message.delivery_mode = 'realtime_with_login_fallback'
        OR (NOT p_combined_only AND message.delivery_mode = 'login_only')
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_next_login_notification_delivery(
  p_user_id uuid,
  p_session_token uuid,
  p_tab_id text,
  p_combined_only boolean DEFAULT false,
  p_lease_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_recipient public.message_recipients%ROWTYPE;
  v_message public.messages%ROWTYPE;
  v_claim_token uuid := gen_random_uuid();
  v_lease_seconds integer := LEAST(GREATEST(COALESCE(p_lease_seconds, 120), 30), 300);
BEGIN
  IF NOT public.validate_employee_session(p_user_id, p_session_token, p_tab_id) THEN
    RAISE EXCEPTION 'Employee session is invalid or expired.';
  END IF;

  WITH candidate AS (
    SELECT recipient.id
    FROM public.message_recipients AS recipient
    JOIN public.messages AS message ON message.id = recipient.message_id
    WHERE recipient.recipient_id = p_user_id
      AND recipient.delivery_channel IS NULL
      AND recipient.is_shown = false
      AND (recipient.delivery_claim_token IS NULL OR recipient.delivery_claim_until <= clock_timestamp())
      AND (message.expires_at IS NULL OR message.expires_at > clock_timestamp())
      AND (
        message.delivery_mode = 'realtime_with_login_fallback'
        OR (NOT p_combined_only AND message.delivery_mode = 'login_only')
      )
    ORDER BY recipient.created_at, recipient.id
    FOR UPDATE OF recipient SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.message_recipients AS recipient
  SET delivery_claim_token = v_claim_token,
      delivery_claim_channel = 'login_popup',
      delivery_claim_until = clock_timestamp() + make_interval(secs => v_lease_seconds)
  FROM candidate
  WHERE recipient.id = candidate.id
  RETURNING recipient.* INTO v_recipient;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_message
  FROM public.messages
  WHERE id = v_recipient.message_id;

  RETURN jsonb_build_object(
    'claim_token', v_claim_token,
    'recipient', to_jsonb(v_recipient),
    'message', to_jsonb(v_message)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_notification_delivery(
  p_user_id uuid,
  p_session_token uuid,
  p_tab_id text,
  p_recipient_id uuid,
  p_claim_token uuid,
  p_mark_read boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_recipient public.message_recipients%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF NOT public.validate_employee_session(p_user_id, p_session_token, p_tab_id) THEN
    RAISE EXCEPTION 'Employee session is invalid or expired.';
  END IF;

  UPDATE public.message_recipients
  SET delivery_channel = delivery_claim_channel,
      delivered_at = v_now,
      is_shown = true,
      shown_at = COALESCE(shown_at, v_now),
      is_read = CASE WHEN p_mark_read THEN true ELSE is_read END,
      read_at = CASE WHEN p_mark_read THEN COALESCE(read_at, v_now) ELSE read_at END,
      delivery_claim_token = NULL,
      delivery_claim_channel = NULL,
      delivery_claim_until = NULL
  WHERE id = p_recipient_id
    AND recipient_id = p_user_id
    AND delivery_channel IS NULL
    AND delivery_claim_token = p_claim_token
  RETURNING * INTO v_recipient;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'recipient_id', v_recipient.id,
    'delivery_channel', v_recipient.delivery_channel,
    'delivered_at', v_recipient.delivered_at,
    'is_read', v_recipient.is_read,
    'read_at', v_recipient.read_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.send_admin_message_with_delivery(uuid, uuid[], text, text, text, text, numeric, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_notification_automation_task_with_delivery(uuid, uuid, text, text, text, text, numeric, integer, integer, text, uuid[], text, text, text, text, boolean, numeric, boolean, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_notification_automation_task_copy_with_delivery(uuid, uuid, uuid, text, text, text, text, numeric, integer, integer, text, uuid[], text, text, text, text, boolean, numeric, boolean, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_realtime_notification_delivery(uuid, uuid, text, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_pending_employee_login_notifications(uuid, uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_next_login_notification_delivery(uuid, uuid, text, boolean, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_notification_delivery(uuid, uuid, text, uuid, uuid, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.send_admin_message_with_delivery(uuid, uuid[], text, text, text, text, numeric, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_notification_automation_task_with_delivery(uuid, uuid, text, text, text, text, numeric, integer, integer, text, uuid[], text, text, text, text, boolean, numeric, boolean, timestamptz, timestamptz) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_notification_automation_task_copy_with_delivery(uuid, uuid, uuid, text, text, text, text, numeric, integer, integer, text, uuid[], text, text, text, text, boolean, numeric, boolean, timestamptz, timestamptz) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_realtime_notification_delivery(uuid, uuid, text, uuid, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_pending_employee_login_notifications(uuid, uuid, text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_login_notification_delivery(uuid, uuid, text, boolean, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_notification_delivery(uuid, uuid, text, uuid, uuid, boolean) TO anon, authenticated;

REVOKE UPDATE ON public.message_recipients FROM anon, authenticated;
GRANT UPDATE (is_read, read_at, is_shown, shown_at) ON public.message_recipients TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
