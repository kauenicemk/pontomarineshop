const db = require('../db/db');
const { registrarAuditoria } = require('../utils/auditoria');
const { diaDaSemana, agoraBrasilia } = require('../utils/tempo');

/**
 * ESCALA DE SÁBADO (ver migração 0008).
 *
 * O estagiário não tem sábado na jornada contratual. Quando ele é escalado — por
 * necessidade da loja ou porque quer acumular banco de horas — aquele sábado passa
 * a valer como dia de trabalho SÓ para ele e SÓ naquela data.
 *
 * A regra que importa: se estava escalado e não veio, gera falta (é compromisso
 * assumido, entra no relatório de disciplina), mas essa falta não pode virar
 * desconto na folha — o sábado nunca foi obrigação contratual.
 */

async function listar({ dataInicio, dataFim } = {}) {
    // Período aberto quando não vêm datas: o relatório consolidado pode ser pedido sem
    // filtro, e nesse caso ignorar as escalas faria um sábado escalado ser calculado
    // como dia sem meta — crédito integral no banco de horas em vez de expediente.
    return db.all(
        `SELECT e.id, e.funcionario_id, e.data, e.observacao, e.criado_em,
                f.nome, f.emoji, f.regime
         FROM escala_sabado e JOIN funcionarios f ON f.id = e.funcionario_id
         WHERE e.data BETWEEN ? AND ?
         ORDER BY e.data ASC, f.nome ASC`,
        [dataInicio || '0000-01-01', dataFim || '9999-12-31']
    );
}

/** Set com as chaves `${funcionarioId}_${data}` escaladas no período. */
async function conjuntoDoPeriodo({ dataInicio, dataFim } = {}) {
    const linhas = await listar({ dataInicio, dataFim });
    return new Set(linhas.map((e) => `${e.funcionario_id}_${e.data}`));
}

/**
 * Escala uma pessoa num sábado específico.
 *
 * Recusa data que não é sábado: a tela deixa escolher qualquer dia no seletor, e
 * escalar alguém numa terça criaria um dia com regra de falta não descontável no
 * meio da jornada normal — exatamente o buraco que alguém usaria para escapar do
 * desconto de um dia comum.
 */
async function criar({ funcionario_id, data, observacao }) {
    if (diaDaSemana(data) !== 6) {
        const erro = new Error('A escala só vale para sábados. Escolha uma data que caia num sábado.');
        erro.status = 400;
        throw erro;
    }

    const funcionario = await db.get(`SELECT id, nome, ativo FROM funcionarios WHERE id = ?`, [funcionario_id]);
    if (!funcionario) {
        const erro = new Error('Colaborador não encontrado.');
        erro.status = 404;
        throw erro;
    }
    if (!funcionario.ativo) {
        const erro = new Error('Colaborador inativo não pode ser escalado.');
        erro.status = 400;
        throw erro;
    }

    const ja = await db.get(`SELECT id FROM escala_sabado WHERE funcionario_id = ? AND data = ?`, [funcionario_id, data]);
    if (ja) {
        const erro = new Error(`${funcionario.nome} já está escalado neste sábado.`);
        erro.status = 409;
        throw erro;
    }

    const { lastID } = await db.run(
        `INSERT INTO escala_sabado (funcionario_id, data, observacao) VALUES (?, ?, ?)`,
        [funcionario_id, data, observacao || null]
    );
    await registrarAuditoria('escalar_sabado', 'escala_sabado', lastID, { funcionario_id, data, observacao });
    return db.get(`SELECT * FROM escala_sabado WHERE id = ?`, [lastID]);
}

/** Escala várias pessoas no mesmo sábado — o caso normal de montar a escala do mês. */
async function criarEmLote({ funcionarios_ids, data, observacao }) {
    const resultados = { criados: 0, jaExistiam: 0 };
    for (const id of funcionarios_ids) {
        try {
            await criar({ funcionario_id: id, data, observacao });
            resultados.criados += 1;
        } catch (e) {
            if (e.status === 409) resultados.jaExistiam += 1;
            else throw e;
        }
    }
    return resultados;
}

async function remover(id) {
    const escala = await db.get(`SELECT * FROM escala_sabado WHERE id = ?`, [id]);
    if (!escala) {
        const erro = new Error('Escala não encontrada.');
        erro.status = 404;
        throw erro;
    }
    await db.run(`DELETE FROM escala_sabado WHERE id = ?`, [id]);
    await registrarAuditoria('remover_escala_sabado', 'escala_sabado', id, {
        funcionario_id: escala.funcionario_id, data: escala.data
    });
}

/** Os próximos sábados a partir de hoje — alimenta o seletor da tela. */
function proximosSabados(quantidade = 12) {
    const d = new Date(`${agoraBrasilia().data}T12:00:00Z`);
    // Anda até o próximo sábado (getUTCDay: 6 = sábado); se hoje já é sábado, começa hoje.
    while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1);

    const datas = [];
    for (let i = 0; i < quantidade; i += 1) {
        datas.push(d.toISOString().slice(0, 10));
        d.setUTCDate(d.getUTCDate() + 7);
    }
    return datas;
}

module.exports = { listar, conjuntoDoPeriodo, criar, criarEmLote, remover, proximosSabados };
