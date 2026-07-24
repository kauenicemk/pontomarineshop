const { Hono } = require('hono');
const app = new Hono();

const db = require('../db/db');
const { exigirAutorizacaoAdmin } = require('../middleware/adminAuth');
const { registrarAuditoria } = require('../utils/auditoria');

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

module.exports = app;
