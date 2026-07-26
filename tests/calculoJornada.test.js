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

test('atraso de entrada é a diferença para o horário combinado', () => {
    const pontos = { ...diaCompleto, ENTRADA: '08:12' };
    assert.strictEqual(calc.calcularAtrasoEntradaMinutos(pontos, QUARTA, JORNADA_PADRAO), 12);
});

test('chegar adiantado não gera atraso negativo', () => {
    const pontos = { ...diaCompleto, ENTRADA: '07:40' };
    assert.strictEqual(calc.calcularAtrasoEntradaMinutos(pontos, QUARTA, JORNADA_PADRAO), 0);
});

test('dia sem expediente configurado não gera atraso', () => {
    assert.strictEqual(calc.calcularAtrasoEntradaMinutos(diaCompleto, SABADO, JORNADA_PADRAO), 0);
});

test('almoço mais longo que a tolerância vira atraso', () => {
    const pontos = { ...diaCompleto, ALMOCO_RETORNO: '13:20' }; // 80 min de almoço
    assert.strictEqual(calc.calcularAtrasoAlmocoMinutos(pontos, 60, false), 20);
});

test('almoço flexível nunca gera atraso', () => {
    const pontos = { ...diaCompleto, ALMOCO_RETORNO: '14:30' };
    assert.strictEqual(calc.calcularAtrasoAlmocoMinutos(pontos, 60, true), 0);
});

/* ===================== Tolerância de 10 minutos no saldo ===================== */

test('atraso de até 10 minutos NÃO deixa o dia negativo', () => {
    for (const atraso of [1, 5, 10]) {
        const saldo = calc.calcularSaldoMinutos(480 - atraso, 480, diaCompleto, atraso);
        assert.strictEqual(saldo, 0, `atraso de ${atraso} min deveria manter o saldo em zero`);
    }
});

test('atraso acima de 10 minutos desconta INTEGRALMENTE, não só o excedente', () => {
    assert.strictEqual(calc.calcularSaldoMinutos(468, 480, diaCompleto, 12), -12);
    assert.strictEqual(calc.calcularSaldoMinutos(450, 480, diaCompleto, 30), -30);
});

test('tolerância não vira brecha para sair mais cedo', () => {
    // Atrasou 8 min (tolerado) mas saiu 30 min antes: perdoa só os 8 do atraso.
    assert.strictEqual(calc.calcularSaldoMinutos(450, 480, diaCompleto, 8), -22);
});

test('tolerância não cria crédito quando o saldo já é positivo', () => {
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

test('relatório do dia junta atraso tolerado e saldo preservado', () => {
    const dia = calc.montarRelatorioDia({
        funcionario: { id: 1, nome: 'Teste', emoji: 'T', regime: 'CLT', horas_diarias: '8h', tolerancia_almoco_min: 60, almoco_flexivel: 0, salario_base: null },
        dataISO: QUARTA,
        pontos: { ENTRADA: '08:08', ALMOCO_SAIDA: '12:00', ALMOCO_RETORNO: '13:00', SAIDA: '17:00' },
        justificativas: {},
        ehFeriado: false,
        percentuaisHorasExtras: PERCENTUAIS,
        jornadaPorGrupo: JORNADA_PADRAO
    });

    assert.strictEqual(dia.atrasoMinutos, 8, 'o atraso continua sendo contabilizado');
    assert.strictEqual(dia.atraso, '00:08');
    assert.strictEqual(dia.saldoMinutos, 0, 'mas o saldo do dia não fica negativo');
    assert.strictEqual(dia.atrasoToleradoNoSaldo, true);
});

test('relatório do dia desconta atraso acima da tolerância', () => {
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
    assert.strictEqual(dia.saldoMinutos, -25);
    assert.strictEqual(dia.atrasoToleradoNoSaldo, false);
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
