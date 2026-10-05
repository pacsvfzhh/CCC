CREATE OR REPLACE FUNCTION public.list_unpurged_archived_employees(p_admin_session_token uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp AS $$
DECLARE v_role text; v_result jsonb;
BEGIN
  SELECT admin_role INTO v_role FROM private.get_financial_admin_context(p_admin_session_token);
  IF v_role IS DISTINCT FROM 'super_admin' THEN RAISE EXCEPTION 'Super administrator permission is required.'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'employee_id', employee.id,
    'username', employee.username,
    'employee_number', employee.employee_id,
    'owner_username', owner.username,
    'archived_at', employee.archived_at,
    'order_count', (SELECT count(*) FROM public.orders item WHERE item.user_id = employee.id),
    'processing_order_count', (SELECT count(*) FROM public.orders item WHERE item.user_id = employee.id AND item.status = 'processing'),
    'historical_order_count',
      (SELECT count(*) FROM public.orders_history item WHERE item.user_id = employee.id)
      + (SELECT count(*) FROM public.orders_history_2025 item WHERE item.user_id = employee.id)
      + (SELECT count(*) FROM public.orders_history_2026 item WHERE item.user_id = employee.id),
    'withdrawal_count', (SELECT count(*) FROM public.withdrawals item WHERE item.user_id = employee.id),
    'pending_withdrawal_count', (SELECT count(*) FROM public.withdrawals item WHERE item.user_id = employee.id AND item.status = 'pending'),
    'available_balance', (SELECT available_balance FROM public.wallets wallet WHERE wallet.user_id = employee.id),
    'frozen_balance', (SELECT frozen_balance FROM public.wallets wallet WHERE wallet.user_id = employee.id),
    'audit_count', (SELECT count(*) FROM private.content_audit_events event WHERE event.employee_id = employee.id),
    'active_chat_count', (SELECT count(*) FROM public.customer_employee_conversations chat WHERE chat.employee_id = employee.id),
    'candidate_image_count', media.candidate_count,
    'quick_send_image_count', media.quick_send_count
  ) ORDER BY employee.archived_at DESC, employee.id), '[]'::jsonb) INTO v_result
  FROM public.users employee
  LEFT JOIN public.admins owner ON owner.id = employee.created_by
  LEFT JOIN LATERAL (
    SELECT count(*) AS candidate_count,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM public.cs_message_templates template
        WHERE strpos(COALESCE(template.content, ''), image.path) > 0
      )) AS quick_send_count
    FROM (
      SELECT DISTINCT substring(ref.url FROM '/storage/v1/object/public/chat-images/([^?#]+)$') AS path
      FROM private.content_audit_events event
      CROSS JOIN LATERAL jsonb_object_keys(COALESCE(event.media_refs, '{}'::jsonb)) ref(url)
      WHERE event.employee_id = employee.id
    ) image
    JOIN storage.objects object ON object.bucket_id = 'chat-images' AND object.name = image.path
  ) media ON true
  WHERE employee.archived_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM private.deleted_employee_accounts record WHERE record.employee_id = employee.id);
  RETURN v_result;
END;
$$;
