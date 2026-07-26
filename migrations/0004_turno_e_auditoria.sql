-- Auditoria: passa a registrar QUEM fez cada alteração (antes só havia a ação e a data).
-- Sem isso, o sistema continua funcionando e grava o log no formato antigo (sem autor),
-- mas a tela "Log de Auditoria" não abre.
--
-- Observação: o TURNO (Manhã/Tarde, Tarde/Noite) NÃO é coluna do banco — é deduzido
-- automaticamente do horário de entrada da jornada, em public/js/turno.js. Por isso
-- esta migração não mexe na tabela de funcionários.

ALTER TABLE log_auditoria ADD COLUMN admin_id INTEGER;
ALTER TABLE log_auditoria ADD COLUMN admin_nome TEXT;
ALTER TABLE log_auditoria ADD COLUMN ip TEXT;
ALTER TABLE log_auditoria ADD COLUMN rota TEXT;

CREATE INDEX IF NOT EXISTS idx_auditoria_criado_em ON log_auditoria(criado_em);
CREATE INDEX IF NOT EXISTS idx_auditoria_admin ON log_auditoria(admin_id);
