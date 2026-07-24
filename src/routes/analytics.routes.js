const { Hono } = require('hono');
const app = new Hono();

const analyticsService = require('../services/analytics.service');
const { exigirAutorizacaoAdmin } = require('../middleware/adminAuth');
const { exigirData } = require('../utils/validacao');

app.get('/indicadores', exigirAutorizacaoAdmin, async (c) => {
    const inicio = exigirData(c.req.query('inicio'), 'inicio');
    const fim = exigirData(c.req.query('fim'), 'fim');
    return c.json(await analyticsService.indicadoresGerais({ dataInicio: inicio, dataFim: fim }));
});

module.exports = app;
