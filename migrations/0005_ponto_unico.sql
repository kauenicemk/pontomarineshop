-- Impede DUAS batidas do mesmo tipo no mesmo dia para o mesmo funcionário.
--
-- Até aqui essa regra existia só na aplicação (ver validarSequenciaDoDia em
-- ponto.service.js). Bastava um ajuste manual ou dois cliques simultâneos para
-- gravar duas "Entrada" no mesmo dia — e o relatório passava a considerar apenas
-- a última, sem ninguém perceber. Agora o próprio banco recusa.

-- 1) Limpa duplicatas que já existam, mantendo SEMPRE a batida mais recente
--    (id maior = registrada ou corrigida por último).
DELETE FROM registro_ponto
WHERE id NOT IN (
    SELECT MAX(id) FROM registro_ponto GROUP BY funcionario_id, data, tipo
);

-- 2) Passa a barrar novas duplicatas no nível do banco.
CREATE UNIQUE INDEX IF NOT EXISTS idx_registro_unico
    ON registro_ponto(funcionario_id, data, tipo);

-- Índice que faltava: a tela de Pendências e o cálculo de faltas filtram ausências
-- por data em toda atualização.
CREATE INDEX IF NOT EXISTS idx_ausencias_data ON ausencias(data);
