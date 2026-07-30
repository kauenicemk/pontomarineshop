const { Hono } = require('hono');
const app = new Hono();

const trocasService = require('../services/trocasDia.service');
const tratativasService = require('../services/tratativas.service');
const { exigirAutorizacaoAdmin } = require('../middleware/adminAuth');
const { exigirInteiro, exigirData, exigirTexto, exigirTextoOpcional } = require('../utils/validacao');

/* ===================== Trocas de dia ===================== */

app.get('/trocas', exigirAutorizacaoAdmin, async (c) => {
    return c.json(await trocasService.listar({
        dataInicio: c.req.query('inicio') || null,
        dataFim: c.req.query('fim') || null
    }));
});

app.post('/trocas', exigirAutorizacaoAdmin, async (c) => {
    const body = await c.req.json();
    const criado = await trocasService.criar({
        funcionario_id: exigirInteiro(body.funcionario_id, 'funcionario_id'),
        data_folga: exigirData(body.data_folga, 'data_folga'),
        data_trabalho: exigirData(body.data_trabalho, 'data_trabalho'),
        observacao: exigirTextoOpcional(body.observacao, 'observacao', { maxLen: 300 })
    });
    return c.json(criado, 201);
});

app.delete('/trocas/:id', exigirAutorizacaoAdmin, async (c) => {
    await trocasService.remover(exigirInteiro(c.req.param('id'), 'id'));
    return c.json({ message: 'Troca de dia removida.' });
});

/* ===================== Tratativas de atraso / abono de horas ===================== */

app.get('/atrasos', exigirAutorizacaoAdmin, async (c) => {
    return c.json(await tratativasService.listar({
        dataInicio: exigirData(c.req.query('inicio'), 'inicio'),
        dataFim: exigirData(c.req.query('fim'), 'fim')
    }));
});

app.post('/atrasos', exigirAutorizacaoAdmin, async (c) => {
    const body = await c.req.json();
    const criado = await tratativasService.registrar({
        funcionario_id: exigirInteiro(body.funcionario_id, 'funcionario_id'),
        data: exigirData(body.data, 'data'),
        tipo: body.tipo,
        minutos_abonados: body.minutos_abonados,
        motivo: exigirTextoOpcional(body.motivo, 'motivo', { maxLen: 300 })
    });
    return c.json(criado, 201);
});

// Tratativa em MASSA — mesma decisão aplicada a vários atrasos de uma vez.
app.post('/atrasos/lote', exigirAutorizacaoAdmin, async (c) => {
    const body = await c.req.json();

    if (!Array.isArray(body.itens) || body.itens.length === 0) {
        return c.json({ message: 'Selecione ao menos um atraso para tratar.' }, 400);
    }
    if (body.itens.length > 500) {
        return c.json({ message: 'Selecione no máximo 500 atrasos por vez.' }, 400);
    }

    const itens = body.itens.map((item) => ({
        funcionario_id: exigirInteiro(item.funcionario_id, 'funcionario_id'),
        data: exigirData(item.data, 'data')
    }));

    const resultado = await tratativasService.registrarEmLote(itens, {
        tipo: body.tipo,
        minutos_abonados: body.minutos_abonados,
        motivo: exigirTextoOpcional(body.motivo, 'motivo', { maxLen: 300 })
    });

    return c.json({
        ...resultado,
        message: resultado.atualizados > 0
            ? `${resultado.total} atraso(s) tratado(s) — ${resultado.criados} novo(s) e ${resultado.atualizados} atualizado(s).`
            : `${resultado.total} atraso(s) tratado(s) com sucesso.`
    });
});

app.delete('/atrasos/:id', exigirAutorizacaoAdmin, async (c) => {
    await tratativasService.remover(exigirInteiro(c.req.param('id'), 'id'));
    return c.json({ message: 'Tratativa removida — o atraso volta a contar normalmente.' });
});

module.exports = app;
