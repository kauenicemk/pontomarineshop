const { paraMinutos, minutosParaStr, grupoDoDia, INICIO_NOTURNO_MIN, FIM_NOTURNO_MIN } = require('../utils/tempo');
const config = require('../config');

/**
 * Todas as funções aqui são puras: recebem dados e devolvem resultado, sem tocar em banco
 * nem em HTTP. Isso corrige o problema identificado na auditoria (lógica de negócio misturada
 * com o handler da rota Express) e permite testar as regras sozinhas.
 *
 * A jornada é configurável por funcionário em cada um dos 6 dias da semana individualmente
 * (segunda a sábado — domingo nunca é configurável). `jornadaPorGrupo` é um objeto como:
 *   { segunda: { horario_entrada, meta_minutos, trabalha }, terca: {...}, ..., sabado: {...} }
 *
 * A tolerância de almoço e a flexibilidade continuam por funcionário (não variam por dia da
 * semana), configuráveis na tela de Administração, em vez de hardcoded por nome no código.
 */

/** Tempo bruto trabalhado no dia, em minutos, a partir dos 4 pontos batidos. */
function calcularTempoTrabalhadoMinutos(pontos) {
    const { ENTRADA, ALMOCO_SAIDA, ALMOCO_RETORNO, SAIDA } = pontos;
    let total = 0;

    if (ENTRADA && ALMOCO_SAIDA) total += paraMinutos(ALMOCO_SAIDA) - paraMinutos(ENTRADA);
    if (ALMOCO_RETORNO && SAIDA) total += paraMinutos(SAIDA) - paraMinutos(ALMOCO_RETORNO);
    if (ENTRADA && SAIDA && !ALMOCO_SAIDA && !ALMOCO_RETORNO) total = paraMinutos(SAIDA) - paraMinutos(ENTRADA);

    return Math.max(0, total);
}

/** Devolve a configuração do dia da semana válida para a data, ou null (domingo / dia não configurado como de trabalho). */
function configDoGrupoNaData(dataISO, jornadaPorGrupo) {
    const grupo = grupoDoDia(dataISO);
    if (!grupo) return null;
    const cfg = jornadaPorGrupo && jornadaPorGrupo[grupo];
    if (!cfg || !cfg.trabalha) return null;
    return cfg;
}

/** Atraso na entrada, em minutos, comparado ao horário de entrada configurado pro dia da semana específico. */
function calcularAtrasoEntradaMinutos(pontos, dataISO, jornadaPorGrupo) {
    if (!pontos.ENTRADA) return 0;
    const cfg = configDoGrupoNaData(dataISO, jornadaPorGrupo);
    if (!cfg) return 0;

    const diff = paraMinutos(pontos.ENTRADA) - paraMinutos(cfg.horario_entrada) - config.jornada.toleranciaAtrasoEntradaMin;
    return Math.max(0, diff);
}

/**
 * Atraso por estourar o tempo de almoço, em minutos.
 * `toleranciaMin` e `flexivel` vêm do CADASTRO do funcionário (configurável), não mais de
 * uma lista de nomes hardcoded no código.
 */
function calcularAtrasoAlmocoMinutos(pontos, toleranciaMin, flexivel) {
    if (flexivel) return 0;
    if (!pontos.ALMOCO_SAIDA || !pontos.ALMOCO_RETORNO) return 0;

    const tempoAlmocoReal = paraMinutos(pontos.ALMOCO_RETORNO) - paraMinutos(pontos.ALMOCO_SAIDA);
    return Math.max(0, tempoAlmocoReal - toleranciaMin);
}

/**
 * Meta de minutos trabalhados esperada no dia, a partir da configuração do dia da semana
 * específico. Feriado sempre zera a meta (todo trabalho vira extra). Domingo, ou um dia
 * marcado como "não trabalha", também resulta em meta 0.
 */
function calcularMetaMinutos(dataISO, jornadaPorGrupo, ehFeriado) {
    if (ehFeriado) return 0;
    const cfg = configDoGrupoNaData(dataISO, jornadaPorGrupo);
    return cfg ? cfg.meta_minutos : 0;
}

/**
 * Saldo do dia em MINUTOS, já com a regra de tolerância da empresa aplicada.
 *
 * Atraso de até 10 minutos (config.jornada.minutosAtrasoSemDescontoNoSaldo) não pode
 * deixar o dia negativo: o atraso continua sendo contabilizado e exibido, mas o saldo
 * é elevado a zero na medida exata do atraso perdoado. Acima de 10 minutos não há
 * perdão nenhum — o atraso inteiro pesa no saldo.
 *
 * O perdão cobre no máximo o próprio atraso: quem chegou 8 min tarde E saiu 30 min
 * mais cedo continua com -30 min de saldo (só os 8 do atraso são relevados).
 *
 * Devolve null quando não dá para calcular saldo (sem meta, sem entrada ou sem saída).
 */
function calcularSaldoMinutos(totalMinutos, metaMinutos, pontos, atrasoMinutos = 0) {
    if (metaMinutos === 0 || totalMinutos === 0 || !pontos.ENTRADA || !pontos.SAIDA) {
        return null;
    }

    const saldoBruto = totalMinutos - metaMinutos;
    const limite = config.jornada.minutosAtrasoSemDescontoNoSaldo;
    const dentroDaTolerancia = atrasoMinutos > 0 && atrasoMinutos <= limite;
    if (!dentroDaTolerancia || saldoBruto >= 0) return saldoBruto;

    // Devolve ao saldo só o que foi perdido pelo atraso tolerado, sem virar crédito.
    return Math.min(0, saldoBruto + atrasoMinutos);
}

/** Saldo do dia formatado como "+/-HH:MM" ou "---". */
function calcularSaldo(totalMinutos, metaMinutos, pontos, atrasoMinutos = 0) {
    const saldo = calcularSaldoMinutos(totalMinutos, metaMinutos, pontos, atrasoMinutos);
    if (saldo === null) return '---';
    return minutosParaStr(saldo, true);
}

/**
 * Classifica o excedente de horas (o que passou da meta) em faixas de hora extra, usando os
 * percentuais configurados em `config_horas_extras`. Sábado conta como "dia_util" pra esse
 * fim (só domingo e feriado têm percentual diferenciado) — pedido explícito do cliente.
 * Retorna { minutosExtra, tipoExtra, percentual } — tipoExtra é 'dia_util' | 'domingo_feriado'.
 */
function calcularHorasExtras(totalMinutos, metaMinutos, dataISO, ehFeriado, percentuaisPorTipo) {
    const excedente = Math.max(0, totalMinutos - metaMinutos);
    if (excedente === 0) return { minutosExtra: 0, tipoExtra: null, percentual: 0 };

    const grupo = grupoDoDia(dataISO);
    const tipoExtra = (ehFeriado || grupo === null) ? 'domingo_feriado' : 'dia_util';

    const percentual = percentuaisPorTipo[tipoExtra] ?? config.horasExtrasPadrao[tipoExtra];
    return { minutosExtra: excedente, tipoExtra, percentual };
}

/**
 * Minutos trabalhados dentro da janela do adicional noturno (22h-5h), a partir dos intervalos
 * efetivamente batidos no dia. Incide sobre QUALQUER minuto trabalhado nessa janela, seja hora
 * normal ou hora extra — são coisas independentes (uma hora pode ser extra E noturna ao mesmo
 * tempo, e as duas parcelas se somam).
 *
 * Limitação conhecida e documentada: como cada batida fica associada à data em que foi batida,
 * um turno que atravessa a meia-noite (ex: entrada às 22h de um dia, saída às 6h do dia seguinte)
 * fica registrado em dois "dias" diferentes no banco — essa função calcula corretamente a parte
 * 22h-24h e a parte 00h-5h quando elas caem dentro do mesmo dia dos pontos batidos, mas não
 * reconstrói um turno que de fato atravessa a virada. Para turnos assim, o ideal é o responsável
 * conferir manualmente ou ajustar via ajuste manual de ponto.
 */
function calcularMinutosNoturnos(pontos) {
    const intervalos = [];
    if (pontos.ENTRADA && pontos.ALMOCO_SAIDA) intervalos.push([paraMinutos(pontos.ENTRADA), paraMinutos(pontos.ALMOCO_SAIDA)]);
    if (pontos.ALMOCO_RETORNO && pontos.SAIDA) intervalos.push([paraMinutos(pontos.ALMOCO_RETORNO), paraMinutos(pontos.SAIDA)]);
    if (pontos.ENTRADA && pontos.SAIDA && !pontos.ALMOCO_SAIDA && !pontos.ALMOCO_RETORNO) {
        intervalos.push([paraMinutos(pontos.ENTRADA), paraMinutos(pontos.SAIDA)]);
    }

    // As duas janelas noturnas representáveis dentro de um único "dia" de 0 a 1440 minutos.
    const janelas = [[0, FIM_NOTURNO_MIN], [INICIO_NOTURNO_MIN, 24 * 60]];

    let totalNoturno = 0;
    for (const [ini, fim] of intervalos) {
        for (const [jIni, jFim] of janelas) {
            const inicioSobreposicao = Math.max(ini, jIni);
            const fimSobreposicao = Math.min(fim, jFim);
            if (fimSobreposicao > inicioSobreposicao) totalNoturno += fimSobreposicao - inicioSobreposicao;
        }
    }
    return totalNoturno;
}

/**
 * Converte salário-base em valor-hora, usando a jornada mensal de referência (220h por padrão,
 * configurável). Retorna null se não houver salário cadastrado — o resto do sistema já lida
 * com isso mostrando "---" em vez de um valor em R$.
 */
function calcularValorHora(salarioBase) {
    if (salarioBase === null || salarioBase === undefined || salarioBase <= 0) return null;
    return salarioBase / config.jornadaMensalHorasPadrao;
}

/**
 * Verifica o descanso entre o fim de um turno num dia e o início do turno no dia seguinte
 * (intervalo interjornada — Art. 66 da CLT exige no mínimo 11h corridas). Recebe as duas
 * pontas já como Date completas (data + hora) pra lidar corretamente com a virada de dia.
 * Retorna { minutosDescanso, violou }.
 */
function calcularDescansoInterjornada(dataAnteriorISO, horaSaidaAnterior, dataAtualISO, horaEntradaAtual) {
    const fimAnterior = new Date(`${dataAnteriorISO}T${horaSaidaAnterior}:00`);
    const inicioAtual = new Date(`${dataAtualISO}T${horaEntradaAtual}:00`);
    const minutosDescanso = Math.round((inicioAtual - fimAnterior) / 60000);
    return { minutosDescanso, violou: minutosDescanso < config.minutosMinimosInterjornada };
}

/**
 * Varre uma lista de dias JÁ ORDENADA CRONOLOGICAMENTE de UM funcionário (cada item precisa
 * ter dataISO e pontos.ENTRADA/pontos.SAIDA) e devolve as violações de intervalo interjornada
 * encontradas entre dias CONSECUTIVOS (não pula dias sem registro — só compara pares onde os
 * dois lados têm saída/entrada batidas).
 */
function calcularViolacoesInterjornada(diasOrdenados) {
    const violacoes = [];
    for (let i = 1; i < diasOrdenados.length; i++) {
        const anterior = diasOrdenados[i - 1];
        const atual = diasOrdenados[i];
        if (!anterior.pontos.SAIDA || !atual.pontos.ENTRADA) continue;

        const { minutosDescanso, violou } = calcularDescansoInterjornada(
            anterior.dataISO, anterior.pontos.SAIDA, atual.dataISO, atual.pontos.ENTRADA
        );
        if (violou && minutosDescanso >= 0) { // negativo indicaria dados inconsistentes (ex: ajuste manual estranho), ignora
            violacoes.push({
                dataAnterior: anterior.dataISO,
                dataAtual: atual.dataISO,
                minutosDescanso,
                minutosFaltantes: config.minutosMinimosInterjornada - minutosDescanso
            });
        }
    }
    return violacoes;
}

/**
 * Monta o relatório calculado de um dia completo para um funcionário — junta todas as
 * funções acima. É a substituta direta do bloco de ~120 linhas que existia dentro
 * do handler de /api/relatorio-calculado no projeto original.
 */
function montarRelatorioDia({ funcionario, dataISO, pontos, justificativas, ehFeriado, percentuaisHorasExtras, jornadaPorGrupo }) {
    const totalMinutos = calcularTempoTrabalhadoMinutos(pontos);
    const atrasoEntrada = calcularAtrasoEntradaMinutos(pontos, dataISO, jornadaPorGrupo);
    const atrasoAlmoco = calcularAtrasoAlmocoMinutos(pontos, funcionario.tolerancia_almoco_min, !!funcionario.almoco_flexivel);
    const atrasoTotal = atrasoEntrada + atrasoAlmoco;
    const metaMinutos = calcularMetaMinutos(dataISO, jornadaPorGrupo, ehFeriado);
    const saldo = calcularSaldo(totalMinutos, metaMinutos, pontos, atrasoTotal);
    const saldoMinutos = calcularSaldoMinutos(totalMinutos, metaMinutos, pontos, atrasoTotal);
    const horasExtras = calcularHorasExtras(totalMinutos, metaMinutos, dataISO, ehFeriado, percentuaisHorasExtras);
    const cfgGrupoHoje = configDoGrupoNaData(dataISO, jornadaPorGrupo);

    const minutosNoturnos = calcularMinutosNoturnos(pontos);
    const percentualNoturno = percentuaisHorasExtras.adicional_noturno ?? config.horasExtrasPadrao.adicional_noturno;

    const valorHora = calcularValorHora(funcionario.salario_base);
    const valorExtra = valorHora !== null && horasExtras.minutosExtra > 0
        ? +((horasExtras.minutosExtra / 60) * valorHora * (1 + horasExtras.percentual)).toFixed(2)
        : null;
    const valorNoturno = valorHora !== null && minutosNoturnos > 0
        ? +((minutosNoturnos / 60) * valorHora * (1 + percentualNoturno)).toFixed(2)
        : null;

    return {
        funcionarioId: funcionario.id,
        emoji: funcionario.emoji,
        nome: funcionario.nome,
        regime: funcionario.regime,
        dataISO,
        data: require('../utils/tempo').formatarDataBR(dataISO),
        horario_combinado: cfgGrupoHoje ? cfgGrupoHoje.horario_entrada : '---',
        horas_contratadas: funcionario.horas_diarias,
        pontos,
        justificativas,
        tempo_trabalhado: minutosParaStr(totalMinutos),
        trabalhadoMinutos: totalMinutos,
        atraso: minutosParaStr(atrasoTotal),
        atrasoMinutos: atrasoTotal,
        ehFeriado: !!ehFeriado,
        saldo,
        saldoMinutos,
        atrasoToleradoNoSaldo: atrasoTotal > 0 && atrasoTotal <= config.jornada.minutosAtrasoSemDescontoNoSaldo,
        horas_extras: {
            tempo: horasExtras.minutosExtra > 0 ? minutosParaStr(horasExtras.minutosExtra) : '00:00',
            tipo: horasExtras.tipoExtra,
            percentual: horasExtras.percentual,
            minutos: horasExtras.minutosExtra,
            valor: valorExtra
        },
        horas_noturnas: {
            tempo: minutosNoturnos > 0 ? minutosParaStr(minutosNoturnos) : '00:00',
            percentual: percentualNoturno,
            minutos: minutosNoturnos,
            valor: valorNoturno
        }
    };
}

module.exports = {
    calcularTempoTrabalhadoMinutos,
    calcularAtrasoEntradaMinutos,
    calcularAtrasoAlmocoMinutos,
    calcularMetaMinutos,
    calcularSaldo,
    calcularSaldoMinutos,
    calcularHorasExtras,
    calcularMinutosNoturnos,
    calcularValorHora,
    calcularDescansoInterjornada,
    calcularViolacoesInterjornada,
    montarRelatorioDia,
    configDoGrupoNaData
};
