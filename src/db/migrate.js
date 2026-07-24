const bcrypt = require('bcryptjs');
const db = require('./db');
const config = require('../config');

const SCHEMA_SQL = `
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
`;

async function migrar() {
    await migrarJornadaParaDiasIndividuais(); // precisa rodar ANTES do CREATE TABLE (olha o schema antigo)
    await migrarConfigHorasExtras();
    await db.exec(SCHEMA_SQL);
    await migrarAusenciasSemTravaDeTipo();
    await migrarColunasFuncionario();

    // PIN administrativo: so cria se ainda nao existir nenhum hash salvo.
    const existente = await db.get(`SELECT valor FROM configuracoes WHERE chave = 'admin_pin_hash'`);
    if (!existente) {
        const hash = await bcrypt.hash(String(config.adminPinInicial), 10);
        await db.run(`INSERT INTO configuracoes (chave, valor) VALUES ('admin_pin_hash', ?)`, [hash]);
        console.log(`⚙️  PIN administrativo inicial configurado (definido em ADMIN_PIN_INICIAL). Troque assim que possível na aba Administração.`);
    }

    // Percentuais padrao (dia_util, domingo_feriado, adicional_noturno), so os que faltarem.
    const defaults = require('../config').horasExtrasPadrao;
    for (const [tipo, percentual] of Object.entries(defaults)) {
        const existe = await db.get(`SELECT 1 FROM config_horas_extras WHERE tipo = ?`, [tipo]);
        if (!existe) await db.run(`INSERT INTO config_horas_extras (tipo, percentual) VALUES (?, ?)`, [tipo, percentual]);
    }
}

/**
 * `CREATE TABLE IF NOT EXISTS` não atualiza uma tabela que já existe — quem já tinha
 * funcionários cadastrados antes dos campos de admissão/salário/cargo/departamento existirem
 * precisa que essas colunas sejam adicionadas na tabela já existente. `ALTER TABLE ADD COLUMN`
 * é seguro pra isso (diferente de mudar um CHECK, não precisa recriar a tabela) — só confere
 * antes se a coluna já existe, pra não tentar adicionar duas vezes.
 */
async function migrarColunasFuncionario() {
    const colunas = await db.all(`PRAGMA table_info(funcionarios)`);
    const nomesExistentes = colunas.map((c) => c.name);

    const novasColunas = [
        { nome: 'data_admissao', sql: `ALTER TABLE funcionarios ADD COLUMN data_admissao TEXT` },
        { nome: 'salario_base', sql: `ALTER TABLE funcionarios ADD COLUMN salario_base REAL` },
        { nome: 'cargo', sql: `ALTER TABLE funcionarios ADD COLUMN cargo TEXT` },
        { nome: 'departamento', sql: `ALTER TABLE funcionarios ADD COLUMN departamento TEXT` }
    ];

    let adicionouAlguma = false;
    for (const col of novasColunas) {
        if (!nomesExistentes.includes(col.nome)) {
            await db.exec(col.sql);
            adicionouAlguma = true;
        }
    }
    if (adicionouAlguma) {
        console.log('⚙️  Banco atualizado: funcionários agora têm campos de admissão, salário-base, cargo e departamento (ficam em branco até serem preenchidos).');
    }
}

/**
 * `CREATE TABLE IF NOT EXISTS` não atualiza uma tabela que já existe — então quem já tinha
 * rodado uma versão anterior (com a trava CHECK(tipo IN ('atestado','ferias','licenca','folga')))
 * continuaria travado mesmo depois de atualizar o código. Esta função detecta a trava antiga
 * e recria a tabela sem ela, preservando todos os dados já cadastrados.
 */
async function migrarAusenciasSemTravaDeTipo() {
    const tabela = await db.get(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ausencias'`);
    if (!tabela || !tabela.sql.includes("CHECK(tipo IN")) return; // já está sem a trava (instalação nova)

    await db.exec(`
        ALTER TABLE ausencias RENAME TO ausencias_old_migracao;

        CREATE TABLE ausencias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            funcionario_id INTEGER NOT NULL,
            data TEXT NOT NULL,
            tipo TEXT NOT NULL,
            justificativa TEXT,
            criado_em TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id),
            UNIQUE(funcionario_id, data)
        );

        INSERT INTO ausencias (id, funcionario_id, data, tipo, justificativa, criado_em)
            SELECT id, funcionario_id, data, tipo, justificativa, criado_em FROM ausencias_old_migracao;

        DROP TABLE ausencias_old_migracao;
    `);
    console.log('⚙️  Banco atualizado: a tabela "ausencias" agora aceita novos tipos (ex: "sem_justificativa") sem precisar mexer no código.');
}

/**
 * Expande a jornada de 3 grupos ('seg_qui','sexta','sabado') para 6 dias individuais
 * ('segunda'..'sabado'), preservando a configuração de cada funcionário: o que estava em
 * "seg_qui" vira 4 linhas idênticas (segunda, terca, quarta, quinta); sexta e sábado só são
 * renomeados/mantidos como já estavam.
 */
async function migrarJornadaParaDiasIndividuais() {
    const tabela = await db.get(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'jornada_funcionario'`);
    if (!tabela || !tabela.sql.includes("'seg_qui'")) return; // já está no formato novo (ou instalação nova)

    const linhasAntigas = await db.all(`SELECT funcionario_id, grupo_dia, horario_entrada, meta_minutos, trabalha FROM jornada_funcionario`);

    await db.exec(`
        ALTER TABLE jornada_funcionario RENAME TO jornada_funcionario_old_migracao;

        CREATE TABLE jornada_funcionario (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            funcionario_id INTEGER NOT NULL,
            grupo_dia TEXT NOT NULL CHECK(grupo_dia IN ('segunda','terca','quarta','quinta','sexta','sabado')),
            horario_entrada TEXT NOT NULL DEFAULT '08:00',
            meta_minutos INTEGER NOT NULL DEFAULT 480,
            trabalha INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id),
            UNIQUE(funcionario_id, grupo_dia)
        );
    `);

    const MAPA = { seg_qui: ['segunda', 'terca', 'quarta', 'quinta'], sexta: ['sexta'], sabado: ['sabado'] };
    for (const linha of linhasAntigas) {
        const novosGrupos = MAPA[linha.grupo_dia] || [];
        for (const novoGrupo of novosGrupos) {
            await db.run(
                `INSERT INTO jornada_funcionario (funcionario_id, grupo_dia, horario_entrada, meta_minutos, trabalha)
                 VALUES (?, ?, ?, ?, ?)`,
                [linha.funcionario_id, novoGrupo, linha.horario_entrada, linha.meta_minutos, linha.trabalha]
            );
        }
    }

    await db.exec(`DROP TABLE jornada_funcionario_old_migracao;`);
    console.log('⚙️  Banco atualizado: jornada agora é configurável em cada um dos 6 dias da semana individualmente (a configuração antiga foi preservada e expandida automaticamente).');
}

/**
 * Remove o tipo "sabado" de config_horas_extras (sábado agora conta como "dia_util") e garante
 * que exista uma linha para "adicional_noturno".
 */
async function migrarConfigHorasExtras() {
    const tabela = await db.get(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'config_horas_extras'`);
    if (!tabela || !tabela.sql.includes("'sabado'")) return; // já está no formato novo (ou instalação nova)

    await db.exec(`
        ALTER TABLE config_horas_extras RENAME TO config_horas_extras_old_migracao;

        CREATE TABLE config_horas_extras (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tipo TEXT NOT NULL UNIQUE CHECK(tipo IN ('dia_util','domingo_feriado','adicional_noturno')),
            percentual REAL NOT NULL
        );

        INSERT INTO config_horas_extras (id, tipo, percentual)
            SELECT id, tipo, percentual FROM config_horas_extras_old_migracao WHERE tipo != 'sabado';

        DROP TABLE config_horas_extras_old_migracao;
    `);
    console.log('⚙️  Banco atualizado: percentual de sábado removido (sábado agora conta como "dia útil"); adicional noturno adicionado.');
}

module.exports = { migrar };
