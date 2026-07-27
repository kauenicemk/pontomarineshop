-- Simplificação pedida pelo cliente: sem período aquisitivo/concessivo/tabela do Art. 130.
-- Só o essencial: quem, de quando a quando, e uma observação livre.
DROP TABLE IF EXISTS periodos_ferias;

CREATE TABLE IF NOT EXISTS ferias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    funcionario_id INTEGER NOT NULL,
    data_inicio TEXT NOT NULL,
    data_fim TEXT NOT NULL,
    observacao TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)
);
CREATE INDEX IF NOT EXISTS idx_ferias_por_funcionario ON ferias(funcionario_id);
CREATE INDEX IF NOT EXISTS idx_ferias_datas ON ferias(data_inicio, data_fim);
