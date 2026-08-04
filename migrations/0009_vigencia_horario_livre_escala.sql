-- =====================================================================
-- 1. VIGÊNCIA DA JORNADA
-- =====================================================================
-- Até aqui `jornada_funcionario` tinha UMA linha por (funcionário, dia da semana),
-- sem nenhuma noção de "desde quando". Consequência: trocar o horário de alguém
-- RECALCULAVA TODO O PASSADO. Uma pessoa do turno da tarde que entrava 13:20 com
-- horário de 13:00 (atraso de 20 min) passava a ter 5h20 de atraso naquele mesmo
-- dia se o horário dela mudasse para 08:00 — inclusive em meses cujo espelho de
-- ponto já tinha sido conferido e assinado.
--
-- Agora cada alteração cria uma VERSÃO com data de início. O cálculo de um dia usa
-- a versão vigente naquele dia, então o passado congela.
--
-- As linhas que já existem recebem vigência '0001-01-01' — valem desde sempre, o
-- que preserva exatamente o comportamento atual para todo o histórico já gravado.

CREATE TABLE jornada_funcionario_nova (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    funcionario_id INTEGER NOT NULL,
    grupo_dia TEXT NOT NULL CHECK(grupo_dia IN ('segunda','terca','quarta','quinta','sexta','sabado')),
    vigencia_inicio TEXT NOT NULL DEFAULT '0001-01-01',
    horario_entrada TEXT NOT NULL DEFAULT '08:00',
    meta_minutos INTEGER NOT NULL DEFAULT 480,
    trabalha INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id),
    UNIQUE(funcionario_id, grupo_dia, vigencia_inicio)
);

INSERT INTO jornada_funcionario_nova
    (id, funcionario_id, grupo_dia, vigencia_inicio, horario_entrada, meta_minutos, trabalha)
SELECT id, funcionario_id, grupo_dia, '0001-01-01', horario_entrada, meta_minutos, trabalha
FROM jornada_funcionario;

DROP TABLE jornada_funcionario;
ALTER TABLE jornada_funcionario_nova RENAME TO jornada_funcionario;

-- Busca sempre por (funcionário, dia da semana) ordenando pela vigência.
CREATE INDEX IF NOT EXISTS idx_jornada_vigencia
    ON jornada_funcionario(funcionario_id, grupo_dia, vigencia_inicio);

-- =====================================================================
-- 2. COLABORADOR SEM HORÁRIO DE ENTRADA FIXO
-- =====================================================================
-- Alguns cargos não têm hora de chegada combinada. Para eles, "atraso" não existe:
-- cobrar pontualidade de quem não tem horário é inventar uma falta.
--
-- A carga horária diária CONTINUA valendo — o que muda é só o atraso. Assim o saldo,
-- o banco de horas e a falta seguem funcionando normalmente.
--
-- Segue o mesmo padrão do `almoco_flexivel`, que já existia: chave por colaborador,
-- não por dia, porque na prática ou a pessoa tem horário ou não tem.

ALTER TABLE funcionarios ADD COLUMN entrada_flexivel INTEGER NOT NULL DEFAULT 0;

-- =====================================================================
-- 3. ESCALA DE DIA (SÁBADO E DOMINGO)
-- =====================================================================
-- A `escala_sabado` da migração 0008 vira `escala_dia`, agora cobrindo domingo também.
-- O dia da semana é derivado da data — não precisa de coluna de tipo.
--
-- Regras que dependem do dia e do regime (ver calculoJornada e ausencias):
--
--   SÁBADO escalado
--     * vale a jornada de sábado da pessoa (meta, horário de entrada)
--     * gera atraso e gera falta
--     * DESCONTA para CLT   -> escalado, o sábado é obrigação daquele dia
--     * NÃO desconta para estagiário -> ele está ali por escala eventual ou para
--       fazer banco de horas; o que trabalhar é somado ao banco
--
--   DOMINGO escalado
--     * NÃO existe atraso de domingo (não há horário de entrada de domingo)
--     * sem meta: o dia inteiro é hora extra de 100%
--     * faltar conta como falta no relatório, mas nunca desconta

CREATE TABLE IF NOT EXISTS escala_dia (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    funcionario_id INTEGER NOT NULL,
    data TEXT NOT NULL,
    observacao TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id),
    UNIQUE(funcionario_id, data)
);

INSERT OR IGNORE INTO escala_dia (funcionario_id, data, observacao, criado_em)
SELECT funcionario_id, data, observacao, criado_em FROM escala_sabado;

DROP TABLE IF EXISTS escala_sabado;

CREATE INDEX IF NOT EXISTS idx_escala_dia_data ON escala_dia(data);
