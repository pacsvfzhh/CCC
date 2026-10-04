DO $purge_patch$
DECLARE
  definition text;
BEGIN
  definition := pg_get_functiondef('public.finish_deleted_employee_archive_delete(uuid, uuid)'::regprocedure);
  IF strpos(definition, 'v_employee_ids uuid[];') = 0
    OR strpos(definition, 'DELETE FROM public.financial_operations WHERE actor_id = ANY(v_employee_ids);') = 0
    OR strpos(definition, 'DELETE FROM public.users WHERE id = ANY(v_employee_ids);') = 0
    OR strpos(definition, 'DELETE FROM private.deleted_employee_accounts WHERE id = ANY(v_job.account_ids);') = 0 THEN
    RAISE EXCEPTION 'Unexpected employee purge definition.';
  END IF;

  definition := replace(definition,
    'v_employee_ids uuid[];',
    'v_employee_ids uuid[];' || E'\n  ' || 'v_withdrawal_ids uuid[];');

  definition := replace(definition,
    'DELETE FROM public.financial_operations WHERE actor_id = ANY(v_employee_ids);',
    $financial_cleanup$
    UPDATE public.financial_operations operation
    SET request_data = jsonb_set(operation.request_data, '{recipient_ids}', (
      SELECT COALESCE(jsonb_agg(recipient.id ORDER BY recipient.position), '[]'::jsonb)
      FROM jsonb_array_elements(operation.request_data -> 'recipient_ids')
        WITH ORDINALITY recipient(id, position)
      WHERE recipient.id #>> '{}' <> ALL(v_employee_ids::text[])
    ))
    WHERE operation.operation_type = 'admin_message_send'
      AND jsonb_typeof(operation.request_data -> 'recipient_ids') = 'array'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(operation.request_data -> 'recipient_ids') recipient(id)
        WHERE recipient.id = ANY(v_employee_ids::text[])
      );

    SELECT COALESCE(array_agg(withdrawal.id), '{}'::uuid[]) INTO v_withdrawal_ids
    FROM public.withdrawals withdrawal WHERE withdrawal.user_id = ANY(v_employee_ids);

    DELETE FROM public.financial_operations operation
    WHERE (operation.actor_type = 'employee' AND operation.actor_id = ANY(v_employee_ids))
      OR (operation.operation_type IN ('admin_adjust_wallet', 'notification_automation_bonus')
        AND operation.request_data ->> 'user_id' = ANY(v_employee_ids::text[]))
      OR (operation.operation_type = 'customer_service_tip'
        AND operation.request_data ->> 'employee_id' = ANY(v_employee_ids::text[]))
      OR (operation.operation_type IN ('review_withdrawal', 'correct_withdrawal_status')
        AND operation.request_data ->> 'withdrawal_id' = ANY(v_withdrawal_ids::text[]));

    UPDATE public.dispatch_performance_metrics metric
    SET metadata = metric.metadata - 'user_id'
    WHERE metric.metadata ->> 'user_id' = ANY(v_employee_ids::text[]);

    PERFORM 1 FROM public.simulated_customers customer
    WHERE customer.target_employee_id = ANY(v_employee_ids)
      OR customer.target_employee_ids && v_employee_ids
    ORDER BY customer.id FOR UPDATE;
    IF EXISTS (
      SELECT 1 FROM public.simulated_customers customer
      WHERE (customer.target_employee_id = ANY(v_employee_ids)
        OR customer.target_employee_ids && v_employee_ids)
        AND NOT EXISTS (
          SELECT 1 FROM unnest(COALESCE(customer.target_employee_ids, '{}'::uuid[])) target(id)
          WHERE target.id <> ALL(v_employee_ids)
        )
    ) THEN
      RAISE EXCEPTION 'A shared customer is assigned only to this employee. Reassign or disable that customer before permanent deletion.';
    END IF;
    UPDATE public.simulated_customers customer
    SET target_employee_id = CASE WHEN customer.target_employee_id = ANY(v_employee_ids)
      THEN NULL ELSE customer.target_employee_id END,
      target_employee_ids = ARRAY(
        SELECT target.id FROM unnest(customer.target_employee_ids) target(id)
        WHERE target.id <> ALL(v_employee_ids)
      )
    WHERE customer.target_employee_ids && v_employee_ids;
    UPDATE public.simulated_customers customer
    SET target_employee_id = NULL
    WHERE customer.target_employee_id = ANY(v_employee_ids);

    DELETE FROM public.message_recipients recipient
    WHERE recipient.recipient_id = ANY(v_employee_ids);
    $financial_cleanup$);

  definition := replace(definition,
    'DELETE FROM public.users WHERE id = ANY(v_employee_ids);',
    $after_user_delete$
    DELETE FROM public.users WHERE id = ANY(v_employee_ids);
    DELETE FROM private.content_audit_recipient_versions
    WHERE recipient_id = ANY(v_employee_ids);
    $after_user_delete$);

  definition := replace(definition,
    'DELETE FROM private.deleted_employee_accounts WHERE id = ANY(v_job.account_ids);',
    $verify_cleanup$
  IF EXISTS (SELECT 1 FROM public.message_recipients WHERE recipient_id = ANY(v_employee_ids))
    OR EXISTS (SELECT 1 FROM private.content_audit_recipient_versions WHERE recipient_id = ANY(v_employee_ids))
    OR EXISTS (SELECT 1 FROM public.dispatch_system_logs WHERE user_id = ANY(v_employee_ids))
    OR EXISTS (SELECT 1 FROM public.dispatch_performance_metrics WHERE metadata ->> 'user_id' = ANY(v_employee_ids::text[]))
    OR EXISTS (SELECT 1 FROM public.simulated_customers customer
      WHERE customer.target_employee_id = ANY(v_employee_ids)
        OR customer.target_employee_ids && v_employee_ids)
    OR EXISTS (SELECT 1 FROM public.financial_operations operation
      WHERE (operation.actor_type = 'employee' AND operation.actor_id = ANY(v_employee_ids))
        OR (operation.operation_type IN ('admin_adjust_wallet', 'notification_automation_bonus')
          AND operation.request_data ->> 'user_id' = ANY(v_employee_ids::text[]))
        OR (operation.operation_type = 'customer_service_tip'
          AND operation.request_data ->> 'employee_id' = ANY(v_employee_ids::text[]))
        OR (operation.operation_type IN ('review_withdrawal', 'correct_withdrawal_status')
          AND operation.request_data ->> 'withdrawal_id' = ANY(v_withdrawal_ids::text[]))
        OR (operation.operation_type = 'admin_message_send'
          AND jsonb_typeof(operation.request_data -> 'recipient_ids') = 'array'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(operation.request_data -> 'recipient_ids') recipient(id)
            WHERE recipient.id = ANY(v_employee_ids::text[])
          ))) THEN
    RAISE EXCEPTION 'Employee-linked data remains; permanent deletion was rolled back.';
  END IF;
  DELETE FROM private.deleted_employee_accounts WHERE id = ANY(v_job.account_ids);
    $verify_cleanup$);

  EXECUTE definition;
END;
$purge_patch$;

REVOKE ALL ON FUNCTION public.finish_deleted_employee_archive_delete(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_deleted_employee_archive_delete(uuid, uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
