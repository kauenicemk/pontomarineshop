const { Hono } = require('hono');
const app = new Hono();

const funcionariosService = require('../services/funcionarios.service');
const biometriaService = require('../services/biometria.service');
const { exigirAutorizacaoAdmin } = require('../middleware/adminAuth');
const { exigirTotem } = require('../middleware/totemAuth');
const {
    exigirInteiro, exigirTexto, exigirTextoOpcional, exigirRegime, exigirTurno, exigirPin, exigirHora,
    exigirDescritorFacial, exigirDataOpcional, exigirValorMonetarioOpcional
} = require('../utils/validacao');

// Lista usada pelo totem pra montar o mural — exige token do totem (não é mais pública).
app.get('/', exigirTotem, async (c) => {
    return c.json(await funcionariosService.listarAtivos());
});

// Lista completa (inclui inativos) — uso administrativo.
app.get('/todos', exigirAutorizacaoAdmin, async (c) => {
    return c.json(await funcionariosService.listarTodos());
});

// Cadastro de novo funcionário — protegido pela senha de responsável.
app.post('/', exigirAutorizacaoAdmin, async (c) => {
    const body = await c.req.json();
    const nome = exigirTexto(body.nome, 'nome', { maxLen: 150 });
    const emoji = exigirTexto(body.emoji, 'emoji', { maxLen: 10 });
    const regime = exigirRegime(body.regime);
    const turno = body.turno ? exigirTurno(body.turno) : 'manha_tarde';
    const horas_diarias = exigirTexto(body.horas_diarias, 'horas_diarias', { maxLen: 20 });
    const pin = exigirPin(body.pin);
    const tolerancia_almoco_min = body.tolerancia_almoco_min != null ? exigirInteiro(body.tolerancia_almoco_min, 'tolerancia_almoco_min') : undefined;
    const almoco_flexivel = !!body.almoco_flexivel;
    const data_admissao = exigirDataOpcional(body.data_admissao, 'data_admissao');
    const salario_base = exigirValorMonetarioOpcional(body.salario_base, 'salario_base');
    const cargo = exigirTextoOpcional(body.cargo, 'cargo', { maxLen: 100 });
    const departamento = exigirTextoOpcional(body.departamento, 'departamento', { maxLen: 100 });

    // A jornada (6 dias da semana) já sai com valores padrão sensatos pro regime escolhido
    // e pode ser ajustada depois na aba Configurar Horários.
    const novo = await funcionariosService.criar({
        emoji, nome, regime, turno, horas_diarias, pin, tolerancia_almoco_min, almoco_flexivel,
        data_admissao, salario_base, cargo, departamento
    });
    return c.json(novo, 201);
});

// Dados cadastrais complementares: admissão (usada pro cálculo de férias), salário-base
// (usado pra converter % de hora extra/noturno em R$), cargo e departamento.
app.post('/:id/dados-cadastrais', exigirAutorizacaoAdmin, async (c) => {
    const id = exigirInteiro(c.req.param('id'), 'id');
    const body = await c.req.json();
    const data_admissao = exigirDataOpcional(body.data_admissao, 'data_admissao');
    const salario_base = exigirValorMonetarioOpcional(body.salario_base, 'salario_base');
    const cargo = exigirTextoOpcional(body.cargo, 'cargo', { maxLen: 100 });
    const departamento = exigirTextoOpcional(body.departamento, 'departamento', { maxLen: 100 });
    await funcionariosService.atualizarDadosCadastrais(id, { data_admissao, salario_base, cargo, departamento });
    return c.json({ message: 'Dados cadastrais atualizados com sucesso!' });
});

// Jornada configurável em cada um dos 6 dias da semana individualmente — cada um com seu
// próprio horário de entrada, carga horária (meta) e se aquele dia é dia de trabalho ou não.
app.get('/:id/jornada', exigirAutorizacaoAdmin, async (c) => {
    const id = exigirInteiro(c.req.param('id'), 'id');
    return c.json(await funcionariosService.buscarJornada(id));
});

app.post('/:id/jornada', exigirAutorizacaoAdmin, async (c) => {
    const id = exigirInteiro(c.req.param('id'), 'id');
    const body = await c.req.json();
    const jornada = {};
    for (const grupo of funcionariosService.GRUPOS_JORNADA) {
        const cfg = body[grupo];
        if (!cfg) continue;
        jornada[grupo] = {
            horario_entrada: exigirHora(cfg.horario_entrada, `${grupo}.horario_entrada`),
            meta_minutos: exigirInteiro(cfg.meta_minutos, `${grupo}.meta_minutos`),
            trabalha: !!cfg.trabalha
        };
    }
    await funcionariosService.atualizarJornadaCompleta(id, jornada);
    return c.json({ message: 'Jornada atualizada com sucesso!' });
});

// Regras de almoço (tolerância em minutos + flexibilidade) — substitui as exceções por nome hardcoded.
app.post('/:id/regras-almoco', exigirAutorizacaoAdmin, async (c) => {
    const id = exigirInteiro(c.req.param('id'), 'id');
    const body = await c.req.json();
    const tolerancia_almoco_min = exigirInteiro(body.tolerancia_almoco_min, 'tolerancia_almoco_min');
    const almoco_flexivel = !!body.almoco_flexivel;
    await funcionariosService.atualizarRegrasAlmoco(id, { tolerancia_almoco_min, almoco_flexivel });
    return c.json({ message: 'Regras de almoço atualizadas com sucesso!' });
});

// Readmitir um funcionário previamente demitido (soft delete reversível).
app.post('/:id/ativo', exigirAutorizacaoAdmin, async (c) => {
    const id = exigirInteiro(c.req.param('id'), 'id');
    const body = await c.req.json();
    await funcionariosService.atualizarAtivo(id, !!body.ativo);
    return c.json({ message: body.ativo ? 'Funcionário readmitido com sucesso!' : 'Status atualizado com sucesso!' });
});

// Troca de turno (Manhã/Tarde <-> Tarde/Noite).
app.post('/:id/turno', exigirAutorizacaoAdmin, async (c) => {
    const id = exigirInteiro(c.req.param('id'), 'id');
    const body = await c.req.json();
    const turno = exigirTurno(body.turno);
    await funcionariosService.atualizarTurno(id, turno);
    return c.json({ message: 'Turno atualizado com sucesso!' });
});

// Troca de regime — usado, por exemplo, para efetivar um estagiário (ESTAGIARIO -> CLT).
app.post('/:id/regime', exigirAutorizacaoAdmin, async (c) => {
    const id = exigirInteiro(c.req.param('id'), 'id');
    const body = await c.req.json();
    const regime = exigirRegime(body.regime);
    await funcionariosService.atualizarRegime(id, regime);
    return c.json({ message: 'Regime atualizado com sucesso!' });
});

// Demitir / remover funcionário — jeito único e simples pro responsável usar:
// se ele nunca bateu ponto, é excluído de vez; se já tem histórico, é apenas desativado
// (o histórico de ponto é mantido, exigência de qualquer sistema de controle de jornada).
app.delete('/:id', exigirAutorizacaoAdmin, async (c) => {
    const id = exigirInteiro(c.req.param('id'), 'id');
    const resultado = await funcionariosService.removerOuDemitir(id);
    return c.json({
        removidoDefinitivamente: resultado.removidoDefinitivamente,
        message: resultado.removidoDefinitivamente
            ? 'Funcionário excluído (não havia nenhum registro de ponto associado a ele).'
            : 'Funcionário demitido. O histórico de ponto foi mantido para fins de auditoria e não aparece mais nas listas ativas.'
    });
});

// Reconhecimento facial (opcional) — resumo de quantas amostras cada funcionário já tem.
app.get('/biometria/resumo', exigirAutorizacaoAdmin, async (c) => {
    return c.json(await biometriaService.listarAmostrasPorFuncionario());
});

// Cadastra uma amostra facial (o navegador já manda o DESCRITOR calculado, nunca a foto).
app.post('/:id/biometria', exigirAutorizacaoAdmin, async (c) => {
    const id = exigirInteiro(c.req.param('id'), 'id');
    const body = await c.req.json();
    const descritor = exigirDescritorFacial(body.descritor);
    const resultado = await biometriaService.salvarAmostra(id, descritor);
    return c.json({ message: 'Amostra facial cadastrada com sucesso!', total: resultado.total }, 201);
});

app.get('/:id/biometria', exigirAutorizacaoAdmin, async (c) => {
    const id = exigirInteiro(c.req.param('id'), 'id');
    return c.json({ total: await biometriaService.contarAmostras(id) });
});

app.delete('/:id/biometria', exigirAutorizacaoAdmin, async (c) => {
    const id = exigirInteiro(c.req.param('id'), 'id');
    await biometriaService.removerAmostras(id);
    return c.json({ message: 'Amostras faciais removidas.' });
});

module.exports = app;
