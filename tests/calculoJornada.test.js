const test = require('node:test');
const assert = require('node:assert');

const calc = require('../src/services/calculoJornada.service');

/**
 * Regras de cálculo da jornada. São funções puras (não tocam banco nem HTTP), então
 * dá para testar direto. Rode com: npm test
 *
 * O objetivo aqui é travar as regras de negócio: se alguém mexer no cálculo de atraso,
 * tolerância, hora extra ou adicional noturno e quebrar um caso, o teste acusa antes
 * de virar erro na folha de pagamento de alguém.
 */

const JORNADA_PADRAO = {
    segunda: { horario_entrada: '08:00', meta_minutos: 480, trabalha: true },
    terca: { horario_entrada: '08:00', meta_minutos: 480, trabalha: true },
    quarta: { horario_entrada: '08:00', meta_minutos: 480, trabalha: true },
    quinta: { horario_entrada: '08:00', meta_minutos: 480, trabalha: true },
    sexta: { horario_entrada: '08:00', meta_minutos: 360, trabalha: true },
    sabado: { horario_entrada: '08:00', meta_minutos: 0, trabalha: false }
};

const QUARTA = '2026-07-22';
const SABADO = '2026-07-25';
const DOMINGO = '2026-07-26';

const PERCENTUAIS = { dia_util: 0.6, domingo_feriado: 1.0, adicional_noturno: 0.2 };

const diaCompleto = { ENTRADA: '08:00', ALMOCO_SAIDA: '12:00', ALMOCO_RETORNO: '13:00', SAIDA: '17:00' };

/* ===================== Tempo trabalhado ===================== */

test('tempo trabalhado desconta o intervalo de almoço', () => {
    assert.strictEqual(calc.calcularTempoTrabalhadoMinutos(diaCompleto), 480);
});

test('tempo trabalhado funciona sem intervalo registrado', () => {
    assert.strictEqual(calc.calcularTempoTrabalhadoMinutos({ ENTRADA: '08:00', SAIDA: '12:00' }), 240);
});

test('dia sem saída não conta tempo', () => {
    assert.strictEqual(calc.calcularTempoTrabalhadoMinutos({ ENTRADA: '08:00' }), 0);
});

test('saída antes da entrada não gera tempo negativo', () => {
    assert.strictEqual(calc.calcularTempoTrabalhadoMinutos({ ENTRADA: '17:00', SAIDA: '08:00' }), 0);
});

/* ===================== Atraso ===================== */

test('atraso de entrada acima da tolerância conta integralmente', () => {
    const pontos = { ...diaCompleto, ENTRADA: '08:12' };
    assert.strictEqual(calc.calcularAtrasoEntradaMinutos(pontos, QUARTA, JORNADA_PADRAO), 12);
});

test('atraso de entrada DENTRO da tolerância (ate 10 min) nao conta como atraso', () => {
    for (const minutos of [1, 5, 10]) {
        const hora = `08:${String(minutos).padStart(2, '0')}`;
        const pontos = { ...diaCompleto, ENTRADA: hora };
        assert.strictEqual(
            calc.calcularAtrasoEntradaMinutos(pontos, QUARTA, JORNADA_PADRAO), 0,
            `chegar as ${hora} esta dentro da tolerancia e nao deveria gerar atraso`
        );
    }
});

test('11 minutos ja passa da tolerância e conta os 11, não só o excedente', () => {
    const pontos = { ...diaCompleto, ENTRADA: '08:11' };
    assert.strictEqual(calc.calcularAtrasoEntradaMinutos(pontos, QUARTA, JORNADA_PADRAO), 11);
});

test('atraso bruto de entrada é registrado mesmo quando tolerado', () => {
    const pontos = { ...diaCompleto, ENTRADA: '08:07' };
    assert.strictEqual(calc.calcularAtrasoEntradaBruto(pontos, QUARTA, JORNADA_PADRAO), 7);
    assert.strictEqual(calc.calcularAtrasoEntradaMinutos(pontos, QUARTA, JORNADA_PADRAO), 0);
});

test('chegar adiantado não gera atraso negativo', () => {
    const pontos = { ...diaCompleto, ENTRADA: '07:40' };
    assert.strictEqual(calc.calcularAtrasoEntradaMinutos(pontos, QUARTA, JORNADA_PADRAO), 0);
});

test('dia sem expediente configurado não gera atraso', () => {
    assert.strictEqual(calc.calcularAtrasoEntradaMinutos(diaCompleto, SABADO, JORNADA_PADRAO), 0);
});

test('almoço no tempo combinado não gera atraso', () => {
    assert.strictEqual(calc.calcularAtrasoAlmocoMinutos(diaCompleto, 60, false), 0); // 60 min exatos
});

test('almoço com 1 minuto a mais está na tolerância', () => {
    const pontos = { ...diaCompleto, ALMOCO_RETORNO: '13:01' }; // 61 min
    assert.strictEqual(calc.calcularAtrasoAlmocoMinutos(pontos, 60, false), 0);
});

test('almoço acima de 1 minuto de folga desconta o excedente', () => {
    const pontos = { ...diaCompleto, ALMOCO_RETORNO: '13:05' }; // 65 min: 5 - 1 de folga
    assert.strictEqual(calc.calcularAtrasoAlmocoMinutos(pontos, 60, false), 4);
});

test('almoço muito longo conta o excedente inteiro menos 1 minuto', () => {
    const pontos = { ...diaCompleto, ALMOCO_RETORNO: '13:20' }; // 80 min: 20 - 1
    assert.strictEqual(calc.calcularAtrasoAlmocoMinutos(pontos, 60, false), 19);
});

test('almoço flexível nunca gera atraso', () => {
    const pontos = { ...diaCompleto, ALMOCO_RETORNO: '14:30' };
    assert.strictEqual(calc.calcularAtrasoAlmocoMinutos(pontos, 60, true), 0);
});

/* ===================== Tolerância aplicada ao saldo ===================== */

test('atraso de entrada tolerado não deixa o dia negativo', () => {
    for (const atraso of [1, 5, 10]) {
        const saldo = calc.calcularSaldoMinutos(480 - atraso, 480, diaCompleto, atraso);
        assert.strictEqual(saldo, 0, `atraso de ${atraso} min deveria manter o saldo em zero`);
    }
});

test('atraso acima da tolerância desconta INTEGRALMENTE (nada é perdoado)', () => {
    assert.strictEqual(calc.calcularSaldoMinutos(468, 480, diaCompleto, 0), -12);
    assert.strictEqual(calc.calcularSaldoMinutos(450, 480, diaCompleto, 0), -30);
});

test('perdão não vira brecha para sair mais cedo', () => {
    // Atrasou 8 min (tolerado) mas saiu 30 min antes: devolve so os 8.
    assert.strictEqual(calc.calcularSaldoMinutos(450, 480, diaCompleto, 8), -22);
});

test('perdão não cria crédito quando o saldo já é positivo', () => {
    assert.strictEqual(calc.calcularSaldoMinutos(500, 480, diaCompleto, 8), 20);
});

test('saldo é nulo quando falta entrada ou saída', () => {
    assert.strictEqual(calc.calcularSaldoMinutos(480, 480, { ENTRADA: '08:00' }, 0), null);
    assert.strictEqual(calc.calcularSaldo(480, 480, { ENTRADA: '08:00' }, 0), '---');
});

test('saldo formatado usa sinal e HH:MM', () => {
    assert.strictEqual(calc.calcularSaldo(500, 480, diaCompleto, 0), '+00:20');
    assert.strictEqual(calc.calcularSaldo(450, 480, diaCompleto, 0), '-00:30');
});

/* ===================== Meta do dia ===================== */

test('feriado zera a meta do dia', () => {
    assert.strictEqual(calc.calcularMetaMinutos(QUARTA, JORNADA_PADRAO, true), 0);
});

test('domingo e dia não trabalhado têm meta zero', () => {
    assert.strictEqual(calc.calcularMetaMinutos(DOMINGO, JORNADA_PADRAO, false), 0);
    assert.strictEqual(calc.calcularMetaMinutos(SABADO, JORNADA_PADRAO, false), 0);
});

test('cada dia da semana usa a própria meta', () => {
    assert.strictEqual(calc.calcularMetaMinutos(QUARTA, JORNADA_PADRAO, false), 480);
    assert.strictEqual(calc.calcularMetaMinutos('2026-07-24', JORNADA_PADRAO, false), 360); // sexta
});

/* ===================== Horas extras ===================== */

test('sábado conta como dia útil (60%), não como domingo', () => {
    const r = calc.calcularHorasExtras(240, 0, SABADO, false, PERCENTUAIS);
    assert.strictEqual(r.tipoExtra, 'dia_util');
    assert.strictEqual(r.percentual, 0.6);
    assert.strictEqual(r.minutosExtra, 240);
});

test('domingo e feriado usam 100%', () => {
    assert.strictEqual(calc.calcularHorasExtras(120, 0, DOMINGO, false, PERCENTUAIS).percentual, 1.0);
    assert.strictEqual(calc.calcularHorasExtras(120, 0, QUARTA, true, PERCENTUAIS).percentual, 1.0);
});

test('trabalhar dentro da meta não gera hora extra', () => {
    const r = calc.calcularHorasExtras(480, 480, QUARTA, false, PERCENTUAIS);
    assert.strictEqual(r.minutosExtra, 0);
    assert.strictEqual(r.tipoExtra, null);
});

/* ===================== Adicional noturno ===================== */

test('adicional noturno pega apenas a janela 22h–5h', () => {
    // 20h às 23h → só 22h-23h conta (60 min)
    assert.strictEqual(calc.calcularMinutosNoturnos({ ENTRADA: '20:00', SAIDA: '23:00' }), 60);
});

test('madrugada inteira dentro da janela conta integralmente', () => {
    assert.strictEqual(calc.calcularMinutosNoturnos({ ENTRADA: '00:00', SAIDA: '05:00' }), 300);
});

test('turno totalmente diurno não gera adicional noturno', () => {
    assert.strictEqual(calc.calcularMinutosNoturnos(diaCompleto), 0);
});

/* ===================== Valor-hora ===================== */

test('valor-hora usa a jornada mensal de referência (220h)', () => {
    assert.strictEqual(calc.calcularValorHora(2200), 10);
});

test('sem salário cadastrado não há valor-hora', () => {
    assert.strictEqual(calc.calcularValorHora(null), null);
    assert.strictEqual(calc.calcularValorHora(0), null);
});

/* ===================== Interjornada (Art. 66 CLT) ===================== */

test('menos de 11h entre turnos é violação', () => {
    const r = calc.calcularDescansoInterjornada('2026-07-22', '22:00', '2026-07-23', '06:00');
    assert.strictEqual(r.minutosDescanso, 480);
    assert.strictEqual(r.violou, true);
});

test('11h ou mais de descanso não é violação', () => {
    const r = calc.calcularDescansoInterjornada('2026-07-22', '18:00', '2026-07-23', '08:00');
    assert.strictEqual(r.violou, false);
});

test('violações são detectadas apenas entre dias com saída e entrada registradas', () => {
    const dias = [
        { dataISO: '2026-07-22', pontos: { ENTRADA: '08:00', SAIDA: '23:00' } },
        { dataISO: '2026-07-23', pontos: { ENTRADA: '07:00', SAIDA: '17:00' } },
        { dataISO: '2026-07-24', pontos: { ENTRADA: '08:00' } } // sem saída: não compara
    ];
    const violacoes = calc.calcularViolacoesInterjornada(dias);
    assert.strictEqual(violacoes.length, 1);
    assert.strictEqual(violacoes[0].minutosDescanso, 480);
});

/* ===================== Relatório do dia (integração das regras) ===================== */

test('relatório do dia: atraso tolerado nao aparece e nao desconta', () => {
    const dia = calc.montarRelatorioDia({
        funcionario: { id: 1, nome: 'Teste', emoji: 'T', regime: 'CLT', horas_diarias: '8h', tolerancia_almoco_min: 60, almoco_flexivel: 0, salario_base: null },
        dataISO: QUARTA,
        pontos: { ENTRADA: '08:08', ALMOCO_SAIDA: '12:00', ALMOCO_RETORNO: '13:00', SAIDA: '17:00' },
        justificativas: {},
        ehFeriado: false,
        percentuaisHorasExtras: PERCENTUAIS,
        jornadaPorGrupo: JORNADA_PADRAO
    });

    assert.strictEqual(dia.atrasoMinutos, 8, 'o atraso APARECE no relatorio, para o gestor ver a disciplina');
    assert.strictEqual(dia.atraso, '00:08');
    assert.strictEqual(dia.atrasoDescontavelMinutos, 0, 'mas nao pesa na folha: 8 min esta abaixo do limiar de 11');
    assert.strictEqual(dia.saldoMinutos, 0, 'e o saldo fica intacto');
    assert.strictEqual(dia.atrasoDentroDoLimiar, true);
    assert.strictEqual(dia.minutosAtrasoEntradaBruto, 8);
});

test('relatório do dia: atraso acima da tolerância conta e desconta', () => {
    const dia = calc.montarRelatorioDia({
        funcionario: { id: 1, nome: 'Teste', emoji: 'T', regime: 'CLT', horas_diarias: '8h', tolerancia_almoco_min: 60, almoco_flexivel: 0, salario_base: null },
        dataISO: QUARTA,
        pontos: { ENTRADA: '08:25', ALMOCO_SAIDA: '12:00', ALMOCO_RETORNO: '13:00', SAIDA: '17:00' },
        justificativas: {},
        ehFeriado: false,
        percentuaisHorasExtras: PERCENTUAIS,
        jornadaPorGrupo: JORNADA_PADRAO
    });

    assert.strictEqual(dia.atrasoMinutos, 25);
    assert.strictEqual(dia.atrasoDescontavelMinutos, 25, 'acima do limiar, desconta por inteiro');
    assert.strictEqual(dia.saldoMinutos, -25);
    assert.strictEqual(dia.atrasoDentroDoLimiar, false);
});

test('relatório do dia: almoço estourado abaixo do limiar registra mas não desconta', () => {
    const dia = calc.montarRelatorioDia({
        funcionario: { id: 1, nome: 'Teste', emoji: 'T', regime: 'CLT', horas_diarias: '8h', tolerancia_almoco_min: 60, almoco_flexivel: 0, salario_base: null },
        dataISO: QUARTA,
        // Entrou no horário, mas almoçou 70 min (10 acima do combinado, 9 acima da folga de 1)
        pontos: { ENTRADA: '08:00', ALMOCO_SAIDA: '12:00', ALMOCO_RETORNO: '13:10', SAIDA: '17:00' },
        justificativas: {},
        ehFeriado: false,
        percentuaisHorasExtras: PERCENTUAIS,
        jornadaPorGrupo: JORNADA_PADRAO
    });

    assert.strictEqual(dia.atrasoAlmocoMinutos, 9, '70 min de almoco: 10 acima do combinado menos 1 de folga');
    assert.strictEqual(dia.atrasoMinutos, 9, 'aparece no relatorio');
    assert.strictEqual(dia.saldoMinutos, 0, '9 min esta abaixo do limiar de 11: nao desconta');
});

test('relatório do dia: entrada tolerada + almoço estourado somam corretamente', () => {
    const dia = calc.montarRelatorioDia({
        funcionario: { id: 1, nome: 'Teste', emoji: 'T', regime: 'CLT', horas_diarias: '8h', tolerancia_almoco_min: 60, almoco_flexivel: 0, salario_base: null },
        dataISO: QUARTA,
        // 5 min de atraso (tolerado) + almoco de 65 min (4 de atraso apos a folga)
        pontos: { ENTRADA: '08:05', ALMOCO_SAIDA: '12:00', ALMOCO_RETORNO: '13:05', SAIDA: '17:00' },
        justificativas: {},
        ehFeriado: false,
        percentuaisHorasExtras: PERCENTUAIS,
        jornadaPorGrupo: JORNADA_PADRAO
    });

    assert.strictEqual(dia.atrasoMinutos, 9, 'entrada e almoco SOMAM: 5 + 4');
    assert.strictEqual(dia.saldoMinutos, 0, 'a soma deu 9, abaixo do limiar de 11: registra sem descontar');
});

test('trabalho em feriado vira hora extra de 100% sem meta', () => {
    const dia = calc.montarRelatorioDia({
        funcionario: { id: 1, nome: 'Teste', emoji: 'T', regime: 'CLT', horas_diarias: '8h', tolerancia_almoco_min: 60, almoco_flexivel: 0, salario_base: 2200 },
        dataISO: QUARTA,
        pontos: { ENTRADA: '08:00', SAIDA: '12:00' },
        justificativas: {},
        ehFeriado: true,
        percentuaisHorasExtras: PERCENTUAIS,
        jornadaPorGrupo: JORNADA_PADRAO
    });

    assert.strictEqual(dia.horas_extras.tipo, 'domingo_feriado');
    assert.strictEqual(dia.horas_extras.minutos, 240);
    assert.strictEqual(dia.horas_extras.valor, 80, '4h × R$10/h × 2 (100% de adicional)');
});

test('regra geral do atraso: registra sempre, desconta so a partir de 11 min no dia', () => {
    // registrado = o que aparece no relatorio (entrada + almoco somados)
    // descontado = o que pesa na folha (o total, mas so quando o total chega a 11)
    const cenarios = [
        { entrada: '08:00', retorno: '13:00', registrado: 0,  descontado: 0 },
        { entrada: '08:08', retorno: '13:00', registrado: 8,  descontado: 0 },  // so entrada, abaixo do limiar
        { entrada: '08:00', retorno: '13:01', registrado: 0,  descontado: 0 },  // 1 min de almoco esta na folga
        { entrada: '08:08', retorno: '13:01', registrado: 8,  descontado: 0 },  // 8 + 0
        { entrada: '08:00', retorno: '13:06', registrado: 5,  descontado: 0 },  // 6 de almoco - 1 de folga
        { entrada: '08:08', retorno: '13:06', registrado: 13, descontado: 13 }, // 8 + 5 estoura o limiar
        { entrada: '08:10', retorno: '13:02', registrado: 11, descontado: 11 }, // exatamente 11: ja desconta
        { entrada: '08:10', retorno: '13:01', registrado: 10, descontado: 0 },  // exatamente 10: ainda nao
        { entrada: '08:20', retorno: '13:00', registrado: 20, descontado: 20 }, // entrada sozinha estoura
        { entrada: '08:20', retorno: '13:06', registrado: 25, descontado: 25 }
    ];

    cenarios.forEach(({ entrada, retorno, registrado, descontado }) => {
        const dia = calc.montarRelatorioDia({
            funcionario: { id: 1, nome: 'T', emoji: 'T', regime: 'CLT', horas_diarias: '8h', tolerancia_almoco_min: 60, almoco_flexivel: 0, salario_base: null },
            dataISO: QUARTA,
            pontos: { ENTRADA: entrada, ALMOCO_SAIDA: '12:00', ALMOCO_RETORNO: retorno, SAIDA: '17:00' },
            justificativas: {},
            ehFeriado: false,
            percentuaisHorasExtras: PERCENTUAIS,
            jornadaPorGrupo: JORNADA_PADRAO
        });
        assert.strictEqual(dia.atrasoMinutos, registrado, `atraso registrado de ${entrada}/${retorno}`);
        assert.strictEqual(dia.atrasoDescontavelMinutos, descontado, `atraso descontado de ${entrada}/${retorno}`);
        assert.strictEqual(dia.saldoMinutos, descontado === 0 ? 0 : -descontado, `saldo de ${entrada}/${retorno}`);
    });
});

/* ===================== Troca de dia (folga compensada) ===================== */

const SEGUNDA = '2026-07-20';

test('troca: dia de folga fica sem meta e sem atraso', () => {
    const troca = { papel: 'folga', dataFolga: SABADO, dataTrabalho: DOMINGO };
    // Sábado normalmente já não tem meta nesta jornada; usa a segunda para provar o efeito
    const trocaSegunda = { papel: 'folga', dataFolga: SEGUNDA, dataTrabalho: DOMINGO };

    assert.strictEqual(calc.calcularMetaMinutos(SEGUNDA, JORNADA_PADRAO, false, trocaSegunda), 0,
        'no dia da folga a meta é zero');
    assert.strictEqual(calc.calcularAtrasoEntradaMinutos({ ...diaCompleto, ENTRADA: '10:00' }, SEGUNDA, JORNADA_PADRAO, trocaSegunda), 0,
        'no dia da folga não existe atraso');
    assert.ok(troca);
});

test('troca: dia compensado herda a meta e o horário do dia trocado', () => {
    // Folgou na segunda (meta 480, entrada 08:00) e trabalhou no domingo
    const troca = { papel: 'trabalho', dataFolga: SEGUNDA, dataTrabalho: DOMINGO };

    assert.strictEqual(calc.calcularMetaMinutos(DOMINGO, JORNADA_PADRAO, false, troca), 480,
        'o domingo passa a ter a meta da segunda');
    assert.strictEqual(calc.calcularAtrasoEntradaMinutos({ ...diaCompleto, ENTRADA: '08:30' }, DOMINGO, JORNADA_PADRAO, troca), 30,
        'e o horário de entrada da segunda também vale no domingo');
});

test('troca: trabalho compensado NÃO é hora extra de 100%', () => {
    const troca = { papel: 'trabalho', dataFolga: SEGUNDA, dataTrabalho: DOMINGO };
    const semTroca = calc.calcularHorasExtras(540, 0, DOMINGO, false, PERCENTUAIS, null);
    const comTroca = calc.calcularHorasExtras(540, 480, DOMINGO, false, PERCENTUAIS, troca);

    assert.strictEqual(semTroca.tipoExtra, 'domingo_feriado', 'sem troca, domingo é 100%');
    assert.strictEqual(comTroca.tipoExtra, 'dia_util', 'com troca, é expediente normal deslocado');
    assert.strictEqual(comTroca.minutosExtra, 60, 'só o que passou da meta herdada é extra');
});

test('troca completa: relatório do domingo compensado sai como dia normal', () => {
    const dia = calc.montarRelatorioDia({
        funcionario: { id: 1, nome: 'T', emoji: 'T', regime: 'CLT', horas_diarias: '8h', tolerancia_almoco_min: 60, almoco_flexivel: 0, salario_base: null },
        dataISO: DOMINGO,
        pontos: { ENTRADA: '08:00', ALMOCO_SAIDA: '12:00', ALMOCO_RETORNO: '13:00', SAIDA: '17:00' },
        justificativas: {},
        ehFeriado: false,
        percentuaisHorasExtras: PERCENTUAIS,
        jornadaPorGrupo: JORNADA_PADRAO,
        troca: { papel: 'trabalho', dataFolga: SEGUNDA, dataTrabalho: DOMINGO }
    });

    assert.strictEqual(dia.saldoMinutos, 0, 'cumpriu a meta herdada: saldo zero');
    assert.strictEqual(dia.horas_extras.minutos, 0, 'sem hora extra');
    assert.strictEqual(dia.troca.papel, 'trabalho');
    assert.strictEqual(dia.troca.dataPar, SEGUNDA, 'o relatório aponta o dia que foi trocado');
});

/* ===================== Tratativa de atraso e atestado de horas ===================== */

const pontosAtrasado = { ENTRADA: '08:30', ALMOCO_SAIDA: '12:00', ALMOCO_RETORNO: '13:00', SAIDA: '17:00' };

function diaComTratativa(tratativa) {
    return calc.montarRelatorioDia({
        funcionario: { id: 1, nome: 'T', emoji: 'T', regime: 'CLT', horas_diarias: '8h', tolerancia_almoco_min: 60, almoco_flexivel: 0, salario_base: null },
        dataISO: QUARTA,
        pontos: pontosAtrasado,
        justificativas: {},
        ehFeriado: false,
        percentuaisHorasExtras: PERCENTUAIS,
        jornadaPorGrupo: JORNADA_PADRAO,
        tratativa
    });
}

test('sem tratativa, o atraso de 30 min conta e desconta', () => {
    const dia = diaComTratativa(null);
    assert.strictEqual(dia.atrasoMinutos, 30);
    assert.strictEqual(dia.saldoMinutos, -30);
});

test('atraso ABONADO sai do relatório e devolve as horas ao saldo', () => {
    const dia = diaComTratativa({ tipo: 'atraso_abonado', minutos_abonados: 0, motivo: 'combinado' });
    assert.strictEqual(dia.atrasoMinutos, 0, 'o atraso deixa de contar');
    assert.strictEqual(dia.saldoMinutos, 0, 'e o tempo perdido volta ao saldo');
    assert.strictEqual(dia.tratativa.tipo, 'atraso_abonado');
});

test('atraso REGISTRADO mantém o atraso e o desconto', () => {
    const dia = diaComTratativa({ tipo: 'atraso_registrado', minutos_abonados: 0, motivo: 'trânsito' });
    assert.strictEqual(dia.atrasoMinutos, 30, 'continua contando — é o objetivo do registro');
    assert.strictEqual(dia.saldoMinutos, -30);
    assert.strictEqual(dia.tratativa.motivo, 'trânsito', 'mas o motivo fica guardado');
});

test('atestado de horas abona os minutos informados no saldo', () => {
    // Chegou 30 min atrasado e o atestado abona 30 min: saldo volta a zero,
    // mas o atraso continua visível (não foi abonado como atraso).
    const dia = diaComTratativa({ tipo: 'atestado_horas', minutos_abonados: 30, motivo: 'consulta' });
    assert.strictEqual(dia.saldoMinutos, 0, 'os 30 min abonados cobrem o buraco no saldo');
    assert.strictEqual(dia.atrasoMinutos, 30, 'o atraso segue registrado');
    assert.strictEqual(dia.minutosAbonados, 30);
});

test('atestado de horas não vira crédito além do necessário', () => {
    const dia = diaComTratativa({ tipo: 'atestado_horas', minutos_abonados: 120, motivo: 'consulta longa' });
    assert.strictEqual(dia.saldoMinutos, 0, 'abono generoso não gera saldo positivo artificial');
});

test('atestado de horas cobre SAÍDA ANTECIPADA, sem atraso na entrada', () => {
    // Caso mais comum do atestado de horas: chegou na hora, saiu 2h antes por consulta.
    // É o cenário que a tela de Atrasos não lista (não há atraso), por isso existe o
    // lançamento avulso — e o abono precisa fechar o saldo do dia.
    const dia = calc.montarRelatorioDia({
        funcionario: { id: 1, nome: 'T', emoji: 'T', regime: 'CLT', horas_diarias: '8h', tolerancia_almoco_min: 60, almoco_flexivel: 0, salario_base: null },
        dataISO: QUARTA,
        pontos: { ENTRADA: '08:00', ALMOCO_SAIDA: '12:00', ALMOCO_RETORNO: '13:00', SAIDA: '15:00' },
        justificativas: {},
        ehFeriado: false,
        percentuaisHorasExtras: PERCENTUAIS,
        jornadaPorGrupo: JORNADA_PADRAO,
        tratativa: { tipo: 'atestado_horas', minutos_abonados: 120, motivo: 'consulta às 15h' }
    });
    assert.strictEqual(dia.atrasoMinutos, 0, 'não houve atraso na entrada');
    assert.strictEqual(dia.saldoMinutos, 0, 'as 2h do atestado fecham o dia');
});

/* ===================== Validações das tratativas ===================== */

const tratativas = require('../src/services/tratativas.service');

test('tratativa em data futura é recusada', () => {
    assert.throws(
        () => tratativas.exigirDataNaoFutura('2026-12-31', '2026-07-30'),
        /data futura/
    );
});

test('tratativa em data passada ou de hoje é aceita', () => {
    assert.doesNotThrow(() => tratativas.exigirDataNaoFutura('2026-07-30', '2026-07-30'));
    assert.doesNotThrow(() => tratativas.exigirDataNaoFutura('2026-07-01', '2026-07-30'));
});

/* ===================== Limiar de pagamento da hora extra ===================== */

function diaComSaida(horaSaida, salario) {
    return calc.montarRelatorioDia({
        funcionario: { id: 1, nome: 'T', emoji: 'T', regime: 'CLT', horas_diarias: '8h', tolerancia_almoco_min: 60, almoco_flexivel: 0, salario_base: salario ?? null },
        dataISO: QUARTA,
        pontos: { ENTRADA: '08:00', ALMOCO_SAIDA: '12:00', ALMOCO_RETORNO: '13:00', SAIDA: horaSaida },
        justificativas: {},
        ehFeriado: false,
        percentuaisHorasExtras: PERCENTUAIS,
        jornadaPorGrupo: JORNADA_PADRAO
    });
}

test('extra de 7 min fica registrada mas não é paga', () => {
    const dia = diaComSaida('17:07', 2200);
    assert.strictEqual(dia.horas_extras.minutos, 7, 'os minutos continuam visiveis para acompanhar disciplina');
    assert.strictEqual(dia.horas_extras.tempo, '00:07');
    assert.strictEqual(dia.horas_extras.minutosPagos, 0, 'abaixo de 11 min nao vira dinheiro');
    assert.strictEqual(dia.horas_extras.valor, null);
    assert.strictEqual(dia.horas_extras.abaixoDoLimiar, true);
});

test('extra de exatamente 11 min já é paga', () => {
    const dia = diaComSaida('17:11', 2200);
    assert.strictEqual(dia.horas_extras.minutos, 11);
    assert.strictEqual(dia.horas_extras.minutosPagos, 11);
    assert.strictEqual(dia.horas_extras.abaixoDoLimiar, false);
    assert.ok(dia.horas_extras.valor > 0, 'gera valor em R$');
});

test('extra de 10 min ainda não é paga (limiar é "mais de 10")', () => {
    const dia = diaComSaida('17:10', 2200);
    assert.strictEqual(dia.horas_extras.minutos, 10);
    assert.strictEqual(dia.horas_extras.minutosPagos, 0);
    assert.strictEqual(dia.horas_extras.valor, null);
});

test('o saldo/banco de horas registra a extra curta mesmo sem pagamento', () => {
    const dia = diaComSaida('17:07');
    assert.strictEqual(dia.saldoMinutos, 7, 'os 7 min ficam no banco de horas; o que muda e so o pagamento');
});

/* ===================== Escala de sábado ===================== */

// Nesta jornada, sábado está como "não trabalha" — o caso do estagiário.
const JORNADA_SEM_SABADO = {
    ...JORNADA_PADRAO,
    sabado: { horario_entrada: '08:00', meta_minutos: 240, trabalha: false }
};

function diaDeSabado(escalado) {
    return calc.montarRelatorioDia({
        funcionario: { id: 1, nome: 'E', emoji: 'E', regime: 'ESTAGIARIO', horas_diarias: '6h', tolerancia_almoco_min: 60, almoco_flexivel: 0, salario_base: null },
        dataISO: SABADO,
        pontos: { ENTRADA: '08:00', SAIDA: '12:00' },
        justificativas: {},
        ehFeriado: false,
        percentuaisHorasExtras: PERCENTUAIS,
        jornadaPorGrupo: JORNADA_SEM_SABADO,
        escalado
    });
}

test('sábado SEM escala não tem meta nem horário combinado', () => {
    const dia = diaDeSabado(false);
    assert.strictEqual(dia.horario_combinado, '---', 'nao e dia de trabalho dessa pessoa');
    assert.strictEqual(dia.saldoMinutos, null, 'sem meta nao ha saldo: as 4h viram credito puro');
    assert.strictEqual(dia.horas_extras.minutos, 240);
    assert.strictEqual(dia.escalado, false);
});

test('sábado COM escala passa a valer a jornada de sábado', () => {
    const dia = diaDeSabado(true);
    assert.strictEqual(dia.horario_combinado, '08:00', 'a config do sabado passa a valer naquela data');
    assert.strictEqual(dia.saldoMinutos, 0, '4h trabalhadas contra meta de 4h');
    assert.strictEqual(dia.horas_extras.minutos, 0, 'dentro da meta nao ha extra');
    assert.strictEqual(dia.escalado, true);
});

test('sábado escalado: estagiário registra atraso mas não desconta', () => {
    const dia = calc.montarRelatorioDia({
        funcionario: { id: 1, nome: 'E', emoji: 'E', regime: 'ESTAGIARIO', horas_diarias: '6h', tolerancia_almoco_min: 60, almoco_flexivel: 0, salario_base: null },
        dataISO: SABADO,
        pontos: { ENTRADA: '08:20', SAIDA: '12:00' },
        justificativas: {},
        ehFeriado: false,
        percentuaisHorasExtras: PERCENTUAIS,
        jornadaPorGrupo: JORNADA_SEM_SABADO,
        escalado: true
    });
    assert.strictEqual(dia.atrasoMinutos, 20, 'o atraso aparece no relatorio');
    assert.strictEqual(dia.atrasoDescontavelMinutos, 0, 'estagiario nao tem obrigacao de sabado: nao desconta');
    assert.strictEqual(dia.saldoMinutos, 0, 'e o que ele trabalhou soma ao banco sem punicao');
});

test('sábado escalado: CLT registra atraso E desconta', () => {
    const dia = calc.montarRelatorioDia({
        funcionario: { id: 2, nome: 'C', emoji: 'C', regime: 'CLT', horas_diarias: '8h', tolerancia_almoco_min: 60, almoco_flexivel: 0, salario_base: null },
        dataISO: SABADO,
        pontos: { ENTRADA: '08:20', SAIDA: '12:00' },
        justificativas: {},
        ehFeriado: false,
        percentuaisHorasExtras: PERCENTUAIS,
        jornadaPorGrupo: JORNADA_SEM_SABADO,
        escalado: true
    });
    assert.strictEqual(dia.atrasoMinutos, 20);
    assert.strictEqual(dia.atrasoDescontavelMinutos, 20, 'escalado, o sabado e obrigacao do CLT');
    assert.strictEqual(dia.saldoMinutos, -20);
});

test('escala só aceita sábado ou domingo', async () => {
    const escala = require('../src/services/escalaDia.service');
    // QUARTA = 2026-07-22. Sem tocar no banco: a validação do dia da semana vem antes.
    await assert.rejects(
        () => escala.criar({ funcionario_id: 1, data: QUARTA }),
        /sábados e domingos/
    );
});

/* ===================== Escala de domingo ===================== */

test('domingo escalado não tem meta nem atraso, e é 100% de extra', () => {
    const dia = calc.montarRelatorioDia({
        funcionario: { id: 1, nome: 'D', emoji: 'D', regime: 'CLT', horas_diarias: '8h', tolerancia_almoco_min: 60, almoco_flexivel: 0, salario_base: 2200 },
        dataISO: DOMINGO,
        pontos: { ENTRADA: '10:00', SAIDA: '14:00' },
        justificativas: {},
        ehFeriado: false,
        percentuaisHorasExtras: PERCENTUAIS,
        jornadaPorGrupo: JORNADA_PADRAO,
        escalado: true
    });
    assert.strictEqual(dia.atrasoMinutos, 0, 'nao existe horario de entrada de domingo');
    assert.strictEqual(dia.horario_combinado, '---');
    assert.strictEqual(dia.horas_extras.tipo, 'domingo_feriado');
    assert.strictEqual(dia.horas_extras.minutos, 240, 'o dia inteiro e extra');
});

test('domingo escalado nunca desconta atraso, nem com almoço estourado', () => {
    const dia = calc.montarRelatorioDia({
        funcionario: { id: 1, nome: 'D', emoji: 'D', regime: 'CLT', horas_diarias: '8h', tolerancia_almoco_min: 60, almoco_flexivel: 0, salario_base: null },
        dataISO: DOMINGO,
        // almoço de 90 min: 30 acima do combinado, 29 acima da folga de 1
        pontos: { ENTRADA: '08:00', ALMOCO_SAIDA: '12:00', ALMOCO_RETORNO: '13:30', SAIDA: '17:00' },
        justificativas: {},
        ehFeriado: false,
        percentuaisHorasExtras: PERCENTUAIS,
        jornadaPorGrupo: JORNADA_PADRAO,
        escalado: true
    });
    assert.strictEqual(dia.atrasoMinutos, 29, 'o excesso de almoco continua sendo registrado');
    assert.strictEqual(dia.atrasoDescontavelMinutos, 0, 'mas domingo escalado nunca desconta');
});

test('a regra de desconto do atraso responde por dia e regime', () => {
    const casos = [
        { data: QUARTA,  regime: 'CLT',         escalado: false, esperado: true,  nota: 'dia normal' },
        { data: QUARTA,  regime: 'ESTAGIARIO',  escalado: false, esperado: true,  nota: 'dia normal' },
        { data: SABADO,  regime: 'CLT',         escalado: true,  esperado: true,  nota: 'CLT escalado no sabado' },
        { data: SABADO,  regime: 'ESTAGIARIO',  escalado: true,  esperado: false, nota: 'estagiario escalado no sabado' },
        { data: SABADO,  regime: 'PJ',          escalado: true,  esperado: false, nota: 'PJ escalado no sabado' },
        { data: DOMINGO, regime: 'CLT',         escalado: true,  esperado: false, nota: 'domingo escalado' }
    ];
    casos.forEach(({ data, regime, escalado, esperado, nota }) => {
        assert.strictEqual(calc.atrasoPodeDescontar(data, regime, escalado), esperado, nota);
    });
});

/* ===================== Horário de entrada livre ===================== */

test('quem não tem horário de entrada nunca gera atraso', () => {
    const base = {
        dataISO: QUARTA,
        pontos: { ENTRADA: '09:30', ALMOCO_SAIDA: '12:00', ALMOCO_RETORNO: '13:00', SAIDA: '17:00' },
        justificativas: {},
        ehFeriado: false,
        percentuaisHorasExtras: PERCENTUAIS,
        jornadaPorGrupo: JORNADA_PADRAO
    };
    const comHorario = calc.montarRelatorioDia({
        ...base,
        funcionario: { id: 1, nome: 'A', emoji: 'A', regime: 'CLT', horas_diarias: '8h', tolerancia_almoco_min: 60, almoco_flexivel: 0, salario_base: null, entrada_flexivel: 0 }
    });
    const semHorario = calc.montarRelatorioDia({
        ...base,
        funcionario: { id: 2, nome: 'B', emoji: 'B', regime: 'CLT', horas_diarias: '8h', tolerancia_almoco_min: 60, almoco_flexivel: 0, salario_base: null, entrada_flexivel: 1 }
    });

    assert.strictEqual(comHorario.atrasoMinutos, 90, 'entrou 1h30 depois das 08:00');
    assert.strictEqual(semHorario.atrasoMinutos, 0, 'sem horario combinado nao ha do que se atrasar');
    assert.strictEqual(semHorario.entradaFlexivel, true);
});

test('horário livre não elimina a meta: o saldo continua valendo', () => {
    const dia = calc.montarRelatorioDia({
        funcionario: { id: 2, nome: 'B', emoji: 'B', regime: 'CLT', horas_diarias: '8h', tolerancia_almoco_min: 60, almoco_flexivel: 0, salario_base: null, entrada_flexivel: 1 },
        dataISO: QUARTA,
        // 6h trabalhadas contra meta de 8h
        pontos: { ENTRADA: '10:00', ALMOCO_SAIDA: '13:00', ALMOCO_RETORNO: '14:00', SAIDA: '17:00' },
        justificativas: {},
        ehFeriado: false,
        percentuaisHorasExtras: PERCENTUAIS,
        jornadaPorGrupo: JORNADA_PADRAO
    });
    assert.strictEqual(dia.atrasoMinutos, 0);
    assert.strictEqual(dia.saldoMinutos, -120, 'faltaram 2h para fechar a jornada do dia');
});

/* ===================== Vigência da jornada ===================== */

test('a jornada de um dia usa a versão vigente NAQUELE dia', () => {
    const { jornadaVigenteEm } = require('../src/services/funcionarios.service');
    const versoes = {
        quarta: [
            { vigencia_inicio: '2026-08-01', horario_entrada: '08:00', meta_minutos: 480, trabalha: true },
            { vigencia_inicio: '0001-01-01', horario_entrada: '13:00', meta_minutos: 480, trabalha: true }
        ]
    };
    assert.strictEqual(jornadaVigenteEm(versoes, '2026-07-22').quarta.horario_entrada, '13:00', 'antes da troca');
    assert.strictEqual(jornadaVigenteEm(versoes, '2026-08-05').quarta.horario_entrada, '08:00', 'depois da troca');
});

test('trocar de turno não reescreve o atraso dos dias anteriores', () => {
    const { jornadaVigenteEm } = require('../src/services/funcionarios.service');
    // Cenário real: pessoa do turno da tarde (13:00) entrou 13:20 num dia — atraso de 20 min.
    // Depois o turno dela mudou para 08:00. Sem vigência, aquele dia virava 5h20 de atraso.
    const versoes = {
        quarta: [
            { vigencia_inicio: '2026-08-01', horario_entrada: '08:00', meta_minutos: 480, trabalha: true },
            { vigencia_inicio: '0001-01-01', horario_entrada: '13:00', meta_minutos: 480, trabalha: true }
        ]
    };
    const f = { id: 1, nome: 'T', emoji: 'T', regime: 'CLT', horas_diarias: '8h', tolerancia_almoco_min: 60, almoco_flexivel: 0, salario_base: null };
    const pontos = { ENTRADA: '13:20', ALMOCO_SAIDA: '17:00', ALMOCO_RETORNO: '18:00', SAIDA: '22:00' };

    const diaAntigo = calc.montarRelatorioDia({
        funcionario: f, dataISO: QUARTA, pontos, justificativas: {}, ehFeriado: false,
        percentuaisHorasExtras: PERCENTUAIS,
        jornadaPorGrupo: jornadaVigenteEm(versoes, QUARTA)
    });
    assert.strictEqual(diaAntigo.atrasoMinutos, 20, 'o dia antigo mantem o atraso que sempre teve');
});

test('data anterior à primeira vigência cai na versão mais antiga', () => {
    const { jornadaVigenteEm } = require('../src/services/funcionarios.service');
    const versoes = {
        quarta: [{ vigencia_inicio: '2026-08-01', horario_entrada: '08:00', meta_minutos: 480, trabalha: true }]
    };
    // Não pode devolver vazio: isso transformaria em falta todo dia anterior ao cadastro.
    assert.strictEqual(jornadaVigenteEm(versoes, '2026-01-10').quarta.horario_entrada, '08:00');
});

test('o tipo do dia sai da data, igual no calendário e no backend', () => {
    const escala = require('../src/services/escalaDia.service');
    assert.strictEqual(escala.tipoDoDia(SABADO), 'sabado');
    assert.strictEqual(escala.tipoDoDia(DOMINGO), 'domingo');
    assert.strictEqual(escala.tipoDoDia(QUARTA), null, 'dia de semana nao e escalavel');
});
