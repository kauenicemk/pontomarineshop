const bcrypt = require('bcryptjs');
const db = require('../db/db');
const config = require('../config');
const { registrarAuditoria } = require('../utils/auditoria');
const { DIAS_SEMANA } = require('../utils/tempo');

const GRUPOS_JORNADA = DIAS_SEMANA; // ['segunda','terca','quarta','quinta','sexta','sabado']

/** Monta um mapa { segunda: {...}, terca: {...}, ..., sabado: {...} } a partir das linhas cruas da tabela. */
function agruparJornada(linhas) {
    const mapa = {};
    linhas.forEach((l) => {
        mapa[l.grupo_dia] = {
            horario_entrada: l.horario_entrada,
            meta_minutos: l.meta_minutos,
            trabalha: !!l.trabalha
        };
    });
    return mapa;
}

/** Busca a jornada (6 dias) de UM funcionário. */
async function buscarJornada(funcionarioId) {
    const linhas = await db.all(`SELECT * FROM jornada_funcionario WHERE funcionario_id = ?`, [funcionarioId]);
    return agruparJornada(linhas);
}

/** Busca a jornada de TODOS os funcionários de uma vez (evita N+1 query nas listagens). */
async function buscarJornadaDeTodos() {
    const linhas = await db.all(`SELECT * FROM jornada_funcionario`);
    const porFuncionario = {};
    linhas.forEach((l) => {
        if (!porFuncionario[l.funcionario_id]) porFuncionario[l.funcionario_id] = [];
        porFuncionario[l.funcionario_id].push(l);
    });
    const resultado = {};
    Object.keys(porFuncionario).forEach((fid) => { resultado[fid] = agruparJornada(porFuncionario[fid]); });
    return resultado;
}

/** Cria as 6 linhas de jornada padrão (uma por dia da semana) para um funcionário recém-cadastrado. */
async function criarJornadaPadrao(funcionarioId, regime) {
    const metaPadrao = regime === 'CLT' ? config.jornada.metaMinutosCLT
        : regime === 'ESTAGIARIO' ? config.jornada.metaMinutosEstagiario
            : 0;
    const metaSexta = metaPadrao > 0 ? Math.min(metaPadrao, config.jornada.metaMinutosSextaPadrao) : 0;

    const linhasPadrao = {
        segunda: { horario_entrada: '08:00', meta_minutos: metaPadrao, trabalha: metaPadrao > 0 ? 1 : 0 },
        terca: { horario_entrada: '08:00', meta_minutos: metaPadrao, trabalha: metaPadrao > 0 ? 1 : 0 },
        quarta: { horario_entrada: '08:00', meta_minutos: metaPadrao, trabalha: metaPadrao > 0 ? 1 : 0 },
        quinta: { horario_entrada: '08:00', meta_minutos: metaPadrao, trabalha: metaPadrao > 0 ? 1 : 0 },
        sexta: { horario_entrada: '08:00', meta_minutos: metaSexta, trabalha: metaPadrao > 0 ? 1 : 0 },
        sabado: { horario_entrada: '08:00', meta_minutos: 0, trabalha: 0 }
    };

    for (const grupo of GRUPOS_JORNADA) {
        const l = linhasPadrao[grupo];
        await db.run(
            `INSERT INTO jornada_funcionario (funcionario_id, grupo_dia, horario_entrada, meta_minutos, trabalha)
             VALUES (?, ?, ?, ?, ?)`,
            [funcionarioId, grupo, l.horario_entrada, l.meta_minutos, l.trabalha]
        );
    }
}

/**
 * Atualiza a jornada completa (os 6 dias de uma vez) de um funcionário.
 * `jornada` é um objeto { segunda: {horario_entrada, meta_minutos, trabalha}, terca: {...}, ... }.
 */
async function atualizarJornadaCompleta(funcionarioId, jornada) {
    for (const grupo of GRUPOS_JORNADA) {
        const cfg = jornada[grupo];
        if (!cfg) continue;
        await db.run(
            `INSERT INTO jornada_funcionario (funcionario_id, grupo_dia, horario_entrada, meta_minutos, trabalha)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(funcionario_id, grupo_dia) DO UPDATE SET
                horario_entrada = excluded.horario_entrada,
                meta_minutos = excluded.meta_minutos,
                trabalha = excluded.trabalha`,
            [funcionarioId, grupo, cfg.horario_entrada, cfg.meta_minutos, cfg.trabalha ? 1 : 0]
        );
    }
    await registrarAuditoria('atualizar_jornada', 'funcionario', funcionarioId, jornada);
}

// O TURNO (Manhã/Tarde, Tarde/Noite) não é coluna do banco: é deduzido no front
// a partir do horário de entrada da jornada (ver public/js/turno.js). Serve para
// exibição e filtro, e acompanha sozinho qualquer mudança de horário.

/** Lista pública (sem o hash do PIN) — usada no mural de bater ponto e nos seletores. */
async function listarAtivos() {
    return db.all(
        `SELECT id, emoji, nome, regime, horas_diarias, tolerancia_almoco_min, almoco_flexivel
         FROM funcionarios WHERE ativo = 1 ORDER BY nome ASC`
    );
}

/** Lista completa (uso administrativo), com a jornada de cada um já embutida (jornada: {...}). */
async function listarTodos() {
    const funcionarios = await db.all(
        `SELECT id, emoji, nome, regime, horas_diarias, tolerancia_almoco_min, almoco_flexivel,
                data_admissao, salario_base, cargo, departamento, ativo
         FROM funcionarios ORDER BY nome ASC`
    );
    const jornadas = await buscarJornadaDeTodos();
    return funcionarios.map((f) => ({ ...f, jornada: jornadas[f.id] || {} }));
}

async function buscarPorId(id) {
    const funcionario = await db.get(
        `SELECT id, emoji, nome, regime, horas_diarias, tolerancia_almoco_min, almoco_flexivel,
                data_admissao, salario_base, cargo, departamento, ativo
         FROM funcionarios WHERE id = ?`,
        [id]
    );
    if (!funcionario) return null;
    funcionario.jornada = await buscarJornada(id);
    return funcionario;
}

async function criar({ emoji, nome, regime, horas_diarias, pin, tolerancia_almoco_min, almoco_flexivel, data_admissao, salario_base, cargo, departamento }) {
    const pinHash = await bcrypt.hash(pin, 10);
    const toleranciaPadrao = tolerancia_almoco_min ?? (regime === 'ESTAGIARIO' ? 15 : 60);

    const { lastID } = await db.run(
        `INSERT INTO funcionarios (emoji, nome, regime, horas_diarias, pin_hash, tolerancia_almoco_min, almoco_flexivel, data_admissao, salario_base, cargo, departamento)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [emoji, nome, regime, horas_diarias, pinHash, toleranciaPadrao, almoco_flexivel ? 1 : 0,
            data_admissao || null, salario_base ?? null, cargo || null, departamento || null]
    );

    await criarJornadaPadrao(lastID, regime);
    await registrarAuditoria('criar', 'funcionario', lastID, { nome, regime });
    return buscarPorId(lastID);
}

/**
 * Atualiza os dados cadastrais complementares: data de admissão (usada pro cálculo de férias),
 * salário-base (usado pra converter hora extra/noturno de % pra R$), cargo e departamento
 * (usados pra segmentar relatórios/indicadores). Todos opcionais — o sistema funciona sem eles,
 * só fica sem esses recursos específicos até serem preenchidos.
 */
async function atualizarDadosCadastrais(id, { data_admissao, salario_base, cargo, departamento }) {
    await db.run(
        `UPDATE funcionarios SET data_admissao = ?, salario_base = ?, cargo = ?, departamento = ? WHERE id = ?`,
        [data_admissao || null, salario_base ?? null, cargo || null, departamento || null, id]
    );
    await registrarAuditoria('atualizar_dados_cadastrais', 'funcionario', id, { data_admissao, salario_base, cargo, departamento });
}

/**
 * Atualiza as regras de almoço do funcionário (tolerância em minutos e/ou flexibilidade total).
 * Isso substitui a lista de exceções por nome que existia hardcoded no server.js original —
 * agora qualquer responsável ajusta isso pela tela de Administração, sem precisar mexer em código.
 */
async function atualizarRegrasAlmoco(id, { tolerancia_almoco_min, almoco_flexivel }) {
    await db.run(
        `UPDATE funcionarios SET tolerancia_almoco_min = ?, almoco_flexivel = ? WHERE id = ?`,
        [tolerancia_almoco_min, almoco_flexivel ? 1 : 0, id]
    );
    await registrarAuditoria('atualizar_regras_almoco', 'funcionario', id, { tolerancia_almoco_min, almoco_flexivel });
}

async function atualizarAtivo(id, ativo) {
    await db.run(`UPDATE funcionarios SET ativo = ? WHERE id = ?`, [ativo ? 1 : 0, id]);
    await registrarAuditoria(ativo ? 'readmitir' : 'desativar', 'funcionario', id, {});
}

/** Efetivação de estagiário (ou qualquer troca de regime CLT/ESTAGIARIO/PJ). */
async function atualizarRegime(id, regime) {
    await db.run(`UPDATE funcionarios SET regime = ? WHERE id = ?`, [regime, id]);
    await registrarAuditoria('atualizar_regime', 'funcionario', id, { regime });
}


/**
 * "Demitir" um funcionário de forma simples, sem perder o histórico de ponto exigido para
 * fins trabalhistas/auditoria:
 * - Se o funcionário NUNCA bateu ponto nem tem ausência registrada (ex: cadastro feito por
 *   engano), remove o registro de vez (junto com a jornada dele).
 * - Se já existe histórico, apenas desativa (soft delete): ele some do mural de bater ponto
 *   e das listas ativas, mas os registros antigos continuam intactos e consultáveis.
 */
async function removerOuDemitir(id) {
    const [registros, ausencias] = await Promise.all([
        db.get(`SELECT COUNT(*) as total FROM registro_ponto WHERE funcionario_id = ?`, [id]),
        db.get(`SELECT COUNT(*) as total FROM ausencias WHERE funcionario_id = ?`, [id])
    ]);
    const temHistorico = registros.total > 0 || ausencias.total > 0;

    // Biometria facial é dado pessoal sensível (LGPD) — nunca faz sentido reter isso de alguém
    // que não trabalha mais lá, então é sempre removida, mesmo quando o histórico de ponto fica.
    await db.run(`DELETE FROM biometria_facial WHERE funcionario_id = ?`, [id]);

    if (!temHistorico) {
        await db.run(`DELETE FROM jornada_funcionario WHERE funcionario_id = ?`, [id]);
        await db.run(`DELETE FROM funcionarios WHERE id = ?`, [id]);
        await registrarAuditoria('excluir_definitivamente', 'funcionario', id, {});
        return { removidoDefinitivamente: true };
    }

    await db.run(`UPDATE funcionarios SET ativo = 0 WHERE id = ?`, [id]);
    await registrarAuditoria('demitir', 'funcionario', id, {});
    return { removidoDefinitivamente: false };
}

/** Confere o PIN pessoal do funcionário (usado hoje só para reautenticar em ações do próprio funcionário). */
async function conferirPin(id, pin) {
    const row = await db.get(`SELECT pin_hash FROM funcionarios WHERE id = ?`, [id]);
    if (!row) return false;
    return bcrypt.compare(pin, row.pin_hash);
}

module.exports = {
    GRUPOS_JORNADA,
    listarAtivos,
    listarTodos,
    buscarPorId,
    criar,
    buscarJornada,
    buscarJornadaDeTodos,
    atualizarJornadaCompleta,
    atualizarRegrasAlmoco,
    atualizarDadosCadastrais,
    atualizarAtivo,
    atualizarRegime,
    removerOuDemitir,
    conferirPin
};
