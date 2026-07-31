const db = require('../db/db');
const { registrarAuditoria } = require('../utils/auditoria');
const { agoraBrasilia } = require('../utils/tempo');

/**
 * TRATATIVA DE ATRASO / ABONO DE HORAS.
 *
 * Três casos, um mecanismo (ver migração 0007):
 *   atraso_abonado    -> o atraso sai do relatório e o tempo volta para o saldo
 *   atraso_registrado -> fica documentado, mas o atraso continua contando
 *   atestado_horas    -> abona uma quantidade de minutos do dia
 *
 * A diferença entre abonar e apenas registrar é intencional: nem toda justificativa
 * deve apagar o atraso. "Combinei de chegar mais tarde" abona; "trânsito de novo"
 * é registrado para o gestor ter histórico sem premiar a recorrência.
 */

const TIPOS = ['atraso_abonado', 'atraso_registrado', 'atestado_horas'];

const ROTULOS = {
    atraso_abonado: 'Atraso abonado',
    atraso_registrado: 'Atraso registrado (mantido)',
    atestado_horas: 'Atestado de horas'
};

async function listar({ dataInicio, dataFim } = {}) {
    return db.all(
        `SELECT t.id, t.funcionario_id, t.data, t.tipo, t.minutos_abonados, t.motivo, t.criado_em,
                f.nome, f.emoji, f.regime
         FROM tratativas_atraso t JOIN funcionarios f ON f.id = t.funcionario_id
         WHERE t.data BETWEEN ? AND ?
         ORDER BY t.data DESC, f.nome ASC`,
        // Período aberto sem datas — mesmo motivo da escala de sábado: um abono
        // precisa valer no cálculo mesmo quando o relatório é pedido sem filtro.
        [dataInicio || '0000-01-01', dataFim || '9999-12-31']
    );
}

/** Mapa { `${funcionarioId}_${data}`: tratativa } — consumido pelo cálculo do dia. */
async function mapaDoPeriodo({ dataInicio, dataFim } = {}) {
    const linhas = await listar({ dataInicio, dataFim });
    const mapa = {};
    linhas.forEach((t) => { mapa[`${t.funcionario_id}_${t.data}`] = t; });
    return mapa;
}

/**
 * O `listar` usa INNER JOIN com funcionarios: uma tratativa apontando para um id
 * inexistente viraria uma linha invisível, aplicada no cálculo mas fora da tela.
 * Melhor recusar na entrada do que criar dado órfão.
 */
async function exigirFuncionario(funcionarioId) {
    const f = await db.get(`SELECT id FROM funcionarios WHERE id = ?`, [funcionarioId]);
    if (!f) {
        const erro = new Error('Colaborador não encontrado.');
        erro.status = 404;
        throw erro;
    }
}

/** Abonar horas de um dia que ainda não aconteceu não faz sentido — e esconderia erro de digitação. */
function exigirDataNaoFutura(data, hojeISO) {
    if (data > hojeISO) {
        const erro = new Error('Não é possível lançar uma tratativa para uma data futura.');
        erro.status = 400;
        throw erro;
    }
}

function validar(tipo, minutosAbonados) {
    if (!TIPOS.includes(tipo)) {
        const erro = new Error('Tipo de tratativa inválido.');
        erro.status = 400;
        throw erro;
    }
    if (tipo === 'atestado_horas' && (!minutosAbonados || minutosAbonados <= 0)) {
        const erro = new Error('Informe quantos minutos o atestado de horas abona.');
        erro.status = 400;
        throw erro;
    }
    if (minutosAbonados > 24 * 60) {
        const erro = new Error('O abono não pode passar de 24 horas em um dia.');
        erro.status = 400;
        throw erro;
    }
}

/**
 * Registra (ou atualiza) a tratativa de um dia. Upsert por (funcionário, data):
 * tratar o mesmo dia de novo corrige a decisão em vez de acumular registros.
 * Em `atraso_registrado` os minutos são forçados a 0 — é o que mantém o atraso.
 */
async function registrar({ funcionario_id, data, tipo, minutos_abonados, motivo }) {
    const minutos = tipo === 'atraso_registrado' ? 0 : Math.max(0, Number(minutos_abonados) || 0);
    validar(tipo, minutos);
    exigirDataNaoFutura(data, agoraBrasilia().data);
    await exigirFuncionario(funcionario_id);

    await db.run(
        `INSERT INTO tratativas_atraso (funcionario_id, data, tipo, minutos_abonados, motivo)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(funcionario_id, data) DO UPDATE SET
            tipo = excluded.tipo,
            minutos_abonados = excluded.minutos_abonados,
            motivo = excluded.motivo`,
        [funcionario_id, data, tipo, minutos, motivo || null]
    );

    await registrarAuditoria('tratar_atraso', 'tratativas_atraso', null, {
        funcionario_id, data, tipo, minutos_abonados: minutos, motivo
    });
    return db.get(`SELECT * FROM tratativas_atraso WHERE funcionario_id = ? AND data = ?`, [funcionario_id, data]);
}

/**
 * Aplica a MESMA tratativa a vários dias de uma vez. O upsert garante que repetir
 * a operação atualiza em vez de duplicar — mesmo padrão da justificativa de faltas.
 */
async function registrarEmLote(itens, { tipo, minutos_abonados, motivo }) {
    const minutos = tipo === 'atraso_registrado' ? 0 : Math.max(0, Number(minutos_abonados) || 0);
    validar(tipo, minutos);

    const hoje = agoraBrasilia().data;
    // Valida o lote inteiro ANTES de gravar: se um item estiver errado, ninguém é
    // gravado pela metade — o gestor corrige e reenvia.
    for (const item of itens) {
        exigirDataNaoFutura(item.data, hoje);
        await exigirFuncionario(item.funcionario_id);
    }

    let atualizados = 0;
    for (const item of itens) {
        const existente = await db.get(
            `SELECT id FROM tratativas_atraso WHERE funcionario_id = ? AND data = ?`,
            [item.funcionario_id, item.data]
        );
        if (existente) atualizados += 1;

        await db.run(
            `INSERT INTO tratativas_atraso (funcionario_id, data, tipo, minutos_abonados, motivo)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(funcionario_id, data) DO UPDATE SET
                tipo = excluded.tipo,
                minutos_abonados = excluded.minutos_abonados,
                motivo = excluded.motivo`,
            [item.funcionario_id, item.data, tipo, minutos, motivo || null]
        );
    }

    const resultado = { total: itens.length, criados: itens.length - atualizados, atualizados };
    await registrarAuditoria('tratar_atraso_lote', 'tratativas_atraso', null, { ...resultado, tipo, minutos_abonados: minutos, motivo });
    return resultado;
}

async function remover(id) {
    const tratativa = await db.get(`SELECT * FROM tratativas_atraso WHERE id = ?`, [id]);
    if (!tratativa) {
        const erro = new Error('Tratativa não encontrada.');
        erro.status = 404;
        throw erro;
    }
    await db.run(`DELETE FROM tratativas_atraso WHERE id = ?`, [id]);
    await registrarAuditoria('remover_tratativa_atraso', 'tratativas_atraso', id, {
        funcionario_id: tratativa.funcionario_id, data: tratativa.data, tipo: tratativa.tipo
    });
}

module.exports = { TIPOS, ROTULOS, listar, mapaDoPeriodo, registrar, registrarEmLote, remover, exigirDataNaoFutura };
