const db = require('../db/db');
const { grupoDoDia } = require('../utils/tempo');
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
    const [funcionarios, feriadosSet, justificadas, entradasRegistradas, jornadasPorFuncionario] = await Promise.all([
        db.all(`SELECT id, emoji, nome, regime FROM funcionarios WHERE ativo = 1 ORDER BY nome ASC`),
        feriadosService.buscarComoConjunto({ dataInicio, dataFim }),
        db.all(`SELECT funcionario_id, data, tipo, justificativa FROM ausencias WHERE data BETWEEN ? AND ?`, [dataInicio, dataFim]),
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

module.exports = { justificar, remover, calcularFaltas };
