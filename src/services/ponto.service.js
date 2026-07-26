const db = require('../db/db');
const { agoraBrasilia, paraMinutos, grupoDoDia } = require('../utils/tempo');
const { registrarAuditoria } = require('../utils/auditoria');

// Minutos de carência antes de alguém que não bateu ponto ser destacado como ATRASADO
// na tela de Pendências. É só a régua do alerta visual — não interfere no cálculo de
// atraso do relatório (esse usa a regra da CLT/config, com a tolerância de 10 minutos).
const TOLERANCIA_ATRASO_PENDENCIA_MIN = 10;

/**
 * Valida a sequência lógica das batidas do dia ANTES de gravar — impede registro duplicado
 * (duas Entradas) e fora de ordem (Retorno sem Saída Almoço, Saída Final sem Entrada...).
 * O ajuste manual do administrador NÃO passa por aqui de propósito: ele existe justamente
 * pra corrigir qualquer situação, com justificativa e trilha de auditoria.
 */
function validarSequenciaDoDia(tiposJaBatidos, tipoNovo) {
    const ja = new Set(tiposJaBatidos);

    if (ja.has(tipoNovo)) {
        return `Você já registrou "${tipoNovo}" hoje. Se precisar corrigir um horário, fale com o administrador.`;
    }
    if (ja.has('Saída Final')) {
        return 'Você já encerrou o expediente de hoje. Correções só via ajuste manual do administrador.';
    }
    if (tipoNovo === 'Saída Almoço' && !ja.has('Entrada')) {
        return 'Registre a Entrada antes da Saída para o Almoço.';
    }
    if (tipoNovo === 'Retorno Almoço' && !ja.has('Saída Almoço')) {
        return 'Registre a Saída Almoço antes do Retorno.';
    }
    if (tipoNovo === 'Saída Final' && !ja.has('Entrada')) {
        return 'Registre a Entrada antes da Saída Final.';
    }
    if (tipoNovo === 'Saída Final' && ja.has('Saída Almoço') && !ja.has('Retorno Almoço')) {
        return 'Você ainda está em intervalo — registre o Retorno Almoço antes da Saída Final.';
    }
    return null;
}

/** Registra uma batida de ponto "ao vivo" (sem PIN — fluxo aberto pedido pelo cliente, uso presencial supervisionado). */
async function registrarPonto(funcionarioId, tipo) {
    const funcionario = await db.get(`SELECT id, nome, emoji FROM funcionarios WHERE id = ? AND ativo = 1`, [funcionarioId]);
    if (!funcionario) {
        const erro = new Error('Selecione um funcionário válido!');
        erro.status = 404;
        throw erro;
    }

    const { data, hora, iso } = agoraBrasilia();

    const registrosHoje = await db.all(
        `SELECT tipo FROM registro_ponto WHERE funcionario_id = ? AND data = ?`,
        [funcionario.id, data]
    );
    const problema = validarSequenciaDoDia(registrosHoje.map((r) => r.tipo), tipo);
    if (problema) {
        const erro = new Error(problema);
        erro.status = 409;
        throw erro;
    }
    const { lastID } = await db.run(
        `INSERT INTO registro_ponto (funcionario_id, data, hora, data_hora_iso, tipo) VALUES (?, ?, ?, ?, ?)`,
        [funcionario.id, data, hora, iso, tipo]
    );

    return {
        id: lastID,
        nome: funcionario.nome,
        emoji: funcionario.emoji,
        tipo,
        data,
        hora
    };
}

/** Ajuste manual — exige login de administrador (ver adminAuth) e fica auditado COM o autor. */
async function ajustarPontoManual({ funcionario_id, data, hora, tipo, justificativa, admin }) {
    const funcionario = await db.get(`SELECT id FROM funcionarios WHERE id = ?`, [funcionario_id]);
    if (!funcionario) {
        const erro = new Error('Funcionário não encontrado.');
        erro.status = 404;
        throw erro;
    }

    const iso = `${data}T${hora}:00`;
    const { lastID } = await db.run(
        `INSERT INTO registro_ponto (funcionario_id, data, hora, data_hora_iso, tipo, justificativa, ajuste_manual)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [funcionario_id, data, `${hora}:00`, iso, tipo, justificativa]
    );

    await registrarAuditoria('ajuste_manual', 'registro_ponto', lastID, {
        funcionario_id, data, hora, tipo, justificativa,
        admin_id: admin ? admin.id : null, admin_nome: admin ? admin.nome : null
    });
    return { id: lastID };
}

async function historicoIndividual(funcionarioId) {
    const funcionario = await db.get(
        `SELECT id, nome, emoji, regime, horas_diarias FROM funcionarios WHERE id = ?`,
        [funcionarioId]
    );
    if (!funcionario) return null;

    const registros = await db.all(
        `SELECT data, hora, tipo, justificativa FROM registro_ponto WHERE funcionario_id = ? ORDER BY data_hora_iso DESC`,
        [funcionario.id]
    );
    return { funcionario, registros };
}

/** Histórico geral já filtrado por período no SQL (antes era baixado tudo e filtrado no navegador). */
async function historicoGeral({ dataInicio, dataFim } = {}) {
    const condicoes = [];
    const params = [];
    if (dataInicio) { condicoes.push('r.data >= ?'); params.push(dataInicio); }
    if (dataFim) { condicoes.push('r.data <= ?'); params.push(dataFim); }
    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

    return db.all(
        `SELECT r.id, r.tipo, r.data, r.hora, f.nome, f.emoji
         FROM registro_ponto r
         JOIN funcionarios f ON r.funcionario_id = f.id
         ${where}
         ORDER BY r.data_hora_iso ASC`,
        params
    );
}

/**
 * Retrato da situação do time AGORA, usado na tela de Pendências e no dashboard.
 * Devolve todo mundo classificado, para o gestor bater o olho e entender o dia:
 *
 *   presentesAgora  — quem está com expediente aberto (trabalhando ou em intervalo)
 *   naoChegaram     — deveria ter chegado e ainda não bateu (com os minutos de atraso)
 *   encerraram      — já bateu a saída final hoje
 *   ausentesHoje    — tem ausência justificada (férias, atestado, licença, folga)
 *   semExpediente   — hoje não é dia de trabalho dessa pessoa (folga da escala)
 */
async function pendenciasDoDia() {
    const { data: hojeISO } = agoraBrasilia();
    const horaAtual = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(new Date());
    const horaAtualMin = paraMinutos(horaAtual);

    const funcionarios = await db.all(
        `SELECT id, emoji, nome FROM funcionarios WHERE ativo = 1 ORDER BY nome ASC`
    );

    const registrosHoje = await db.all(
        `SELECT funcionario_id, tipo, hora FROM registro_ponto WHERE data = ? ORDER BY data_hora_iso ASC`,
        [hojeISO]
    );

    // Ausência justificada hoje (férias, atestado, licença, folga) não é pendência —
    // aparece em uma lista própria, com o motivo.
    const ausencias = await db.all(
        `SELECT funcionario_id, tipo, justificativa FROM ausencias WHERE data = ?`,
        [hojeISO]
    );
    const ausenciaPorFuncionario = {};
    ausencias.forEach((a) => { ausenciaPorFuncionario[a.funcionario_id] = a; });

    // Jornada configurada para o dia da semana de HOJE (segunda..sábado) de cada funcionário.
    const grupoHoje = grupoDoDia(hojeISO);
    const jornadaHojePorFuncionario = {};
    if (grupoHoje) {
        const linhasJornada = await db.all(
            `SELECT funcionario_id, horario_entrada, trabalha FROM jornada_funcionario WHERE grupo_dia = ?`,
            [grupoHoje]
        );
        linhasJornada.forEach((l) => { jornadaHojePorFuncionario[l.funcionario_id] = l; });
    }

    const { TIPO_PARA_CHAVE } = require('../utils/tempo');
    const pontosPorFuncionario = {};
    registrosHoje.forEach((r) => {
        if (!pontosPorFuncionario[r.funcionario_id]) pontosPorFuncionario[r.funcionario_id] = {};
        pontosPorFuncionario[r.funcionario_id][TIPO_PARA_CHAVE[r.tipo]] = r.hora.substring(0, 5);
    });

    const presentesAgora = [];
    const naoChegaram = [];
    const encerraram = [];
    const ausentesHoje = [];
    const semExpediente = [];

    funcionarios.forEach((f) => {
        const p = pontosPorFuncionario[f.id] || {};
        const cfgHoje = jornadaHojePorFuncionario[f.id];
        const horarioPrevisto = cfgHoje && cfgHoje.trabalha ? cfgHoje.horario_entrada : null;
        const base = { funcionario_id: f.id, nome: f.nome, emoji: f.emoji, horario_combinado: horarioPrevisto };

        // 1) Expediente aberto: bateu entrada e ainda não bateu a saída final
        if (p.ENTRADA && !p.SAIDA) {
            let status = 'Trabalhando';
            let desde = p.ENTRADA;
            if (p.ALMOCO_SAIDA && !p.ALMOCO_RETORNO) { status = 'Em Almoço'; desde = p.ALMOCO_SAIDA; }
            else if (p.ALMOCO_RETORNO) { desde = p.ALMOCO_RETORNO; }

            const atrasoEntrada = horarioPrevisto
                ? Math.max(0, paraMinutos(p.ENTRADA) - paraMinutos(horarioPrevisto))
                : 0;

            presentesAgora.push({
                ...base,
                status,
                desde,
                entrada: p.ENTRADA,
                minutosDesde: Math.max(0, horaAtualMin - paraMinutos(desde)),
                chegouAtrasado: atrasoEntrada > 0,
                minutosAtrasoEntrada: atrasoEntrada
            });
            return;
        }

        // 2) Já encerrou o expediente hoje
        if (p.ENTRADA && p.SAIDA) {
            encerraram.push({ ...base, entrada: p.ENTRADA, saida: p.SAIDA });
            return;
        }

        // 3) Ausência justificada
        const ausencia = ausenciaPorFuncionario[f.id];
        if (ausencia) {
            ausentesHoje.push({ ...base, tipo: ausencia.tipo, justificativa: ausencia.justificativa });
            return;
        }

        // 4) Hoje não é dia de trabalho dessa pessoa (folga da escala / domingo)
        if (!cfgHoje || !cfgHoje.trabalha) {
            semExpediente.push({ ...base });
            return;
        }

        // 5) Deveria ter chegado e ainda não bateu ponto
        const minCombinado = paraMinutos(horarioPrevisto || '08:00');
        const minutosAtraso = Math.max(0, horaAtualMin - minCombinado);
        naoChegaram.push({
            ...base,
            atrasado: minutosAtraso > TOLERANCIA_ATRASO_PENDENCIA_MIN,
            minutosAtraso,
            minutosParaEntrada: Math.max(0, minCombinado - horaAtualMin)
        });
    });

    // Mais atrasados primeiro; entre os que ainda estão no horário, quem entra antes primeiro.
    naoChegaram.sort((a, b) => b.minutosAtraso - a.minutosAtraso || a.minutosParaEntrada - b.minutosParaEntrada);
    presentesAgora.sort((a, b) => (a.desde || '').localeCompare(b.desde || ''));
    encerraram.sort((a, b) => (b.saida || '').localeCompare(a.saida || ''));

    return {
        horaAtual,
        data: hojeISO,
        totalAtivos: funcionarios.length,
        presentesAgora,
        naoChegaram,
        encerraram,
        ausentesHoje,
        semExpediente
    };
}

module.exports = {
    registrarPonto,
    ajustarPontoManual,
    historicoIndividual,
    historicoGeral,
    pendenciasDoDia
};
