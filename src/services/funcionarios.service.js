const bcrypt = require('bcryptjs');
const db = require('../db/db');
const config = require('../config');
const { registrarAuditoria } = require('../utils/auditoria');
const { DIAS_SEMANA } = require('../utils/tempo');

const GRUPOS_JORNADA = DIAS_SEMANA; // ['segunda','terca','quarta','quinta','sexta','sabado']

/**
 * JORNADA VERSIONADA POR VIGÊNCIA (migração 0009).
 *
 * Cada dia da semana pode ter várias versões, cada uma com a data em que passou a
 * valer. O cálculo de um dia usa a versão vigente NAQUELE dia — sem isso, mudar o
 * horário de alguém reescrevia todo o histórico de atrasos, inclusive de meses já
 * fechados e assinados.
 *
 * `agruparVersoes` devolve { segunda: [v2, v1], ... } com as versões da mais recente
 * para a mais antiga, que é a ordem em que `jornadaVigenteEm` procura.
 */
function agruparVersoes(linhas) {
    const mapa = {};
    linhas.forEach((l) => {
        if (!mapa[l.grupo_dia]) mapa[l.grupo_dia] = [];
        mapa[l.grupo_dia].push({
            vigencia_inicio: l.vigencia_inicio || '0001-01-01',
            horario_entrada: l.horario_entrada,
            meta_minutos: l.meta_minutos,
            trabalha: !!l.trabalha
        });
    });
    Object.values(mapa).forEach((v) => v.sort((a, b) => b.vigencia_inicio.localeCompare(a.vigencia_inicio)));
    return mapa;
}

/**
 * Achata as versões para a configuração válida numa data: { segunda: {...}, ... }.
 * É o formato que o cálculo do dia e o relatório de faltas consomem.
 *
 * Se nenhuma versão começou até a data pedida (dia anterior à primeira vigência),
 * usa a versão MAIS ANTIGA. Alternativa seria tratar como "não trabalha", mas isso
 * transformaria em falta todo dia anterior ao cadastro — pior que assumir que a
 * primeira configuração conhecida já valia.
 */
function jornadaVigenteEm(versoesPorGrupo, dataISO) {
    const mapa = {};
    Object.entries(versoesPorGrupo || {}).forEach(([grupo, versoes]) => {
        if (!versoes.length) return;
        const escolhida = versoes.find((v) => v.vigencia_inicio <= dataISO) || versoes[versoes.length - 1];
        mapa[grupo] = {
            horario_entrada: escolhida.horario_entrada,
            meta_minutos: escolhida.meta_minutos,
            trabalha: escolhida.trabalha
        };
    });
    return mapa;
}

/** Mantido para quem só quer "como está hoje" — telas de configuração e listagens. */
function agruparJornada(linhas) {
    const hoje = require('../utils/tempo').agoraBrasilia().data;
    return jornadaVigenteEm(agruparVersoes(linhas), hoje);
}

/** Busca a jornada VIGENTE HOJE (6 dias) de UM funcionário. */
async function buscarJornada(funcionarioId) {
    const linhas = await db.all(`SELECT * FROM jornada_funcionario WHERE funcionario_id = ?`, [funcionarioId]);
    return agruparJornada(linhas);
}

/** Todas as versões de UM funcionário — usado pela tela de configuração para mostrar o histórico. */
async function buscarVersoesDaJornada(funcionarioId) {
    const linhas = await db.all(
        `SELECT * FROM jornada_funcionario WHERE funcionario_id = ? ORDER BY vigencia_inicio DESC`,
        [funcionarioId]
    );
    return agruparVersoes(linhas);
}

/**
 * Jornada de TODOS, com TODAS as versões (evita N+1 nas listagens).
 * Quem calcula um dia precisa passar por `jornadaVigenteEm` com a data daquele dia.
 */
async function buscarJornadaDeTodos() {
    const linhas = await db.all(`SELECT * FROM jornada_funcionario`);
    const porFuncionario = {};
    linhas.forEach((l) => {
        if (!porFuncionario[l.funcionario_id]) porFuncionario[l.funcionario_id] = [];
        porFuncionario[l.funcionario_id].push(l);
    });
    const resultado = {};
    Object.keys(porFuncionario).forEach((fid) => { resultado[fid] = agruparVersoes(porFuncionario[fid]); });
    return resultado;
}

/** Mesma coisa, mas já achatada na vigência de hoje — para telas que só mostram o atual. */
async function buscarJornadaAtualDeTodos() {
    const versoes = await buscarJornadaDeTodos();
    const hoje = require('../utils/tempo').agoraBrasilia().data;
    const resultado = {};
    Object.entries(versoes).forEach(([fid, v]) => { resultado[fid] = jornadaVigenteEm(v, hoje); });
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
 * Salva a jornada com DATA DE VIGÊNCIA (migração 0009).
 *
 * `vigenciaInicio` é o dia a partir do qual o novo horário passa a valer. Salvar cria
 * uma versão nova em vez de sobrescrever, então os dias anteriores continuam sendo
 * calculados com o horário que estava em vigor na época — é isso que impede um
 * espelho de ponto já assinado de mudar sozinho quando alguém troca de turno.
 *
 * Salvar duas vezes com a MESMA vigência atualiza aquela versão (o gestor está
 * corrigindo o que acabou de digitar, não criando um novo período).
 *
 * `vigenciaInicio = '0001-01-01'` é o modo "corrigir o passado": sobrescreve a
 * versão original e vale desde sempre. Serve para erro de digitação, não para
 * troca de turno de verdade.
 */
async function atualizarJornadaCompleta(funcionarioId, jornada, vigenciaInicio) {
    const vigencia = vigenciaInicio || require('../utils/tempo').agoraBrasilia().data;

    for (const grupo of GRUPOS_JORNADA) {
        const cfg = jornada[grupo];
        if (!cfg) continue;
        await db.run(
            `INSERT INTO jornada_funcionario (funcionario_id, grupo_dia, vigencia_inicio, horario_entrada, meta_minutos, trabalha)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(funcionario_id, grupo_dia, vigencia_inicio) DO UPDATE SET
                horario_entrada = excluded.horario_entrada,
                meta_minutos = excluded.meta_minutos,
                trabalha = excluded.trabalha`,
            [funcionarioId, grupo, vigencia, cfg.horario_entrada, cfg.meta_minutos, cfg.trabalha ? 1 : 0]
        );
    }
    await registrarAuditoria('atualizar_jornada', 'funcionario', funcionarioId, { vigencia_inicio: vigencia, jornada });
}

/**
 * Remove uma versão da jornada (desfaz uma vigência lançada por engano).
 * A versão original ('0001-01-01') não pode ser removida — sem ela, dias antigos
 * ficariam sem nenhuma configuração.
 */
async function removerVersaoDaJornada(funcionarioId, vigenciaInicio) {
    if (!vigenciaInicio || vigenciaInicio === '0001-01-01') {
        const erro = new Error('A configuração original não pode ser removida.');
        erro.status = 400;
        throw erro;
    }
    const { changes } = await db.run(
        `DELETE FROM jornada_funcionario WHERE funcionario_id = ? AND vigencia_inicio = ?`,
        [funcionarioId, vigenciaInicio]
    );
    if (!changes) {
        const erro = new Error('Vigência não encontrada.');
        erro.status = 404;
        throw erro;
    }
    await registrarAuditoria('remover_vigencia_jornada', 'funcionario', funcionarioId, { vigencia_inicio: vigenciaInicio });
}

/** Liga/desliga o horário de entrada fixo. Sem horário fixo, a pessoa nunca gera atraso. */
async function atualizarEntradaFlexivel(funcionarioId, flexivel) {
    await db.run(`UPDATE funcionarios SET entrada_flexivel = ? WHERE id = ?`, [flexivel ? 1 : 0, funcionarioId]);
    await registrarAuditoria('atualizar_entrada_flexivel', 'funcionario', funcionarioId, { entrada_flexivel: !!flexivel });
}

// O TURNO (Manhã/Tarde, Tarde/Noite) não é coluna do banco: é deduzido no front
// a partir do horário de entrada da jornada (ver public/js/turno.js). Serve para
// exibição e filtro, e acompanha sozinho qualquer mudança de horário.

/** Lista pública (sem o hash do PIN) — usada no mural de bater ponto e nos seletores. */
async function listarAtivos() {
    return db.all(
        `SELECT id, emoji, nome, regime, horas_diarias, tolerancia_almoco_min, almoco_flexivel, entrada_flexivel
         FROM funcionarios WHERE ativo = 1 ORDER BY nome ASC`
    );
}

/** Lista completa (uso administrativo), com a jornada de cada um já embutida (jornada: {...}). */
async function listarTodos() {
    const funcionarios = await db.all(
        `SELECT id, emoji, nome, regime, horas_diarias, tolerancia_almoco_min, almoco_flexivel, entrada_flexivel,
                data_admissao, salario_base, cargo, departamento, ativo
         FROM funcionarios ORDER BY nome ASC`
    );
    const jornadas = await buscarJornadaDeTodos();
    return funcionarios.map((f) => ({ ...f, jornada: jornadas[f.id] || {} }));
}

async function buscarPorId(id) {
    const funcionario = await db.get(
        `SELECT id, emoji, nome, regime, horas_diarias, tolerancia_almoco_min, almoco_flexivel, entrada_flexivel,
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
 * Isso substitui a lista de exceções por nome que existia hardcoded no código original —
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
    buscarJornadaAtualDeTodos,
    buscarVersoesDaJornada,
    jornadaVigenteEm,
    atualizarJornadaCompleta,
    removerVersaoDaJornada,
    atualizarEntradaFlexivel,
    atualizarRegrasAlmoco,
    atualizarDadosCadastrais,
    atualizarAtivo,
    atualizarRegime,
    removerOuDemitir,
    conferirPin
};
