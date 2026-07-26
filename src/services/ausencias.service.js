const db = require('../db/db');
const { grupoDoDia, agoraBrasilia } = require('../utils/tempo');
const { registrarAuditoria } = require('../utils/auditoria');
const feriadosService = require('./feriados.service');
const funcionariosService = require('./funcionarios.service');

/** Justificativa manual de uma ausência (atestado, férias, licença, folga). */
async function justificar({ funcionario_id, data, tipo, justificativa }) {
    const { lastID } = await db.run(
        `INSERT INTO ausencias (funcionario_id, data, tipo, justificativa)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(funcionario_id, data) DO UPDATE SET tipo = excluded.tipo, justificativa = excluded.justificativa`,
        [funcionario_id, data, tipo, justificativa || null]
    );
    await registrarAuditoria('justificar_ausencia', 'ausencia', lastID, { funcionario_id, data, tipo });
    return db.get(`SELECT * FROM ausencias WHERE funcionario_id = ? AND data = ?`, [funcionario_id, data]);
}

/**
 * Justifica VÁRIAS ausências de uma vez (vários funcionários e/ou várias datas).
 * Usa o mesmo upsert do fluxo individual: rodar duas vezes com os mesmos itens
 * atualiza a justificativa em vez de criar registros duplicados.
 * Devolve quantos foram criados e quantos já existiam (foram atualizados).
 */
async function justificarEmLote(itens, { tipo, justificativa }) {
    const chavesExistentes = new Set();
    for (const item of itens) {
        const ja = await db.get(
            `SELECT id FROM ausencias WHERE funcionario_id = ? AND data = ?`,
            [item.funcionario_id, item.data]
        );
        if (ja) chavesExistentes.add(`${item.funcionario_id}_${item.data}`);
    }

    for (const item of itens) {
        await db.run(
            `INSERT INTO ausencias (funcionario_id, data, tipo, justificativa)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(funcionario_id, data) DO UPDATE SET tipo = excluded.tipo, justificativa = excluded.justificativa`,
            [item.funcionario_id, item.data, tipo, justificativa || null]
        );
    }

    const atualizados = chavesExistentes.size;
    const criados = itens.length - atualizados;
    await registrarAuditoria('justificar_ausencia_lote', 'ausencia', null, { total: itens.length, criados, atualizados, tipo, justificativa });
    return { total: itens.length, criados, atualizados };
}

async function remover(id) {
    await db.run(`DELETE FROM ausencias WHERE id = ?`, [id]);
    await registrarAuditoria('remover_ausencia', 'ausencia', id, {});
}

/** Todos os dias corridos do período (o filtro de "é dia de trabalho" é feito depois, por pessoa). */
function listarTodosOsDias(dataInicioISO, dataFimISO) {
    const dias = [];
    let cursor = new Date(`${dataInicioISO}T12:00:00Z`);
    const fim = new Date(`${dataFimISO}T12:00:00Z`);
    while (cursor <= fim) {
        dias.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dias;
}

/**
 * Calcula, para um período, quais funcionários ativos faltaram — comparando os dias em que,
 * segundo a jornada PRÓPRIA de cada um (Seg-Qui / Sexta / Sábado), eles deveriam ter trabalhado,
 * contra o que foi realmente batido e o que foi justificado. Isso é importante porque nem todo
 * mundo trabalha sábado — quem não trabalha não pode "faltar" num dia que nem era dele.
 * Domingo nunca conta como falta. Feriados cadastrados também não contam.
 */
async function calcularFaltas({ dataInicio, dataFim }) {
    // Um dia só pode virar "falta" depois que ele TERMINA. Sem esse corte, pedir o mês
    // corrente inteiro marcava como falta todos os dias futuros (e o próprio dia de hoje
    // antes do fim do expediente). O cálculo considera no máximo até ONTEM (Brasília).
    const ontem = (() => {
        const hoje = agoraBrasilia().data;
        const d = new Date(`${hoje}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 1);
        return d.toISOString().slice(0, 10);
    })();
    if (dataFim > ontem) dataFim = ontem;
    if (dataInicio > dataFim) {
        return { faltas: [], ausenciasJustificadas: [], totalDiasUteisNoPeriodo: 0 };
    }

    const [funcionarios, feriadosSet, justificadas, entradasRegistradas, jornadasPorFuncionario] = await Promise.all([
        db.all(`SELECT id, emoji, nome, regime FROM funcionarios WHERE ativo = 1 ORDER BY nome ASC`),
        feriadosService.buscarComoConjunto({ dataInicio, dataFim }),
        db.all(
            `SELECT a.id, a.funcionario_id, a.data, a.tipo, a.justificativa, f.nome, f.emoji
             FROM ausencias a JOIN funcionarios f ON f.id = a.funcionario_id
             WHERE a.data BETWEEN ? AND ? ORDER BY a.data DESC, f.nome ASC`,
            [dataInicio, dataFim]
        ),
        db.all(
            `SELECT DISTINCT funcionario_id, data FROM registro_ponto WHERE tipo = 'Entrada' AND data BETWEEN ? AND ?`,
            [dataInicio, dataFim]
        ),
        funcionariosService.buscarJornadaDeTodos()
    ]);

    const todosOsDias = listarTodosOsDias(dataInicio, dataFim);
    const justificadasPorChave = new Set(justificadas.map((j) => `${j.funcionario_id}_${j.data}`));
    const entradasPorChave = new Set(entradasRegistradas.map((e) => `${e.funcionario_id}_${e.data}`));

    const faltas = [];
    let totalDiasDeTrabalhoNoPeriodo = 0;

    funcionarios.forEach((f) => {
        const jornada = jornadasPorFuncionario[f.id] || {};

        todosOsDias.forEach((data) => {
            if (feriadosSet.has(data)) return; // feriado nunca é falta

            const grupo = grupoDoDia(data);
            if (!grupo) return; // domingo nunca conta

            const cfgGrupo = jornada[grupo];
            if (!cfgGrupo || !cfgGrupo.trabalha) return; // esse dia da semana não é dia de trabalho pra essa pessoa

            totalDiasDeTrabalhoNoPeriodo += 1;

            const chave = `${f.id}_${data}`;
            if (entradasPorChave.has(chave)) return;    // bateu ponto nesse dia
            if (justificadasPorChave.has(chave)) return; // ausência justificada

            faltas.push({ funcionario_id: f.id, emoji: f.emoji, nome: f.nome, regime: f.regime, data, tipo: 'falta_injustificada' });
        });
    });

    return { faltas, ausenciasJustificadas: justificadas, totalDiasUteisNoPeriodo: totalDiasDeTrabalhoNoPeriodo };
}

module.exports = { justificar, justificarEmLote, remover, calcularFaltas };
