const db = require('../db/db');

/**
 * ATESTADOS — visão unificada.
 *
 * Um atestado médico entra no sistema por dois caminhos diferentes, porque são coisas
 * operacionalmente distintas:
 *   * dia inteiro   -> tabela `ausencias`, tipo 'atestado' (a pessoa não veio)
 *   * horas         -> tabela `tratativas_atraso`, tipo 'atestado_horas' (veio, mas
 *                      chegou tarde ou saiu no meio por consulta)
 *
 * Para acompanhar recorrência isso precisa ser UMA lista só: dois atestados de meio dia
 * e um de dia inteiro no mesmo mês é o mesmo sinal, independente de onde foram lançados.
 */

/** Lista unificada dos atestados do período, do mais recente para o mais antigo. */
async function listar({ dataInicio, dataFim } = {}) {
    const [diasInteiros, deHoras] = await Promise.all([
        db.all(
            `SELECT a.id, a.funcionario_id, a.data, a.justificativa AS observacao,
                    f.nome, f.emoji, f.regime
             FROM ausencias a JOIN funcionarios f ON f.id = a.funcionario_id
             WHERE a.tipo = 'atestado' AND a.data BETWEEN ? AND ?`,
            [dataInicio, dataFim]
        ),
        db.all(
            `SELECT t.id, t.funcionario_id, t.data, t.minutos_abonados, t.motivo AS observacao,
                    f.nome, f.emoji, f.regime
             FROM tratativas_atraso t JOIN funcionarios f ON f.id = t.funcionario_id
             WHERE t.tipo = 'atestado_horas' AND t.data BETWEEN ? AND ?`,
            [dataInicio, dataFim]
        )
    ]);

    const lista = [
        ...diasInteiros.map((a) => ({ ...a, origem: 'ausencia', tipo: 'dia_inteiro', minutos_abonados: null })),
        ...deHoras.map((t) => ({ ...t, origem: 'tratativa', tipo: 'horas' }))
    ];

    // Ordena por data desc e, dentro do mesmo dia, por nome — igual ao resto do sistema.
    return lista.sort((a, b) => b.data.localeCompare(a.data) || a.nome.localeCompare(b.nome));
}

/**
 * Contagem por colaborador no período, já ordenada de quem mais apresentou para quem
 * menos apresentou — é essa ordem que responde a pergunta "quem está usando muito".
 */
async function contarPorFuncionario({ dataInicio, dataFim } = {}) {
    const lista = await listar({ dataInicio, dataFim });

    const porFuncionario = new Map();
    lista.forEach((a) => {
        if (!porFuncionario.has(a.funcionario_id)) {
            porFuncionario.set(a.funcionario_id, {
                funcionario_id: a.funcionario_id, nome: a.nome, emoji: a.emoji, regime: a.regime,
                total: 0, diasInteiros: 0, deHoras: 0, minutosAbonados: 0, datas: []
            });
        }
        const r = porFuncionario.get(a.funcionario_id);
        r.total += 1;
        if (a.tipo === 'dia_inteiro') r.diasInteiros += 1;
        else {
            r.deHoras += 1;
            r.minutosAbonados += a.minutos_abonados || 0;
        }
        r.datas.push(a.data);
    });

    return [...porFuncionario.values()].sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));
}

/** Resumo de UM colaborador — usado pelo relatório individual. */
async function resumoDoFuncionario({ funcionarioId, dataInicio, dataFim } = {}) {
    const todos = await contarPorFuncionario({ dataInicio, dataFim });
    const meu = todos.find((r) => r.funcionario_id === Number(funcionarioId));
    return meu || { funcionario_id: Number(funcionarioId), total: 0, diasInteiros: 0, deHoras: 0, minutosAbonados: 0, datas: [] };
}

module.exports = { listar, contarPorFuncionario, resumoDoFuncionario };
