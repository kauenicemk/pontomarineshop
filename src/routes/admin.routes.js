const { Hono } = require('hono');
const app = new Hono();

const db = require('../db/db');
const { exigirAutorizacaoAdmin } = require('../middleware/adminAuth');
const { registrarAuditoria, listarAuditoria, listarAcoesDisponiveis } = require('../utils/auditoria');

// Log de auditoria — quem alterou o quê, quando e de onde.
app.get('/auditoria', exigirAutorizacaoAdmin, async (c) => {
    const q = c.req.query();
    return c.json(await listarAuditoria({
        dataInicio: q.inicio || null,
        dataFim: q.fim || null,
        adminId: q.admin_id ? Number(q.admin_id) : null,
        acao: q.acao || null,
        limite: q.limite ? Number(q.limite) : 200,
        offset: q.offset ? Number(q.offset) : 0
    }));
});

app.get('/auditoria/acoes', exigirAutorizacaoAdmin, async (c) => {
    return c.json(await listarAcoesDisponiveis());
});

// Percentuais de hora extra configuráveis (60% em dia útil, 100% em domingo/feriado, etc — ver
// src/services/calculoJornada.service.js pra onde isso é aplicado no cálculo).
app.get('/horas-extras/config', exigirAutorizacaoAdmin, async (c) => {
    return c.json(await db.all(`SELECT tipo, percentual FROM config_horas_extras ORDER BY tipo`));
});

app.post('/horas-extras/config', exigirAutorizacaoAdmin, async (c) => {
    const { tipo, percentual } = await c.req.json();
    if (!['dia_util', 'domingo_feriado', 'adicional_noturno'].includes(tipo)) {
        return c.json({ message: 'Tipo inválido.' }, 400);
    }
    const p = Number(percentual);
    if (Number.isNaN(p) || p < 0 || p > 5) {
        return c.json({ message: 'Percentual inválido.' }, 400);
    }
    await db.run(
        `INSERT INTO config_horas_extras (tipo, percentual) VALUES (?, ?)
         ON CONFLICT(tipo) DO UPDATE SET percentual = excluded.percentual`,
        [tipo, p]
    );
    await registrarAuditoria('atualizar_percentual_hora_extra', 'config_horas_extras', null, { tipo, percentual: p });
    return c.json({ message: 'Percentual atualizado com sucesso!' });
});

/**
 * ZONA DE PERIGO — apaga TODOS os funcionários e os dados vinculados a eles
 * (registros de ponto, jornadas, ausências, férias, biometria, confirmações de espelho).
 * Pensado pra limpar dados de teste antes de começar o uso real.
 *
 * O que NÃO é apagado: contas de administrador, senha do totem, feriados,
 * percentuais de hora extra e o log de auditoria (a própria limpeza fica registrada).
 *
 * Exige a palavra de confirmação "ZERAR" no corpo — impossível chamar por engano.
 */
app.post('/zerar-dados', exigirAutorizacaoAdmin, async (c) => {
    const { confirmacao } = await c.req.json();
    if (confirmacao !== 'ZERAR') {
        return c.json({ message: 'Confirmação inválida. Digite exatamente ZERAR para apagar os dados.' }, 400);
    }

    const contagem = await db.get(`SELECT COUNT(*) as total FROM funcionarios`);

    // Filhas primeiro (respeita as foreign keys), funcionários por último.
    await db.run(`DELETE FROM biometria_facial`);
    await db.run(`DELETE FROM espelho_confirmacoes`);
    await db.run(`DELETE FROM registro_ponto`);
    await db.run(`DELETE FROM ausencias`);
    await db.run(`DELETE FROM ferias`);
    await db.run(`DELETE FROM jornada_funcionario`);
    await db.run(`DELETE FROM funcionarios`);

    const admin = c.get('admin');
    await registrarAuditoria('zerar_dados', 'sistema', null, {
        funcionarios_apagados: contagem.total,
        admin_id: admin ? admin.id : null,
        admin_nome: admin ? admin.nome : null
    });

    return c.json({ message: `Dados zerados: ${contagem.total} funcionário(s) e todo o histórico vinculado foram apagados.` });
});

module.exports = app;
