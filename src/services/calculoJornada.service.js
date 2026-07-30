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

/**
 * Configuração da jornada válida para a data, ou null (domingo / dia não configurado
 * como de trabalho).
 *
 * A TROCA DE DIA muda essa resposta, porque ela move a jornada de um dia para o outro:
 *   - no dia da folga não há jornada nenhuma (null)
 *   - no dia trabalhado em compensação vale a jornada do dia que foi trocado — é o que
 *     faz o domingo virar expediente normal em vez de hora extra de 100%
 */
function configDoGrupoNaData(dataISO, jornadaPorGrupo, troca) {
    if (troca && troca.papel === 'folga') return null;

    const dataDeReferencia = troca && troca.papel === 'trabalho' ? troca.dataFolga : dataISO;
    const grupo = grupoDoDia(dataDeReferencia);
    if (!grupo) return null;
    const cfg = jornadaPorGrupo && jornadaPorGrupo[grupo];
    if (!cfg || !cfg.trabalha) return null;
    return cfg;
}

/**
 * Atraso BRUTO da entrada — quantos minutos depois do horário combinado a pessoa chegou,
 * sem aplicar tolerância. Serve de base para o cálculo tolerado logo abaixo.
 */
function calcularAtrasoEntradaBruto(pontos, dataISO, jornadaPorGrupo, troca) {
    if (!pontos.ENTRADA) return 0;
    const cfg = configDoGrupoNaData(dataISO, jornadaPorGrupo, troca);
    if (!cfg) return 0;
    return Math.max(0, paraMinutos(pontos.ENTRADA) - paraMinutos(cfg.horario_entrada));
}

/**
 * Atraso de entrada CONTABILIZADO, já com a tolerância da empresa aplicada.
 * Até 10 minutos (config.jornada.toleranciaEntradaMin) o atraso é zero: está dentro
 * da tolerância, então não aparece no relatório nem desconta do saldo. A partir daí,
 * conta o atraso inteiro — não apenas o que passou dos 10 minutos.
 */
function calcularAtrasoEntradaMinutos(pontos, dataISO, jornadaPorGrupo, troca) {
    const bruto = calcularAtrasoEntradaBruto(pontos, dataISO, jornadaPorGrupo, troca);
    return bruto > config.jornada.toleranciaEntradaMin ? bruto : 0;
}

/**
 * Atraso por estourar o tempo de almoço, em minutos.
 * `toleranciaMin` (tempo de almoço combinado) e `flexivel` vêm do CADASTRO do funcionário.
 *
 * Além do tempo combinado há 1 minuto de folga (config.jornada.toleranciaAlmocoMin), para
 * não penalizar o arredondamento de quem bate o ponto no minuto seguinte. Passou disso, o
 * excedente conta como atraso E desconta do saldo — aqui não existe o perdão que a entrada
 * tem, porque estourar o almoço é escolha de quem está no intervalo.
 */
function calcularAtrasoAlmocoMinutos(pontos, toleranciaMin, flexivel) {
    return calcularExcessoAlmoco(pontos, toleranciaMin, flexivel).atraso;
}

/**
 * Detalha o estouro do almoço: quanto passou do combinado, quanto disso ficou dentro
 * do minuto de folga (`perdoado`) e quanto virou atraso de fato.
 *
 * O minuto de folga precisa ser devolvido ao saldo também — se ele não conta como
 * atraso, não pode aparecer como desconto de horas: seria a mesma falta punida
 * de um jeito e perdoada de outro.
 */
function calcularExcessoAlmoco(pontos, toleranciaMin, flexivel) {
    if (flexivel || !pontos.ALMOCO_SAIDA || !pontos.ALMOCO_RETORNO) {
        return { excesso: 0, perdoado: 0, atraso: 0 };
    }

    const tempoAlmocoReal = paraMinutos(pontos.ALMOCO_RETORNO) - paraMinutos(pontos.ALMOCO_SAIDA);
    const excesso = Math.max(0, tempoAlmocoReal - toleranciaMin);
    const perdoado = Math.min(excesso, config.jornada.toleranciaAlmocoMin);
    return { excesso, perdoado, atraso: excesso - perdoado };
}

/**
 * Meta de minutos trabalhados esperada no dia, a partir da configuração do dia da semana
 * específico. Feriado sempre zera a meta (todo trabalho vira extra). Domingo, ou um dia
 * marcado como "não trabalha", também resulta em meta 0.
 */
function calcularMetaMinutos(dataISO, jornadaPorGrupo, ehFeriado, troca) {
    if (ehFeriado) return 0;
    const cfg = configDoGrupoNaData(dataISO, jornadaPorGrupo, troca);
    return cfg ? cfg.meta_minutos : 0;
}

/**
 * Saldo do dia em MINUTOS, já com a tolerância de entrada aplicada.
 *
 * `minutosPerdoados` é o atraso de entrada que caiu dentro da tolerância (até 10 min).
 * Como esse atraso não conta, o tempo que ele custou também não pode descontar do saldo —
 * o saldo é devolvido na medida exata, sem nunca virar crédito.
 *
 * O perdão cobre no máximo o próprio atraso tolerado: quem chegou 8 min tarde E saiu
 * 30 min mais cedo continua com -22 min (só os 8 são relevados). Atraso de almoço
 * nunca é perdoado aqui.
 *
 * Devolve null quando não dá para calcular saldo (sem meta, sem entrada ou sem saída).
 */
function calcularSaldoMinutos(totalMinutos, metaMinutos, pontos, minutosPerdoados = 0) {
    if (metaMinutos === 0 || totalMinutos === 0 || !pontos.ENTRADA || !pontos.SAIDA) {
        return null;
    }

    const saldoBruto = totalMinutos - metaMinutos;
    if (minutosPerdoados <= 0 || saldoBruto >= 0) return saldoBruto;

    return Math.min(0, saldoBruto + minutosPerdoados);
}

/** Saldo do dia formatado como "+/-HH:MM" ou "---". */
function calcularSaldo(totalMinutos, metaMinutos, pontos, minutosPerdoados = 0) {
    const saldo = calcularSaldoMinutos(totalMinutos, metaMinutos, pontos, minutosPerdoados);
    if (saldo === null) return '---';
    return minutosParaStr(saldo, true);
}

/**
 * Classifica o excedente de horas (o que passou da meta) em faixas de hora extra, usando os
 * percentuais configurados em `config_horas_extras`. Sábado conta como "dia_util" pra esse
 * fim (só domingo e feriado têm percentual diferenciado) — pedido explícito do cliente.
 * Retorna { minutosExtra, tipoExtra, percentual } — tipoExtra é 'dia_util' | 'domingo_feriado'.
 */
function calcularHorasExtras(totalMinutos, metaMinutos, dataISO, ehFeriado, percentuaisPorTipo, troca) {
    const excedente = Math.max(0, totalMinutos - metaMinutos);
    if (excedente === 0) return { minutosExtra: 0, tipoExtra: null, percentual: 0 };

    const grupo = grupoDoDia(dataISO);
    // Dia trabalhado em compensação de folga é expediente normal deslocado: mesmo caindo
    // num domingo, o que passar da meta é extra de dia útil, não de domingo/feriado.
    const ehCompensacao = troca && troca.papel === 'trabalho';
    const tipoExtra = (!ehCompensacao && (ehFeriado || grupo === null)) ? 'domingo_feriado' : 'dia_util';

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
function montarRelatorioDia({ funcionario, dataISO, pontos, justificativas, ehFeriado, percentuaisHorasExtras, jornadaPorGrupo, troca, tratativa }) {
    const totalMinutos = calcularTempoTrabalhadoMinutos(pontos);

    // Entrada: atraso dentro da tolerância não conta e não desconta — mas o tempo que
    // ele custou precisa ser devolvido ao saldo (é o `perdoado`).
    const atrasoEntradaBruto = calcularAtrasoEntradaBruto(pontos, dataISO, jornadaPorGrupo, troca);
    let atrasoEntrada = calcularAtrasoEntradaMinutos(pontos, dataISO, jornadaPorGrupo, troca);
    let perdoadoNoSaldo = atrasoEntrada === 0 ? atrasoEntradaBruto : 0;

    /**
     * Tratativa do dia (ver migração 0007):
     *   atraso_abonado    -> o atraso sai do relatório e o tempo é devolvido ao saldo
     *   atraso_registrado -> fica documentado, mas o atraso CONTINUA contando
     *   atestado_horas    -> abona um número de minutos do dia (consulta no meio do turno)
     */
    const abonoAtraso = tratativa && tratativa.tipo === 'atraso_abonado';
    if (abonoAtraso) {
        perdoadoNoSaldo = atrasoEntradaBruto;
        atrasoEntrada = 0;
    }
    const minutosAbonados = tratativa ? Math.max(0, tratativa.minutos_abonados || 0) : 0;

    // Almoço: o minuto de folga também é devolvido ao saldo, pelo mesmo motivo.
    const almoco = calcularExcessoAlmoco(pontos, funcionario.tolerancia_almoco_min, !!funcionario.almoco_flexivel);
    const atrasoAlmoco = almoco.atraso;
    const atrasoTotal = atrasoEntrada + atrasoAlmoco;
    // Minutos de atestado de horas entram como tempo abonado no saldo, sem inflar
    // o "tempo trabalhado" (que precisa refletir o que foi de fato batido no ponto).
    const totalPerdoado = perdoadoNoSaldo + almoco.perdoado + (abonoAtraso ? 0 : minutosAbonados);

    const metaMinutos = calcularMetaMinutos(dataISO, jornadaPorGrupo, ehFeriado, troca);
    const saldo = calcularSaldo(totalMinutos, metaMinutos, pontos, totalPerdoado);
    const saldoMinutos = calcularSaldoMinutos(totalMinutos, metaMinutos, pontos, totalPerdoado);
    const horasExtras = calcularHorasExtras(totalMinutos, metaMinutos, dataISO, ehFeriado, percentuaisHorasExtras, troca);
    const cfgGrupoHoje = configDoGrupoNaData(dataISO, jornadaPorGrupo, troca);

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
        // true quando a pessoa chegou atrasada mas dentro da tolerância — o gestor pode
        // querer saber que houve atraso relevado, mesmo ele não contando em lugar nenhum.
        entradaDentroDaTolerancia: perdoadoNoSaldo > 0 && !abonoAtraso,
        minutosAtrasoEntradaBruto: atrasoEntradaBruto,
        atrasoAlmocoMinutos: atrasoAlmoco,
        // Troca de dia e tratativa vão para o relatório para a interface poder
        // explicar POR QUE aquele dia foge do padrão.
        troca: troca ? { papel: troca.papel, dataPar: troca.papel === 'folga' ? troca.dataTrabalho : troca.dataFolga } : null,
        tratativa: tratativa
            ? { tipo: tratativa.tipo, minutos_abonados: minutosAbonados, motivo: tratativa.motivo || null }
            : null,
        minutosAbonados,
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
    calcularAtrasoEntradaBruto,
    calcularAtrasoEntradaMinutos,
    calcularAtrasoAlmocoMinutos,
    calcularExcessoAlmoco,
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

