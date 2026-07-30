const db = require('../db/db');
const { TIPO_PARA_CHAVE, minutosParaStr } = require('../utils/tempo');
const { montarRelatorioDia } = require('./calculoJornada.service');
const feriadosService = require('./feriados.service');
const funcionariosService = require('./funcionarios.service');

async function buscarPercentuaisHorasExtras() {
    const linhas = await db.all(`SELECT tipo, percentual FROM config_horas_extras`);
    return linhas.reduce((acc, l) => { acc[l.tipo] = l.percentual; return acc; }, {});
}

/**
 * Relatório consolidado por funcionário/dia — equivalente ao antigo /api/relatorio-calculado,
 * mas agora filtrando no SQL, sem regra hardcoded por nome, considerando feriados cadastrados
 * e usando a jornada de cada dia da semana (configurável individualmente) de cada funcionário.
 * `funcionarioId` é opcional — quando informado, filtra pra uma única pessoa (usado no relatório individual).
 */
async function relatorioCalculado({ dataInicio, dataFim, funcionarioId } = {}) {
    const condicoes = [];
    const params = [];
    if (dataInicio) { condicoes.push('r.data >= ?'); params.push(dataInicio); }
    if (dataFim) { condicoes.push('r.data <= ?'); params.push(dataFim); }
    if (funcionarioId) { condicoes.push('r.funcionario_id = ?'); params.push(funcionarioId); }
    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

    const linhas = await db.all(
        `SELECT f.id as f_id, f.emoji, f.nome, f.regime, f.horas_diarias,
                f.tolerancia_almoco_min, f.almoco_flexivel, f.salario_base,
                r.data, r.hora, r.tipo, r.justificativa
         FROM registro_ponto r
         JOIN funcionarios f ON r.funcionario_id = f.id
         ${where}
         ORDER BY f.nome ASC, r.data_hora_iso ASC`,
        params
    );

    const trocasService = require('./trocasDia.service');
    const tratativasService = require('./tratativas.service');

    const [feriados, percentuais, jornadasPorFuncionario, trocas, tratativas] = await Promise.all([
        feriadosService.buscarComoConjunto({ dataInicio, dataFim }),
        buscarPercentuaisHorasExtras(),
        funcionariosService.buscarJornadaDeTodos(),
        trocasService.mapaDoPeriodo({ dataInicio, dataFim }),
        dataInicio && dataFim
            ? tratativasService.mapaDoPeriodo({ dataInicio, dataFim })
            : Promise.resolve({})
    ]);

    const agrupado = {};
    linhas.forEach((row) => {
        const chave = `${row.f_id}_${row.data}`;
        if (!agrupado[chave]) {
            agrupado[chave] = {
                funcionarioId: row.f_id,
                funcionario: {
                    id: row.f_id,
                    emoji: row.emoji,
                    nome: row.nome,
                    regime: row.regime,
                    horas_diarias: row.horas_diarias,
                    tolerancia_almoco_min: row.tolerancia_almoco_min,
                    almoco_flexivel: row.almoco_flexivel,
                    salario_base: row.salario_base
                },
                dataISO: row.data,
                pontos: {},
                justificativas: {}
            };
        }
        const chaveTipo = TIPO_PARA_CHAVE[row.tipo];
        agrupado[chave].pontos[chaveTipo] = row.hora ? row.hora.substring(0, 5) : '';
        if (row.justificativa) agrupado[chave].justificativas[chaveTipo] = row.justificativa;
    });

    return Object.values(agrupado).map((dia) => {
        const chave = `${dia.funcionarioId}_${dia.dataISO}`;
        return montarRelatorioDia({
            funcionario: dia.funcionario,
            dataISO: dia.dataISO,
            pontos: dia.pontos,
            justificativas: dia.justificativas,
            ehFeriado: feriados.has(dia.dataISO),
            percentuaisHorasExtras: percentuais,
            jornadaPorGrupo: jornadasPorFuncionario[dia.funcionarioId] || {},
            troca: trocas[chave] || null,
            tratativa: tratativas[chave] || null
        });
    });
}

/**
 * Relatório individual agregado de UM funcionário num período: saldo total, total de atrasos
 * (em minutos e em número de dias), total de horas extras, total de horas noturnas e total de
 * faltas não justificadas no período — pensado pra ser algo que dá pra exportar/mostrar pro
 * responsável de RH sem precisar somar linha por linha manualmente.
 */
async function relatorioIndividual(funcionarioId, { dataInicio, dataFim } = {}) {
    const ausenciasService = require('./ausencias.service');
    const { calcularViolacoesInterjornada } = require('./calculoJornada.service');

    const [funcionario, dias, faltasInfo] = await Promise.all([
        funcionariosService.buscarPorId(funcionarioId),
        relatorioCalculado({ dataInicio, dataFim, funcionarioId }),
        ausenciasService.calcularFaltas({ dataInicio, dataFim })
    ]);

    if (!funcionario) return null;

    let somaSaldoMinutos = 0;
    let somaAtrasoMinutos = 0;
    let diasComAtraso = 0;
    let somaExtraMinutos = 0;
    let somaNoturnoMinutos = 0;
    let diasTrabalhados = 0;
    let valorExtraTotal = 0;
    let valorNoturnoTotal = 0;

    dias.forEach((d) => {
        if (d.saldoMinutos !== null) {
            somaSaldoMinutos += d.saldoMinutos;
            diasTrabalhados += 1;
        }
        if (d.atrasoMinutos > 0) diasComAtraso += 1;
        somaAtrasoMinutos += d.atrasoMinutos;
        somaExtraMinutos += d.horas_extras.minutos || 0;
        somaNoturnoMinutos += d.horas_noturnas.minutos || 0;
        if (d.horas_extras.valor) valorExtraTotal += d.horas_extras.valor;
        if (d.horas_noturnas.valor) valorNoturnoTotal += d.horas_noturnas.valor;
    });

    const faltasDoFuncionario = faltasInfo.faltas.filter((f) => f.funcionario_id === Number(funcionarioId));

    const diasOrdenados = dias.slice().sort((a, b) => a.dataISO.localeCompare(b.dataISO));
    const violacoesInterjornada = calcularViolacoesInterjornada(diasOrdenados);

    return {
        funcionario: {
            id: funcionario.id, emoji: funcionario.emoji, nome: funcionario.nome, regime: funcionario.regime,
            temSalarioCadastrado: funcionario.salario_base != null
        },
        periodo: { inicio: dataInicio || null, fim: dataFim || null },
        diasTrabalhados,
        saldoTotal: minutosParaStr(somaSaldoMinutos, true),
        saldoTotalMinutos: somaSaldoMinutos,
        atrasoTotal: minutosParaStr(somaAtrasoMinutos),
        atrasoTotalMinutos: somaAtrasoMinutos,
        diasComAtraso,
        horasExtrasTotal: minutosParaStr(somaExtraMinutos),
        horasExtrasTotalMinutos: somaExtraMinutos,
        valorExtraTotal: funcionario.salario_base != null ? +valorExtraTotal.toFixed(2) : null,
        horasNoturnasTotal: minutosParaStr(somaNoturnoMinutos),
        horasNoturnasTotalMinutos: somaNoturnoMinutos,
        valorNoturnoTotal: funcionario.salario_base != null ? +valorNoturnoTotal.toFixed(2) : null,
        totalFaltas: faltasDoFuncionario.length,
        faltas: faltasDoFuncionario,
        violacoesInterjornada,
        dias
    };
}

module.exports = { relatorioCalculado, relatorioIndividual, buscarPercentuaisHorasExtras };
