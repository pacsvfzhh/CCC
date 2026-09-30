CREATE FUNCTION private.enforce_conversation_source_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  SELECT customer.source_type INTO NEW.source_type
  FROM public.simulated_customers AS customer
  WHERE customer.id = NEW.customer_id;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.enforce_conversation_source_type() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_enforce_conversation_source_type
BEFORE INSERT OR UPDATE OF customer_id, source_type ON public.customer_employee_conversations
FOR EACH ROW EXECUTE FUNCTION private.enforce_conversation_source_type();

CREATE FUNCTION private.sync_customer_conversation_source_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.customer_employee_conversations
  SET source_type = NEW.source_type
  WHERE customer_id = NEW.id
    AND source_type IS DISTINCT FROM NEW.source_type;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.sync_customer_conversation_source_type() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_sync_customer_conversation_source_type
AFTER UPDATE OF source_type ON public.simulated_customers
FOR EACH ROW
WHEN (OLD.source_type IS DISTINCT FROM NEW.source_type)
EXECUTE FUNCTION private.sync_customer_conversation_source_type();

UPDATE public.customer_employee_conversations AS conversation
SET source_type = customer.source_type
FROM public.simulated_customers AS customer
WHERE customer.id = conversation.customer_id
  AND conversation.source_type IS DISTINCT FROM customer.source_type;

CREATE OR REPLACE FUNCTION public.get_admin_groups_for_customer_service(p_source_type text DEFAULT NULL)
RETURNS TABLE(
  admin_id uuid,
  admin_username text,
  admin_role text,
  employee_count bigint,
  customer_count bigint,
  conversation_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  SELECT
    admin.id,
    admin.username,
    admin.role,
    (
      SELECT COUNT(*)
      FROM public.users AS employee
      WHERE employee.created_by = admin.id
    ),
    (
      SELECT COUNT(*)
      FROM public.simulated_customers AS customer
      WHERE customer.admin_id = admin.id
        AND (p_source_type IS NULL OR customer.source_type = p_source_type)
    ),
    (
      SELECT COUNT(DISTINCT (conversation.customer_id, conversation.employee_id))
      FROM public.customer_employee_conversations AS conversation
      JOIN public.simulated_customers AS customer ON customer.id = conversation.customer_id
      JOIN public.users AS employee ON employee.id = conversation.employee_id
      WHERE customer.admin_id = admin.id
        AND employee.created_by = admin.id
        AND (p_source_type IS NULL OR customer.source_type = p_source_type)
        AND (p_source_type IS NULL OR conversation.source_type = p_source_type)
    )
  FROM public.admins AS admin
  WHERE admin.role <> 'emergency_admin'
    AND admin.is_active = true
  ORDER BY CASE WHEN admin.role = 'super_admin' THEN 1
                WHEN admin.role = 'secondary_admin' THEN 2
                ELSE 3 END, admin.username;
$function$;
