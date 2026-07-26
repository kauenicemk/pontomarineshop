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

const TIPOS_AUSENCIA = ['atestado', 'ferias', 'licenca', 'folga', 'sem_justificativa'];

// Justificativa EM MASSA — vários funcionários e/ou várias datas de uma vez.
// O upsert por (funcionario_id, data) garante que repetir a operação não duplica nada.
app.post('/lote', exigirAutorizacaoAdmin, async (c) => {
    const body = await c.req.json();

    if (!Array.isArray(body.itens) || body.itens.length === 0) {
        return c.json({ message: 'Selecione ao menos uma falta para justificar.' }, 400);
    }
    if (body.itens.length > 500) {
        return c.json({ message: 'Selecione no máximo 500 faltas por vez.' }, 400);
    }
    if (!TIPOS_AUSENCIA.includes(body.tipo)) {
        return c.json({ message: 'Tipo de ausência inválido.' }, 400);
    }

    const itens = body.itens.map((item) => ({
        funcionario_id: exigirInteiro(item.funcionario_id, 'funcionario_id'),
        data: exigirData(item.data, 'data')
    }));
    const justificativa = body.justificativa ? exigirTexto(body.justificativa, 'justificativa', { maxLen: 300 }) : null;

    const resultado = await ausenciasService.justificarEmLote(itens, { tipo: body.tipo, justificativa });
    return c.json({
        ...resultado,
        message: resultado.atualizados > 0
            ? `${resultado.total} falta(s) justificada(s) — ${resultado.criados} nova(s) e ${resultado.atualizados} atualizada(s).`
            : `${resultado.total} falta(s) justificada(s) com sucesso.`
    });
});

app.delete('/:id', exigirAutorizacaoAdmin, async (c) => {
    const id = exigirInteiro(c.req.param('id'), 'id');
    await ausenciasService.remover(id);
    return c.json({ message: 'Justificativa removida.' });
});

module.exports = app;
