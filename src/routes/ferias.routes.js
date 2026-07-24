const { Hono } = require('hono');
const app = new Hono();

const feriasService = require('../services/ferias.service');
const { exigirAutorizacaoAdmin } = require('../middleware/adminAuth');
const { exigirInteiro, exigirData, exigirTextoOpcional } = require('../utils/validacao');

app.get('/', exigirAutorizacaoAdmin, async (c) => {
    return c.json(await feriasService.listar());
});

app.get('/agora', exigirAutorizacaoAdmin, async (c) => {
    return c.json(await feriasService.quemEstaDeFeriasAgora());
});

app.get('/funcionario/:id', exigirAutorizacaoAdmin, async (c) => {
    const id = exigirInteiro(c.req.param('id'), 'id');
    return c.json(await feriasService.listarPorFuncionario(id));
});

app.post('/', exigirAutorizacaoAdmin, async (c) => {
    const body = await c.req.json();
    const funcionario_id = exigirInteiro(body.funcionario_id, 'funcionario_id');
    const data_inicio = exigirData(body.data_inicio, 'data_inicio');
    const data_fim = exigirData(body.data_fim, 'data_fim');
    const observacao = exigirTextoOpcional(body.observacao, 'observacao', { maxLen: 300 });

    const criado = await feriasService.criar({ funcionario_id, data_inicio, data_fim, observacao });
    return c.json(criado, 201);
});

app.delete('/:id', exigirAutorizacaoAdmin, async (c) => {
    const id = exigirInteiro(c.req.param('id'), 'id');
    await feriasService.remover(id);
    return c.json({ message: 'Período de férias removido.' });
});

module.exports = app;
