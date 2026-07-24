const db = require('../db/db');
const { registrarAuditoria } = require('../utils/auditoria');

function hojeISO() {
    return new Date().toISOString().slice(0, 10);
}

function somarDias(dataISO, dias) {
    const d = new Date(`${dataISO}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
}

/** 'ativa' (hoje está dentro do período) | 'futura' | 'encerrada'. */
function calcularStatus(dataInicio, dataFim, hoje) {
    if (hoje < dataInicio) return 'futura';
    if (hoje > dataFim) return 'encerrada';
    return 'ativa';
}

/** Lista todos os períodos de férias (de todo mundo), com o status já calculado — usado na tela principal de Férias. */
async function listar() {
    const linhas = await db.all(
        `SELECT f.id, f.funcionario_id, f.data_inicio, f.data_fim, f.observacao, f.criado_em,
                fu.nome, fu.emoji
         FROM ferias f
         JOIN funcionarios fu ON fu.id = f.funcionario_id
         ORDER BY f.data_inicio DESC`
    );
    const hoje = hojeISO();
    return linhas.map((l) => ({ ...l, status: calcularStatus(l.data_inicio, l.data_fim, hoje) }));
}

/** Histórico de férias de UM funcionário. */
async function listarPorFuncionario(funcionarioId) {
    const linhas = await db.all(
        `SELECT id, funcionario_id, data_inicio, data_fim, observacao, criado_em
         FROM ferias WHERE funcionario_id = ? ORDER BY data_inicio DESC`,
        [funcionarioId]
    );
    const hoje = hojeISO();
    return linhas.map((l) => ({ ...l, status: calcularStatus(l.data_inicio, l.data_fim, hoje) }));
}

/** Quem está de férias HOJE — usado no resumo/dashboard administrativo. */
async function quemEstaDeFeriasAgora() {
    const hoje = hojeISO();
    return db.all(
        `SELECT f.id, fu.id as funcionario_id, fu.nome, fu.emoji, f.data_inicio, f.data_fim
         FROM ferias f
         JOIN funcionarios fu ON fu.id = f.funcionario_id
         WHERE f.data_inicio <= ? AND f.data_fim >= ?
         ORDER BY fu.nome ASC`,
        [hoje, hoje]
    );
}

/**
 * Registra um período de férias. Cria também uma ausência tipo 'ferias' pra cada dia do
 * período — reaproveita a lógica de faltas/relatório que já existe (dia de férias nunca
 * conta como falta, e já fica registrado no histórico do funcionário automaticamente).
 */
async function criar({ funcionario_id, data_inicio, data_fim, observacao }) {
    if (data_fim < data_inicio) {
        const erro = new Error('A data de término não pode ser antes da data de início.');
        erro.status = 400;
        throw erro;
    }

    const { lastID } = await db.run(
        `INSERT INTO ferias (funcionario_id, data_inicio, data_fim, observacao) VALUES (?, ?, ?, ?)`,
        [funcionario_id, data_inicio, data_fim, observacao || null]
    );

    let cursor = data_inicio;
    while (cursor <= data_fim) {
        await db.run(
            `INSERT OR IGNORE INTO ausencias (funcionario_id, data, tipo, justificativa) VALUES (?, ?, 'ferias', 'Férias')`,
            [funcionario_id, cursor]
        );
        cursor = somarDias(cursor, 1);
    }

    await registrarAuditoria('registrar_ferias', 'ferias', lastID, { funcionario_id, data_inicio, data_fim });
    return { id: lastID, funcionario_id, data_inicio, data_fim, observacao: observacao || null };
}

/** Remove um período de férias e as ausências correspondentes (libera os dias de volta). */
async function remover(id) {
    const periodo = await db.get(`SELECT * FROM ferias WHERE id = ?`, [id]);
    if (!periodo) {
        const erro = new Error('Período de férias não encontrado.');
        erro.status = 404;
        throw erro;
    }

    await db.run(
        `DELETE FROM ausencias WHERE funcionario_id = ? AND tipo = 'ferias' AND data BETWEEN ? AND ?`,
        [periodo.funcionario_id, periodo.data_inicio, periodo.data_fim]
    );
    await db.run(`DELETE FROM ferias WHERE id = ?`, [id]);
    await registrarAuditoria('remover_ferias', 'ferias', id, {});
}

module.exports = { listar, listarPorFuncionario, quemEstaDeFeriasAgora, criar, remover };
