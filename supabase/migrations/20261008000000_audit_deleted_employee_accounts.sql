CREATE TABLE private.deleted_employee_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL,
  employee_id uuid NOT NULL UNIQUE,
  account_username text,
  employee_number text,
  owner_admin_id uuid NOT NULL,
  owner_username text,
  actor_admin_id uuid NOT NULL,
  actor_username text NOT NULL,
  actor_role text NOT NULL,
  deletion_source text NOT NULL CHECK (deletion_source IN ('employee_delete', 'admin_delete')),
  deleted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  cleared_at timestamptz,
  cleared_by uuid,
  cleared_username text,
  clear_reason text
);
CREATE INDEX deleted_employee_accounts_time_idx ON private.deleted_employee_accounts (deleted_at DESC, id DESC);
CREATE INDEX deleted_employee_accounts_owner_idx ON private.deleted_employee_accounts (owner_admin_id, deleted_at DESC);
CREATE INDEX deleted_employee_accounts_actor_idx ON private.deleted_employee_accounts (actor_admin_id, deleted_at DESC);
CREATE INDEX deleted_employee_accounts_operation_idx ON private.deleted_employee_accounts (operation_id, employee_id);
CREATE INDEX content_audit_events_employee_operation_idx ON private.content_audit_events (operation_id, employee_id, occurred_at DESC, id DESC)
WHERE entity_type IN ('aaa_service', 'ccc_service') AND action IN ('employee_delete', 'admin_delete');
REVOKE ALL ON private.deleted_employee_accounts FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.archive_employees_before_admin_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp AS $$
DECLARE v_actor public.admins%ROWTYPE; v_operation uuid;
BEGIN
  IF current_setting('content_audit.action', true) IS DISTINCT FROM 'admin_delete'
    OR NULLIF(current_setting('content_audit.operation', true), '') IS NULL THEN
    RAISE EXCEPTION 'Administrator deletion requires an audited operation.';
  END IF;
  v_operation := current_setting('content_audit.operation')::uuid;
  SELECT * INTO v_actor FROM public.admins
  WHERE id = NULLIF(current_setting('content_audit.actor', true), '')::uuid AND is_active = true;
  IF v_actor.id IS NULL OR v_actor.role <> 'super_admin' OR OLD.role <> 'secondary_admin' THEN
    RAISE EXCEPTION 'Administrator deletion requires a verified super administrator.';
  END IF;
  INSERT INTO private.deleted_employee_accounts (
    operation_id, employee_id, account_username, employee_number, owner_admin_id, owner_username,
    actor_admin_id, actor_username, actor_role, deletion_source
  )
  SELECT v_operation, u.id, u.username, u.employee_id, OLD.id, OLD.username,
    v_actor.id, v_actor.username, v_actor.role, 'admin_delete'
  FROM public.users u WHERE u.created_by = OLD.id;
  RETURN OLD;
END;
$$;
CREATE TRIGGER archive_employees_before_admin_delete BEFORE DELETE ON public.admins
FOR EACH ROW EXECUTE FUNCTION private.archive_employees_before_admin_delete();

CREATE FUNCTION private.archive_employee_before_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp AS $$
DECLARE v_actor public.admins%ROWTYPE; v_operation uuid; v_action text;
BEGIN
  v_action := current_setting('content_audit.action', true);
  IF v_action NOT IN ('employee_delete', 'admin_delete')
    OR NULLIF(current_setting('content_audit.operation', true), '') IS NULL THEN
    RAISE EXCEPTION 'Employee deletion requires an audited operation.';
  END IF;
  v_operation := current_setting('content_audit.operation')::uuid;
  SELECT * INTO v_actor FROM public.admins
  WHERE id = NULLIF(current_setting('content_audit.actor', true), '')::uuid AND is_active = true;
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'Employee deletion requires a verified administrator.'; END IF;
  IF v_action = 'employee_delete' THEN
    PERFORM private.assert_admin_can_manage_user(v_actor.id, v_actor.role, OLD.id);
    INSERT INTO private.deleted_employee_accounts (
      operation_id, employee_id, account_username, employee_number, owner_admin_id, owner_username,
      actor_admin_id, actor_username, actor_role, deletion_source
    ) VALUES (
      v_operation, OLD.id, OLD.username, OLD.employee_id, OLD.created_by,
      (SELECT username FROM public.admins WHERE id = OLD.created_by),
      v_actor.id, v_actor.username, v_actor.role, v_action
    );
  ELSIF v_actor.role <> 'super_admin' OR NOT EXISTS (
    SELECT 1 FROM private.deleted_employee_accounts record
    WHERE record.employee_id = OLD.id AND record.operation_id = v_operation
      AND record.owner_admin_id = OLD.created_by AND record.actor_admin_id = v_actor.id
      AND record.deletion_source = 'admin_delete'
  ) THEN
    RAISE EXCEPTION 'Employee account was not preserved before administrator deletion.';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER archive_employee_before_delete BEFORE DELETE ON public.users
FOR EACH ROW EXECUTE FUNCTION private.archive_employee_before_delete();
REVOKE DELETE ON public.users FROM anon, authenticated;
REVOKE DELETE ON public.admins FROM anon, authenticated;
REVOKE ALL ON FUNCTION private.archive_employees_before_admin_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.archive_employee_before_delete() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.list_deleted_employee_accounts(
  p_admin_session_token uuid, p_owner uuid DEFAULT NULL, p_search text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL,
  p_page integer DEFAULT 0, p_page_size integer DEFAULT 30
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp AS $$
DECLARE v_role text; v_result jsonb; v_search text;
BEGIN
  SELECT admin_role INTO v_role FROM private.get_financial_admin_context(p_admin_session_token);
  IF v_role <> 'super_admin' THEN RAISE EXCEPTION 'Super administrator permission is required.'; END IF;
  IF p_page NOT BETWEEN 0 AND 100000 OR p_page_size NOT BETWEEN 1 AND 100
    OR length(COALESCE(p_search, '')) > 100 OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from >= p_to) THEN
    RAISE EXCEPTION 'Invalid deleted employee search.';
  END IF;
  v_search := NULLIF(btrim(p_search), '');
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM private.deleted_employee_accounts record
      WHERE (p_owner IS NULL OR record.owner_admin_id = p_owner)
        AND (p_from IS NULL OR record.deleted_at >= p_from)
        AND (p_to IS NULL OR record.deleted_at < p_to)
        AND (v_search IS NULL OR record.account_username ILIKE '%' || v_search || '%'
          OR record.employee_number ILIKE '%' || v_search || '%')),
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY page.deleted_at DESC, page.id DESC)
      FROM (SELECT record.id, record.employee_id, record.account_username, record.employee_number,
        record.owner_admin_id, record.owner_username, record.actor_admin_id, record.actor_username,
        record.actor_role, record.deletion_source, record.deleted_at, record.cleared_at
      FROM private.deleted_employee_accounts record
      WHERE (p_owner IS NULL OR record.owner_admin_id = p_owner)
        AND (p_from IS NULL OR record.deleted_at >= p_from)
        AND (p_to IS NULL OR record.deleted_at < p_to)
        AND (v_search IS NULL OR record.account_username ILIKE '%' || v_search || '%'
          OR record.employee_number ILIKE '%' || v_search || '%')
      ORDER BY record.deleted_at DESC, record.id DESC LIMIT p_page_size OFFSET p_page * p_page_size) page), '[]'::jsonb),
    'owners', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', owners.owner_admin_id,
      'username', owners.owner_username, 'event_count', owners.event_count) ORDER BY owners.owner_username, owners.owner_admin_id)
      FROM (SELECT admin.id AS owner_admin_id, admin.username AS owner_username,
        COALESCE(counts.event_count, 0) AS event_count
        FROM public.admins admin LEFT JOIN (
          SELECT owner_admin_id, count(*) AS event_count FROM private.deleted_employee_accounts GROUP BY owner_admin_id
        ) counts ON counts.owner_admin_id = admin.id
        UNION ALL
        SELECT counts.owner_admin_id,
          COALESCE((SELECT previous.owner_username FROM private.deleted_employee_accounts previous
            WHERE previous.owner_admin_id = counts.owner_admin_id AND previous.owner_username IS NOT NULL
            ORDER BY previous.deleted_at DESC LIMIT 1), counts.owner_admin_id::text), counts.event_count
        FROM (SELECT owner_admin_id, count(*) AS event_count FROM private.deleted_employee_accounts GROUP BY owner_admin_id) counts
        WHERE NOT EXISTS (SELECT 1 FROM public.admins admin WHERE admin.id = counts.owner_admin_id)) owners), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.get_deleted_employee_account(
  p_admin_session_token uuid, p_record_id uuid, p_related_page integer DEFAULT 0,
  p_related_page_size integer DEFAULT 20
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp AS $$
DECLARE v_role text; v_result jsonb;
BEGIN
  SELECT admin_role INTO v_role FROM private.get_financial_admin_context(p_admin_session_token);
  IF v_role <> 'super_admin' THEN RAISE EXCEPTION 'Super administrator permission is required.'; END IF;
  IF p_related_page NOT BETWEEN 0 AND 100000 OR p_related_page_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid evidence page.';
  END IF;
  SELECT to_jsonb(record) || jsonb_build_object(
    'related_total', (SELECT count(*) FROM private.content_audit_events event
      WHERE event.operation_id = record.operation_id AND event.employee_id = record.employee_id
        AND event.entity_type IN ('aaa_service', 'ccc_service')
        AND event.action IN ('employee_delete', 'admin_delete')),
    'related_items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', page.id, 'operation_id', page.operation_id, 'entity_type', page.entity_type, 'action', page.action,
      'occurred_at', page.occurred_at, 'cleared_at', page.cleared_at)
      ORDER BY page.occurred_at DESC, page.id DESC)
      FROM (SELECT event.id, event.operation_id, event.entity_type, event.action, event.occurred_at, event.cleared_at
        FROM private.content_audit_events event
        WHERE event.operation_id = record.operation_id AND event.employee_id = record.employee_id
          AND event.entity_type IN ('aaa_service', 'ccc_service')
          AND event.action IN ('employee_delete', 'admin_delete')
        ORDER BY event.occurred_at DESC, event.id DESC
        LIMIT p_related_page_size OFFSET p_related_page * p_related_page_size) page), '[]'::jsonb)
  ) INTO v_result FROM private.deleted_employee_accounts record WHERE record.id = p_record_id;
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.clear_deleted_employee_account(
  p_admin_session_token uuid, p_record_id uuid, p_reason text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp AS $$
DECLARE v_admin uuid; v_record private.deleted_employee_accounts%ROWTYPE;
BEGIN
  v_admin := private.assert_content_audit_purge(p_admin_session_token);
  IF length(btrim(COALESCE(p_reason, ''))) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'Enter a reason between 10 and 500 characters.';
  END IF;
  SELECT * INTO v_record FROM private.deleted_employee_accounts WHERE id = p_record_id FOR UPDATE;
  IF v_record.id IS NULL THEN RAISE EXCEPTION 'Employee deletion record is not available.'; END IF;
  IF v_record.cleared_at IS NOT NULL THEN RETURN true; END IF;
  UPDATE private.deleted_employee_accounts SET account_username = NULL, employee_number = NULL,
    owner_username = NULL, cleared_at = clock_timestamp(), cleared_by = v_admin,
    cleared_username = (SELECT username FROM public.admins WHERE id = v_admin), clear_reason = btrim(p_reason)
  WHERE id = p_record_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.list_deleted_employee_accounts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_deleted_employee_account FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_deleted_employee_account FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_deleted_employee_accounts TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_deleted_employee_account TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_deleted_employee_account TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
