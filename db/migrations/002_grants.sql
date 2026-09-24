-- A aplicação não é dona de nada: fica sujeita ao RLS sem exceção.
grant usage on schema public to ng_app;
grant select, insert, update, delete on all tables in schema public to ng_app;
grant usage, select on all sequences in schema public to ng_app;
grant execute on all functions in schema public to ng_app;
-- defesa em profundidade além do trigger
revoke update, delete on evento_ledger from ng_app;
revoke update, delete on webhook_evento from ng_app;
