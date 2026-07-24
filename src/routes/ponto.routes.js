const { Hono } = require('hono');
const app = new Hono();

const pontoService = require('../services/ponto.service');
const biometriaService = require('../services/biometria.service');
const { exigirAutorizacaoAdmin } = require('../middleware/adminAuth');
const { exigirTotem } = require('../middleware/totemAuth');
const { exigirInteiro, exigirTipoPonto, exigirTexto, exigirData, exigirHora, exigirDescritorFacial } = require('../utils/validacao');

// Bater ponto — exige o token do totem (o tablet físico autorizado), não mais aberto.
// O cliente definiu: ponto só é batido dentro da empresa, no tablet — nunca remotamente.
app.post('/ponto', exigirTotem, async (c) => {
    const body = await c.req.json();
    const funcionario_id = exigirInteiro(body.funcionario_id, 'funcionario_id');
    const tipo = exigirTipoPonto(body.tipo);
    const registro = await pontoService.registrarPonto(funcionario_id, tipo);
    return c.json({ message: 'Ponto batido com sucesso!', registro });
});

// Ajuste manual — exige login de administrador.
app.post('/ajuste-ponto', exigirAutorizacaoAdmin, async (c) => {
    const body = await c.req.json();
    const funcionario_id = exigirInteiro(body.funcionario_id, 'funcionario_id');
    const data = exigirData(body.data, 'data');
    const hora = exigirHora(body.hora, 'hora');
    const tipo = exigirTipoPonto(body.tipo);
    const justificativa = exigirTexto(body.justificativa, 'justificativa', { maxLen: 300 });

    await pontoService.ajustarPontoManual({ funcionario_id, data, hora, tipo, justificativa });
    return c.json({ message: 'Ajuste manual gravado com sucesso!' });
});

// "Meu histórico" — visto no próprio totem, depois de identificar o funcionário. Exige token do totem.
app.get('/meu-historico/:id', exigirTotem, async (c) => {
    const id = exigirInteiro(c.req.param('id'), 'id');
    const historico = await pontoService.historicoIndividual(id);
    if (!historico) return c.json({ message: 'Funcionário não encontrado.' }, 404);
    return c.json(historico);
});

// Histórico geral — dado de todo o time, exige login de administrador.
app.get('/historico-geral', exigirAutorizacaoAdmin, async (c) => {
    const inicio = c.req.query('inicio');
    const fim = c.req.query('fim');
    return c.json(await pontoService.historicoGeral({ dataInicio: inicio, dataFim: fim }));
});

app.get('/pendencias', exigirAutorizacaoAdmin, async (c) => {
    return c.json(await pontoService.pendenciasDoDia());
});

app.get('/dashboard-resumo', exigirAutorizacaoAdmin, async (c) => {
    const dashboardService = require('../services/dashboard.service');
    return c.json(await dashboardService.resumoDoDia());
});

// Reconhecimento facial — parte do fluxo de identificação no totem, exige token do totem.
app.post('/reconhecer-rosto', exigirTotem, async (c) => {
    const body = await c.req.json();
    const descritor = exigirDescritorFacial(body.descritor);
    const resultado = await biometriaService.reconhecer(descritor);
    if (!resultado) return c.json({ message: 'Rosto não reconhecido. Selecione manualmente no mural.' }, 404);
    return c.json(resultado);
});

module.exports = app;
