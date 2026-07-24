const { Hono } = require('hono');
const app = new Hono();

const feriadosService = require('../services/feriados.service');
const { exigirAutorizacaoAdmin } = require('../middleware/adminAuth');
const { exigirData, exigirTexto, exigirInteiro } = require('../utils/validacao');

app.get('/', async (c) => {
    return c.json(await feriadosService.listar());
});

app.post('/', exigirAutorizacaoAdmin, async (c) => {
    const body = await c.req.json();
    const data = exigirData(body.data, 'data');
    const nome = exigirTexto(body.nome, 'nome', { maxLen: 120 });
    const abrangencia = body.abrangencia || 'empresa';
    const exige_compensacao = !!body.exige_compensacao;
    const criado = await feriadosService.criar({ data, nome, abrangencia, exige_compensacao });
    return c.json(criado, 201);
});

app.delete('/:id', exigirAutorizacaoAdmin, async (c) => {
    const id = exigirInteiro(c.req.param('id'), 'id');
    await feriadosService.remover(id);
    return c.json({ message: 'Feriado removido.' });
});

module.exports = app;
