-- Schema inicial para Cloudflare D1. Mesmo conteúdo de SCHEMA_SQL em src/db/migrate.js
-- (usado no caminho Node local) — nenhuma tabela/coluna foi alterada, só movido para o
-- formato de migration que o Wrangler exige (aplicar com: wrangler d1 migrations apply).


CREATE TABLE IF NOT EXISTS funcionarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    emoji TEXT UNIQUE NOT NULL,
    nome TEXT NOT NULL,
    regime TEXT NOT NULL CHECK(regime IN ('CLT','ESTAGIARIO','PJ')),
    horas_diarias TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    tolerancia_almoco_min INTEGER NOT NULL DEFAULT 60,
    almoco_flexivel INTEGER NOT NULL DEFAULT 0,
    data_admissao TEXT,
    salario_base REAL,
    cargo TEXT,
    departamento TEXT,
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Ferias: um periodo aquisitivo por linha (1 ano a partir da admissao). dias_direito segue a
-- tabela do Art. 130 da CLT, calculada a partir das faltas injustificadas dentro do periodo.
CREATE TABLE IF NOT EXISTS periodos_ferias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    funcionario_id INTEGER NOT NULL,
    aquisitivo_inicio TEXT NOT NULL,
    aquisitivo_fim TEXT NOT NULL,
    concessivo_limite TEXT NOT NULL,
    dias_direito INTEGER NOT NULL DEFAULT 30,
    dias_gozados INTEGER NOT NULL DEFAULT 0,
    dias_abono INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'aberto' CHECK(status IN ('aberto','agendado','gozado','vencido')),
    data_inicio_gozo TEXT,
    data_fim_gozo TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id),
    UNIQUE(funcionario_id, aquisitivo_inicio)
);
CREATE INDEX IF NOT EXISTS idx_ferias_funcionario ON periodos_ferias(funcionario_id);

-- Confirmacao digital de leitura do espelho de ponto mensal (o "assinou e concordou").
CREATE TABLE IF NOT EXISTS espelho_confirmacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    funcionario_id INTEGER NOT NULL,
    mes_referencia TEXT NOT NULL,
    confirmado_em TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id),
    UNIQUE(funcionario_id, mes_referencia)
);

-- Jornada configurável em cada um dos 6 dias da semana individualmente (domingo fica de fora
-- de propósito, nunca é configurável). Cada funcionário tem até 6 linhas aqui.
CREATE TABLE IF NOT EXISTS jornada_funcionario (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    funcionario_id INTEGER NOT NULL,
    grupo_dia TEXT NOT NULL CHECK(grupo_dia IN ('segunda','terca','quarta','quinta','sexta','sabado')),
    horario_entrada TEXT NOT NULL DEFAULT '08:00',
    meta_minutos INTEGER NOT NULL DEFAULT 480,
    trabalha INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id),
    UNIQUE(funcionario_id, grupo_dia)
);

CREATE TABLE IF NOT EXISTS registro_ponto (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    funcionario_id INTEGER NOT NULL,
    data TEXT NOT NULL,
    hora TEXT NOT NULL,
    data_hora_iso TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK(tipo IN ('Entrada','Saída Almoço','Retorno Almoço','Saída Final')),
    justificativa TEXT DEFAULT NULL,
    ajuste_manual INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)
);
CREATE INDEX IF NOT EXISTS idx_registro_funcionario ON registro_ponto(funcionario_id);
CREATE INDEX IF NOT EXISTS idx_registro_data ON registro_ponto(data);
CREATE INDEX IF NOT EXISTS idx_registro_func_data ON registro_ponto(funcionario_id, data);

CREATE TABLE IF NOT EXISTS feriados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data TEXT NOT NULL UNIQUE,
    nome TEXT NOT NULL,
    abrangencia TEXT NOT NULL DEFAULT 'empresa' CHECK(abrangencia IN ('nacional','estadual','municipal','empresa')),
    exige_compensacao INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ausencias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    funcionario_id INTEGER NOT NULL,
    data TEXT NOT NULL,
    tipo TEXT NOT NULL,
    justificativa TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id),
    UNIQUE(funcionario_id, data)
);

-- Reconhecimento facial: guarda so o DESCRITOR (vetor de ~128 numeros que representa o rosto),
-- nunca a foto em si. Cada funcionario pode ter ate 3 amostras (melhora a taxa de acerto).
CREATE TABLE IF NOT EXISTS biometria_facial (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    funcionario_id INTEGER NOT NULL,
    descritor TEXT NOT NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)
);
CREATE INDEX IF NOT EXISTS idx_biometria_funcionario ON biometria_facial(funcionario_id);

-- Percentuais de hora extra (sábado conta como "dia_util") e do adicional noturno.
CREATE TABLE IF NOT EXISTS config_horas_extras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL UNIQUE CHECK(tipo IN ('dia_util','domingo_feriado','adicional_noturno')),
    percentual REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS configuracoes (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS log_auditoria (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    acao TEXT NOT NULL,
    entidade TEXT NOT NULL,
    entidade_id INTEGER,
    detalhes TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);


-- Percentuais padrão (mesmos valores de config.horasExtrasPadrao).
INSERT OR IGNORE INTO config_horas_extras (tipo, percentual) VALUES
    ('dia_util', 0.60),
    ('domingo_feriado', 1.00),
    ('adicional_noturno', 0.20);
