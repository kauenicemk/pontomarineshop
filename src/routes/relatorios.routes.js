const { Hono } = require('hono');
const app = new Hono();

const relatorioService = require('../services/relatorio.service');
const { exigirAutorizacaoAdmin } = require('../middleware/adminAuth');
const { exigirTotem } = require('../middleware/totemAuth');
const { exigirData, exigirInteiro } = require('../utils/validacao');

app.get('/relatorio-calculado', exigirAutorizacaoAdmin, async (c) => {
    const inicio = c.req.query('inicio');
    const fim = c.req.query('fim');
    if (inicio) exigirData(inicio, 'inicio');
    if (fim) exigirData(fim, 'fim');
    return c.json(await relatorioService.relatorioCalculado({ dataInicio: inicio, dataFim: fim }));
});

// Relatório individual agregado: saldo total, atrasos, horas extras, horas noturnas e faltas
// de UM funcionário num período — pensado pra RH conferir a pessoa sem somar linha por linha.
app.get('/relatorio-individual/:id', exigirAutorizacaoAdmin, async (c) => {
    const id = exigirInteiro(c.req.param('id'), 'id');
    const inicio = exigirData(c.req.query('inicio'), 'inicio');
    const fim = exigirData(c.req.query('fim'), 'fim');

    const relatorio = await relatorioService.relatorioIndividual(id, { dataInicio: inicio, dataFim: fim });
    if (!relatorio) return c.json({ message: 'Funcionário não encontrado.' }, 404);
    return c.json(relatorio);
});

// Mesmo relatório, mas com token do totem (não senha de admin) — pro próprio funcionário ver
// e confirmar o espelho dele mesmo, no tablet físico. Mesmo padrão de /meu-historico/:id.
app.get('/meu-relatorio/:id', exigirTotem, async (c) => {
    const id = exigirInteiro(c.req.param('id'), 'id');
    const inicio = exigirData(c.req.query('inicio'), 'inicio');
    const fim = exigirData(c.req.query('fim'), 'fim');

    const relatorio = await relatorioService.relatorioIndividual(id, { dataInicio: inicio, dataFim: fim });
    if (!relatorio) return c.json({ message: 'Funcionário não encontrado.' }, 404);
    return c.json(relatorio);
});

module.exports = app;
