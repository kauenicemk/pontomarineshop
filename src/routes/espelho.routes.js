const { Hono } = require('hono');
const app = new Hono();

const espelhoService = require('../services/espelho.service');
const { exigirTotem } = require('../middleware/totemAuth');
const { verificarToken } = require('../utils/jwtAuth');
const { exigirInteiro, exigirMesReferencia } = require('../utils/validacao');

/**
 * A consulta da confirmação é usada em DOIS contextos: pelo funcionário no totem
 * (token do totem) e pelo administrador vendo o espelho de alguém no painel remoto
 * (token de admin). Antes só o totem era aceito — o que quebrava o botão
 * "Ver/Imprimir Espelho" do painel administrativo.
 */
async function exigirTotemOuAdmin(c, next) {
    const totemToken = c.req.header('x-totem-token') || '';
    const header = c.req.header('authorization') || '';
    const adminToken = header.startsWith('Bearer ') ? header.slice(7) : null;

    for (const [token, tipo] of [[totemToken, 'totem'], [adminToken, 'admin']]) {
        if (!token) continue;
        try {
            const payload = await verificarToken(token, c.env);
            if (payload.tipo === tipo) return next();
        } catch (_) { /* tenta o próximo */ }
    }
    return c.json({ message: 'Acesso restrito. Faça login como administrador ou configure o totem.' }, 401);
}

app.get('/confirmacao/:funcionarioId', exigirTotemOuAdmin, async (c) => {
    const id = exigirInteiro(c.req.param('funcionarioId'), 'funcionarioId');
    const mes = exigirMesReferencia(c.req.query('mes'), 'mes');
    return c.json(await espelhoService.buscarConfirmacao(id, mes));
});

// A CONFIRMAÇÃO em si continua exclusiva do totem: é o próprio funcionário, no tablet
// físico da empresa, quem declara que revisou o espelho — nunca alguém remoto por ele.
app.post('/confirmar', exigirTotem, async (c) => {
    const body = await c.req.json();
    const funcionario_id = exigirInteiro(body.funcionario_id, 'funcionario_id');
    const mes_referencia = exigirMesReferencia(body.mes_referencia, 'mes_referencia');
    return c.json(await espelhoService.confirmarLeitura(funcionario_id, mes_referencia));
});

module.exports = app;
