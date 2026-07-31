-- ESCALA DE SÁBADO
--
-- Estagiário não trabalha sábado por padrão, mas é escalado eventualmente — por
-- necessidade da loja ou por vontade dele de acumular banco de horas. Por isso a
-- escala é por DATA, e não uma chave "trabalha aos sábados" na jornada: o sábado
-- 08/08 pode valer para um estagiário e não para outro.
--
-- Consequências de estar escalado num sábado:
--   * o dia passa a ter meta (a jornada de sábado da pessoa vale naquele dia)
--   * não aparecer gera FALTA no relatório — é compromisso assumido
--   * mas essa falta NÃO desconta na folha, porque o sábado não faz parte da
--     jornada contratual do estagiário
--
-- Sábado sem escala continua não gerando falta nenhuma.

CREATE TABLE IF NOT EXISTS escala_sabado (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    funcionario_id INTEGER NOT NULL,
    data TEXT NOT NULL,
    observacao TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id),
    UNIQUE(funcionario_id, data)
);

CREATE INDEX IF NOT EXISTS idx_escala_sabado_data ON escala_sabado(data);
