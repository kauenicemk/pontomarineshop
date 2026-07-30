-- ============================================================================
-- TROCA DE DIA (folga compensada)
--
-- Caso real: o funcionário precisa faltar no sábado dia 08 e trabalha no domingo
-- dia 02 em troca. Sem isso, o sistema entenderia duas coisas erradas ao mesmo
-- tempo: falta no sábado E hora extra de 100% no domingo.
--
-- A troca MOVE a jornada de um dia para o outro:
--   data_folga    -> meta zero, sem falta e sem atraso
--   data_trabalho -> herda a meta e o horário de entrada do dia da folga, e o
--                    trabalho conta como jornada normal (não como extra de domingo)
--
-- CLT normalmente compensa em domingo; estagiário costuma compensar em sábado —
-- o sistema não impõe: qualquer par de datas é aceito.
-- ============================================================================
CREATE TABLE IF NOT EXISTS trocas_dia (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    funcionario_id INTEGER NOT NULL,
    data_folga TEXT NOT NULL,     -- dia que a pessoa deixou de trabalhar
    data_trabalho TEXT NOT NULL,  -- dia trabalhado em compensação
    observacao TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id),
    -- Um dia só pode ser folga de uma troca, e só pode ser trabalho de uma troca.
    UNIQUE(funcionario_id, data_folga),
    UNIQUE(funcionario_id, data_trabalho)
);
CREATE INDEX IF NOT EXISTS idx_trocas_funcionario ON trocas_dia(funcionario_id);
CREATE INDEX IF NOT EXISTS idx_trocas_folga ON trocas_dia(data_folga);
CREATE INDEX IF NOT EXISTS idx_trocas_trabalho ON trocas_dia(data_trabalho);

-- ============================================================================
-- TRATATIVA DE ATRASO / ABONO DE HORAS
--
-- Três situações diferentes com um mecanismo só (`minutos_abonados`):
--
--   atraso_abonado    -> combinou entrar mais tarde: o atraso SAI do relatório e
--                        o tempo perdido é devolvido ao saldo do dia
--   atraso_registrado -> o atraso PERMANECE no relatório (questão de disciplina),
--                        mas fica documentado com o motivo e quem registrou
--   atestado_horas    -> abona um número de minutos do dia (consulta médica no
--                        meio do expediente, por exemplo). Muito mais comum que o
--                        atestado de dia inteiro, que já existia em `ausencias`.
--
-- Em `atraso_registrado` os minutos abonados são 0 de propósito: é o que separa
-- "justificado e perdoado" de "justificado mas ainda conta".
-- ============================================================================
CREATE TABLE IF NOT EXISTS tratativas_atraso (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    funcionario_id INTEGER NOT NULL,
    data TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK(tipo IN ('atraso_abonado', 'atraso_registrado', 'atestado_horas')),
    minutos_abonados INTEGER NOT NULL DEFAULT 0,
    motivo TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id),
    -- Uma tratativa por dia: registrar de novo atualiza a existente.
    UNIQUE(funcionario_id, data)
);
CREATE INDEX IF NOT EXISTS idx_tratativas_funcionario ON tratativas_atraso(funcionario_id);
CREATE INDEX IF NOT EXISTS idx_tratativas_data ON tratativas_atraso(data);
