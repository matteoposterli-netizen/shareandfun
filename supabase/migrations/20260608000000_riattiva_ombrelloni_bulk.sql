-- Bulk reactivation of ombrelloni (counterpart to disattiva_ombrelloni_bulk).
-- Used by the "✅ Attiva" bulk action in the Ombrelloni e Clienti toolbar.
CREATE OR REPLACE FUNCTION public.riattiva_ombrelloni_bulk(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count int;
BEGIN
  UPDATE public.ombrelloni
  SET attivo = true
  WHERE id = ANY(p_ids)
    AND stabilimento_id IN (
      SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid())
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('riattivati', v_count);
END;
$function$;
