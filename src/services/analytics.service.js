const relatorioService = require('./relatorio.service');
const ausenciasService = require('./ausencias.service');
const funcionariosService = require('./funcionarios.service');
const { calcularViolacoesInterjornada } = require('./calculoJornada.service');

/**
 * Indicadores agregados pro painel de People Analytics — pensado pra responder as perguntas
 * que um RH leva pra diretoria, não só mostrar registro cru.
 */
async function indicadoresGerais({ dataInicio, dataFim }) {
    const [dias, faltasInfo, todosFuncionarios] = await Promise.all([
        relatorioService.relatorioCalculado({ dataInicio, dataFim }),
        ausenciasService.calcularFaltas({ dataInicio, dataFim }),
        funcionariosService.listarTodos()
    ]);

    const ativos = todosFuncionarios.filter((f) => f.ativo);

    // Headcount por regime e por departamento.
    const headcountRegime = {};
    const headcountDepartamento = {};
    ativos.forEach((f) => {
        headcountRegime[f.regime] = (headcountRegime[f.regime] || 0) + 1;
        const dep = f.departamento || '(sem departamento)';
        headcountDepartamento[dep] = (headcountDepartamento[dep] || 0) + 1;
    });

    // Absenteísmo: % de dias de trabalho esperados que viraram falta não justificada.
    const totalFaltas = faltasInfo.faltas.length;
    const totalDiasUteis = faltasInfo.totalDiasUteisNoPeriodo;
    const absenteismoPercentual = totalDiasUteis > 0 ? +((totalFaltas / totalDiasUteis) * 100).toFixed(2) : 0;

    // Custo de hora extra e adicional noturno em R$ (só soma quem tem salário-base cadastrado).
    let custoExtraTotal = 0;
    let custoNoturnoTotal = 0;
    dias.forEach((d) => {
        if (d.horas_extras.valor) custoExtraTotal += d.horas_extras.valor;
        if (d.horas_noturnas.valor) custoNoturnoTotal += d.horas_noturnas.valor;
    });
    const funcionariosSemSalario = ativos.filter((f) => f.salario_base == null).length;

    // Padrão de atraso recorrente: ranking por número de DIAS com atraso (não só o total em
    // minutos) — 10 atrasos de 2 minutos é um padrão comportamental diferente de 1 atraso de 20.
    const atrasosPorFuncionario = {};
    dias.forEach((d) => {
        if (d.atrasoMinutos <= 0) return;
        if (!atrasosPorFuncionario[d.funcionarioId]) {
            atrasosPorFuncionario[d.funcionarioId] = { funcionario_id: d.funcionarioId, nome: d.nome, emoji: d.emoji, diasComAtraso: 0, minutosTotal: 0 };
        }
        atrasosPorFuncionario[d.funcionarioId].diasComAtraso += 1;
        atrasosPorFuncionario[d.funcionarioId].minutosTotal += d.atrasoMinutos;
    });
    const rankingAtrasos = Object.values(atrasosPorFuncionario)
        .sort((a, b) => b.diasComAtraso - a.diasComAtraso || b.minutosTotal - a.minutosTotal)
        .slice(0, 10);

    // Violações de intervalo interjornada (Art. 66 CLT — mínimo 11h de descanso entre turnos),
    // agregadas por todos os funcionários no período.
    const diasPorFuncionario = {};
    dias.forEach((d) => {
        if (!diasPorFuncionario[d.funcionarioId]) diasPorFuncionario[d.funcionarioId] = [];
        diasPorFuncionario[d.funcionarioId].push(d);
    });
    let totalViolacoesInterjornada = 0;
    const funcionariosComViolacao = new Set();
    Object.entries(diasPorFuncionario).forEach(([funcionarioId, diasDoFuncionario]) => {
        const ordenados = diasDoFuncionario.slice().sort((a, b) => a.dataISO.localeCompare(b.dataISO));
        const violacoes = calcularViolacoesInterjornada(ordenados);
        if (violacoes.length > 0) {
            totalViolacoesInterjornada += violacoes.length;
            funcionariosComViolacao.add(funcionarioId);
        }
    });

    return {
        periodo: { inicio: dataInicio, fim: dataFim },
        headcount: {
            total: ativos.length,
            porRegime: headcountRegime,
            porDepartamento: headcountDepartamento
        },
        absenteismo: {
            totalFaltas,
            totalDiasUteis,
            percentual: absenteismoPercentual
        },
        custos: {
            horaExtra: +custoExtraTotal.toFixed(2),
            adicionalNoturno: +custoNoturnoTotal.toFixed(2),
            funcionariosSemSalarioCadastrado: funcionariosSemSalario
        },
        rankingAtrasos,
        interjornada: {
            totalViolacoes: totalViolacoesInterjornada,
            funcionariosAfetados: funcionariosComViolacao.size
        }
    };
}

module.exports = { indicadoresGerais };
