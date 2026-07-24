const db = require('../db/db');
const { registrarAuditoria } = require('../utils/auditoria');

async function listar() {
    return db.all(`SELECT * FROM feriados ORDER BY data ASC`);
}

/** Retorna um Set com as datas (YYYY-MM-DD) de feriado dentro de um intervalo — usado pelo cálculo de jornada. */
async function buscarComoConjunto({ dataInicio, dataFim } = {}) {
    const condicoes = [];
    const params = [];
    if (dataInicio) { condicoes.push('data >= ?'); params.push(dataInicio); }
    if (dataFim) { condicoes.push('data <= ?'); params.push(dataFim); }
    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

    const linhas = await db.all(`SELECT data FROM feriados ${where}`, params);
    return new Set(linhas.map((l) => l.data));
}

async function criar({ data, nome, abrangencia, exige_compensacao }) {
    const { lastID } = await db.run(
        `INSERT INTO feriados (data, nome, abrangencia, exige_compensacao) VALUES (?, ?, ?, ?)`,
        [data, nome, abrangencia || 'empresa', exige_compensacao ? 1 : 0]
    );
    await registrarAuditoria('criar', 'feriado', lastID, { data, nome });
    return db.get(`SELECT * FROM feriados WHERE id = ?`, [lastID]);
}

async function remover(id) {
    await db.run(`DELETE FROM feriados WHERE id = ?`, [id]);
    await registrarAuditoria('remover', 'feriado', id, {});
}

module.exports = { listar, buscarComoConjunto, criar, remover };
