const db = require('../db/db');
const { registrarAuditoria } = require('../utils/auditoria');
const { grupoDoDia, formatarDataBR } = require('../utils/tempo');

/**
 * TROCA DE DIA — a pessoa folga num dia e trabalha em outro no lugar.
 *
 * O efeito no cálculo está em calculoJornada.service: a jornada do dia da folga
 * é MOVIDA para o dia trabalhado. Sem isso o sistema marcaria falta num dia e
 * hora extra de 100% no outro, o que é errado nas duas pontas.
 */

async function listar({ dataInicio, dataFim } = {}) {
    const condicoes = [];
    const params = [];
    if (dataInicio) { condicoes.push('(t.data_folga >= ? OR t.data_trabalho >= ?)'); params.push(dataInicio, dataInicio); }
    if (dataFim) { condicoes.push('(t.data_folga <= ? OR t.data_trabalho <= ?)'); params.push(dataFim, dataFim); }
    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

    return db.all(
        `SELECT t.id, t.funcionario_id, t.data_folga, t.data_trabalho, t.observacao, t.criado_em,
                f.nome, f.emoji, f.regime
         FROM trocas_dia t JOIN funcionarios f ON f.id = t.funcionario_id
         ${where}
         ORDER BY t.data_trabalho DESC`,
        params
    );
}

/**
 * Mapa { `${funcionarioId}_${data}`: { papel, dataFolga, dataTrabalho } } para o período.
 * Cada troca aparece DUAS vezes no mapa — uma na data da folga e outra na data do
 * trabalho — porque o cálculo consulta por dia e precisa saber qual dos dois papéis
 * aquele dia cumpre.
 */
async function mapaDoPeriodo({ dataInicio, dataFim } = {}) {
    const trocas = await listar({ dataInicio, dataFim });
    const mapa = {};
    trocas.forEach((t) => {
        mapa[`${t.funcionario_id}_${t.data_folga}`] = {
            papel: 'folga', dataFolga: t.data_folga, dataTrabalho: t.data_trabalho
        };
        mapa[`${t.funcionario_id}_${t.data_trabalho}`] = {
            papel: 'trabalho', dataFolga: t.data_folga, dataTrabalho: t.data_trabalho
        };
    });
    return mapa;
}

/** Datas que o funcionário tem como folga compensada — usado pelo cálculo de faltas. */
async function folgasPorFuncionario({ dataInicio, dataFim } = {}) {
    const linhas = await db.all(
        `SELECT funcionario_id, data_folga FROM trocas_dia
         WHERE data_folga BETWEEN ? AND ?`,
        [dataInicio, dataFim]
    );
    return new Set(linhas.map((l) => `${l.funcionario_id}_${l.data_folga}`));
}

async function criar({ funcionario_id, data_folga, data_trabalho, observacao }) {
    if (data_folga === data_trabalho) {
        const erro = new Error('O dia de folga e o dia de trabalho precisam ser diferentes.');
        erro.status = 400;
        throw erro;
    }

    const funcionario = await db.get(
        `SELECT id, nome, regime FROM funcionarios WHERE id = ? AND ativo = 1`,
        [funcionario_id]
    );
    if (!funcionario) {
        const erro = new Error('Funcionário não encontrado ou inativo.');
        erro.status = 404;
        throw erro;
    }

    // O dia da folga precisa ser um dia em que a pessoa realmente trabalharia —
    // trocar uma folga por outra folga não faz sentido e distorceria o saldo.
    const grupoFolga = grupoDoDia(data_folga);
    if (grupoFolga) {
        const jornada = await db.get(
            `SELECT trabalha FROM jornada_funcionario WHERE funcionario_id = ? AND grupo_dia = ?`,
            [funcionario_id, grupoFolga]
        );
        if (!jornada || !jornada.trabalha) {
            const erro = new Error(`${formatarDataBR(data_folga)} não é dia de trabalho na jornada de ${funcionario.nome} — não há o que compensar.`);
            erro.status = 400;
            throw erro;
        }
    } else {
        const erro = new Error('O dia de folga não pode ser um domingo (domingo já é descanso).');
        erro.status = 400;
        throw erro;
    }

    const conflito = await db.get(
        `SELECT data_folga, data_trabalho FROM trocas_dia
         WHERE funcionario_id = ? AND (data_folga IN (?, ?) OR data_trabalho IN (?, ?))`,
        [funcionario_id, data_folga, data_trabalho, data_folga, data_trabalho]
    );
    if (conflito) {
        const erro = new Error(
            `Já existe uma troca desse funcionário envolvendo ${formatarDataBR(conflito.data_folga)} ou ${formatarDataBR(conflito.data_trabalho)}.`
        );
        erro.status = 409;
        throw erro;
    }

    const { lastID } = await db.run(
        `INSERT INTO trocas_dia (funcionario_id, data_folga, data_trabalho, observacao)
         VALUES (?, ?, ?, ?)`,
        [funcionario_id, data_folga, data_trabalho, observacao || null]
    );

    await registrarAuditoria('registrar_troca_dia', 'trocas_dia', lastID, {
        funcionario: funcionario.nome, regime: funcionario.regime, data_folga, data_trabalho, observacao
    });
    return { id: lastID, funcionario_id, data_folga, data_trabalho, observacao: observacao || null };
}

async function remover(id) {
    const troca = await db.get(
        `SELECT t.*, f.nome FROM trocas_dia t JOIN funcionarios f ON f.id = t.funcionario_id WHERE t.id = ?`,
        [id]
    );
    if (!troca) {
        const erro = new Error('Troca de dia não encontrada.');
        erro.status = 404;
        throw erro;
    }

    await db.run(`DELETE FROM trocas_dia WHERE id = ?`, [id]);
    await registrarAuditoria('remover_troca_dia', 'trocas_dia', id, {
        funcionario: troca.nome, data_folga: troca.data_folga, data_trabalho: troca.data_trabalho
    });
}

module.exports = { listar, mapaDoPeriodo, folgasPorFuncionario, criar, remover };
