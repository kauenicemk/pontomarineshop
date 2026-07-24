const { Hono } = require('hono');
const app = new Hono();

const ausenciasService = require('../services/ausencias.service');
const { exigirAutorizacaoAdmin } = require('../middleware/adminAuth');
const { exigirData, exigirInteiro, exigirTexto } = require('../utils/validacao');

// Calcula faltas (dias úteis sem entrada e sem justificativa) em um período.
app.get('/faltas', exigirAutorizacaoAdmin, async (c) => {
    const dataInicio = exigirData(c.req.query('inicio'), 'inicio');
    const dataFim = exigirData(c.req.query('fim'), 'fim');
    return c.json(await ausenciasService.calcularFaltas({ dataInicio, dataFim }));
});

// Justifica uma ausência específica (atestado, férias, licença, folga).
app.post('/', exigirAutorizacaoAdmin, async (c) => {
    const body = await c.req.json();
    const funcionario_id = exigirInteiro(body.funcionario_id, 'funcionario_id');
    const data = exigirData(body.data, 'data');
    const tipo = body.tipo;
    if (!['atestado', 'ferias', 'licenca', 'folga', 'sem_justificativa'].includes(tipo)) {
        return c.json({ message: 'Tipo de ausência inválido.' }, 400);
    }
    const justificativa = body.justificativa ? exigirTexto(body.justificativa, 'justificativa', { maxLen: 300 }) : null;
    const criado = await ausenciasService.justificar({ funcionario_id, data, tipo, justificativa });
    return c.json(criado, 201);
});

app.delete('/:id', exigirAutorizacaoAdmin, async (c) => {
    const id = exigirInteiro(c.req.param('id'), 'id');
    await ausenciasService.remover(id);
    return c.json({ message: 'Justificativa removida.' });
});

module.exports = app;
