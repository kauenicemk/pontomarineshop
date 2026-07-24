const { Hono } = require('hono');
const app = new Hono();

const espelhoService = require('../services/espelho.service');
const { exigirTotem } = require('../middleware/totemAuth');
const { exigirInteiro, exigirMesReferencia } = require('../utils/validacao');

// O funcionário confirma a leitura do PRÓPRIO espelho, no totem — exige token do totem
// (não é mais alcançável de fora da empresa).
app.get('/confirmacao/:funcionarioId', exigirTotem, async (c) => {
    const id = exigirInteiro(c.req.param('funcionarioId'), 'funcionarioId');
    const mes = exigirMesReferencia(c.req.query('mes'), 'mes');
    return c.json(await espelhoService.buscarConfirmacao(id, mes));
});

app.post('/confirmar', exigirTotem, async (c) => {
    const body = await c.req.json();
    const funcionario_id = exigirInteiro(body.funcionario_id, 'funcionario_id');
    const mes_referencia = exigirMesReferencia(body.mes_referencia, 'mes_referencia');
    return c.json(await espelhoService.confirmarLeitura(funcionario_id, mes_referencia));
});

module.exports = app;
