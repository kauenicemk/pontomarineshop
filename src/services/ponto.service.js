const db = require('../db/db');
const { agoraBrasilia, paraMinutos, grupoDoDia } = require('../utils/tempo');
const { registrarAuditoria } = require('../utils/auditoria');

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

/** Quem está presente agora e quem ainda não bateu ponto hoje. */
async function pendenciasDoDia() {
    const { data: hojeISO } = agoraBrasilia();
    const agora = new Date();
    const horaAtualMin = paraMinutos(
        new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(agora)
    );

    const funcionarios = await db.all(
        `SELECT id, emoji, nome FROM funcionarios WHERE ativo = 1 ORDER BY nome ASC`
    );

    const registrosHoje = await db.all(
        `SELECT funcionario_id, tipo, hora FROM registro_ponto WHERE data = ? ORDER BY data_hora_iso ASC`,
        [hojeISO]
    );

    // Quem tem ausência justificada HOJE (férias, atestado, licença, folga) não pode
    // aparecer como "ainda não chegou" nem virar "atrasado" no dashboard.
    const ausentesHoje = await db.all(
        `SELECT funcionario_id FROM ausencias WHERE data = ?`,
        [hojeISO]
    );
    const ausentesSet = new Set(ausentesHoje.map((a) => a.funcionario_id));

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

    funcionarios.forEach((f) => {
        const p = pontosPorFuncionario[f.id];

        if (p && p.ENTRADA && !p.SAIDA) {
            let status = 'Trabalhando';
            let desde = p.ENTRADA;
            if (p.ALMOCO_SAIDA && !p.ALMOCO_RETORNO) { status = 'Em Almoço'; desde = p.ALMOCO_SAIDA; }
            else if (p.ALMOCO_RETORNO) { desde = p.ALMOCO_RETORNO; }
            presentesAgora.push({ nome: f.nome, emoji: f.emoji, status, desde });
        }

        if (!p || !p.ENTRADA) {
            if (ausentesSet.has(f.id)) return; // ausência justificada hoje (férias, atestado...) — não é pendência
            const cfgHoje = jornadaHojePorFuncionario[f.id];
            if (!cfgHoje || !cfgHoje.trabalha) return; // hoje não é dia de trabalho pra essa pessoa (ex: sábado sem expediente)
            const minCombinado = paraMinutos(cfgHoje.horario_entrada || '08:00');
            const atrasado = horaAtualMin > minCombinado + 10;
            naoChegaram.push({ nome: f.nome, emoji: f.emoji, horario_combinado: cfgHoje.horario_entrada, atrasado });
        }
    });

    naoChegaram.sort((a, b) => Number(b.atrasado) - Number(a.atrasado));
    return { presentesAgora, naoChegaram };
}

module.exports = {
    registrarPonto,
    ajustarPontoManual,
    historicoIndividual,
    historicoGeral,
    pendenciasDoDia
};
