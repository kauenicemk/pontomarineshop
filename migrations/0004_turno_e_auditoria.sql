-- Turno do funcionário: agora é um CAMPO EDITÁVEL (antes era só derivado do horário
-- de entrada). Dois turnos, conforme a operação da loja:
--   manha_tarde = Manhã/Tarde  (entra antes das 11:00)
--   tarde_noite = Tarde/Noite  (entra às 11:00 ou depois)
ALTER TABLE funcionarios ADD COLUMN turno TEXT NOT NULL DEFAULT 'manha_tarde';

-- Valor inicial de quem já está cadastrado: deduzido do horário de entrada da
-- segunda-feira (ou do primeiro dia de trabalho configurado), com o corte às 11:00.
UPDATE funcionarios
SET turno = 'tarde_noite'
WHERE id IN (
    SELECT j.funcionario_id
    FROM jornada_funcionario j
    WHERE j.trabalha = 1
      AND j.grupo_dia = (
          SELECT j2.grupo_dia FROM jornada_funcionario j2
          WHERE j2.funcionario_id = j.funcionario_id AND j2.trabalha = 1
          ORDER BY CASE j2.grupo_dia
              WHEN 'segunda' THEN 1 WHEN 'terca' THEN 2 WHEN 'quarta' THEN 3
              WHEN 'quinta' THEN 4 WHEN 'sexta' THEN 5 ELSE 6 END
          LIMIT 1
      )
      AND CAST(substr(j.horario_entrada, 1, 2) AS INTEGER) >= 11
);

-- Auditoria: passa a registrar QUEM fez cada alteração (antes só havia a ação e a data).
ALTER TABLE log_auditoria ADD COLUMN admin_id INTEGER;
ALTER TABLE log_auditoria ADD COLUMN admin_nome TEXT;
ALTER TABLE log_auditoria ADD COLUMN ip TEXT;
ALTER TABLE log_auditoria ADD COLUMN rota TEXT;

CREATE INDEX IF NOT EXISTS idx_auditoria_criado_em ON log_auditoria(criado_em);
CREATE INDEX IF NOT EXISTS idx_auditoria_admin ON log_auditoria(admin_id);
