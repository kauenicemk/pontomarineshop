const db = require('../db/db');
const { registrarAuditoria } = require('../utils/auditoria');
const { diaDaSemana } = require('../utils/tempo');

/**
 * ESCALA DE DIA EXTRA — sábado e domingo (ver migração 0009).
 *
 * Sábado e domingo não fazem parte da jornada de todo mundo. Quem é escalado passa a
 * ter aquele dia específico como dia de trabalho — só ele, só naquela data. Por isso a
 * escala é por DATA e não uma chave "trabalha aos sábados" na jornada: o sábado 08/08
 * pode valer para uma pessoa e não para outra, e na semana seguinte se inverter.
 *
 * As consequências mudam conforme o dia e o regime:
 *
 *   SÁBADO escalado
 *     * vale a jornada de sábado da pessoa (meta e horário de entrada)
 *     * gera atraso e gera falta, os dois no relatório
 *     * DESCONTA para CLT — escalado, aquele sábado é obrigação
 *     * NÃO desconta para estagiário — ele está ali por escala eventual ou para fazer
 *       banco de horas; o que trabalhar simplesmente soma ao banco
 *
 *   DOMINGO escalado
 *     * não existe atraso (domingo não tem horário de entrada configurável)
 *     * sem meta: o dia inteiro é hora extra de 100%
 *     * faltar conta como falta no relatório, mas nunca desconta
 */

const SABADO = 6;
const DOMINGO = 0;

/** 'sabado' | 'domingo' | null — o tipo sai da data, não de uma coluna. */
function tipoDoDia(dataISO) {
    const d = diaDaSemana(dataISO);
    if (d === SABADO) return 'sabado';
    if (d === DOMINGO) return 'domingo';
    return null;
}

async function listar({ dataInicio, dataFim } = {}) {
    // Período aberto quando não vêm datas: o relatório consolidado pode ser pedido sem
    // filtro, e nesse caso ignorar as escalas faria um sábado escalado ser calculado
    // como dia sem meta — crédito integral no banco de horas em vez de expediente.
    const linhas = await db.all(
        `SELECT e.id, e.funcionario_id, e.data, e.observacao, e.criado_em,
                f.nome, f.emoji, f.regime
         FROM escala_dia e JOIN funcionarios f ON f.id = e.funcionario_id
         WHERE e.data BETWEEN ? AND ?
         ORDER BY e.data ASC, f.nome ASC`,
        [dataInicio || '0000-01-01', dataFim || '9999-12-31']
    );
    return linhas.map((l) => ({ ...l, tipo: tipoDoDia(l.data) }));
}

/** Set com as chaves `${funcionarioId}_${data}` escaladas no período. */
async function conjuntoDoPeriodo({ dataInicio, dataFim } = {}) {
    const linhas = await listar({ dataInicio, dataFim });
    return new Set(linhas.map((e) => `${e.funcionario_id}_${e.data}`));
}

/**
 * Escala uma pessoa num sábado ou domingo específico.
 *
 * Recusa dia de semana: a escala carrega regras próprias de desconto, e escalar alguém
 * numa terça criaria um dia de jornada normal governado por essas exceções — exatamente
 * o buraco que serviria para escapar do desconto de um dia comum.
 */
async function criar({ funcionario_id, data, observacao }) {
    const tipo = tipoDoDia(data);
    if (!tipo) {
        const erro = new Error('A escala só vale para sábados e domingos.');
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

    const ja = await db.get(`SELECT id FROM escala_dia WHERE funcionario_id = ? AND data = ?`, [funcionario_id, data]);
    if (ja) {
        const erro = new Error(`${funcionario.nome} já está escalado neste dia.`);
        erro.status = 409;
        throw erro;
    }

    const { lastID } = await db.run(
        `INSERT INTO escala_dia (funcionario_id, data, observacao) VALUES (?, ?, ?)`,
        [funcionario_id, data, observacao || null]
    );
    await registrarAuditoria('escalar_dia', 'escala_dia', lastID, { funcionario_id, data, tipo, observacao });
    return db.get(`SELECT * FROM escala_dia WHERE id = ?`, [lastID]);
}

/** Escala várias pessoas no mesmo dia — o caso normal de montar a escala do mês. */
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
    const escala = await db.get(`SELECT * FROM escala_dia WHERE id = ?`, [id]);
    if (!escala) {
        const erro = new Error('Escala não encontrada.');
        erro.status = 404;
        throw erro;
    }
    await db.run(`DELETE FROM escala_dia WHERE id = ?`, [id]);
    await registrarAuditoria('remover_escala_dia', 'escala_dia', id, {
        funcionario_id: escala.funcionario_id, data: escala.data
    });
}

module.exports = { listar, conjuntoDoPeriodo, criar, criarEmLote, remover, tipoDoDia };
