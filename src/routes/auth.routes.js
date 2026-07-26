const { Hono } = require('hono');
const app = new Hono();

const authService = require('../services/auth.service');
const { gerarToken } = require('../utils/jwtAuth');
const { exigirAutorizacaoAdmin } = require('../middleware/adminAuth');
const { exigirTexto, exigirPin, exigirInteiro } = require('../utils/validacao');
const { registrarAuditoria } = require('../utils/auditoria');
const { definirAdminDoContexto } = require('../utils/contextoRequisicao');

const SEGUNDOS_SESSAO_ADMIN = 12 * 60 * 60;      // 12h — sessão do painel administrativo
const SEGUNDOS_SESSAO_TOTEM = 90 * 24 * 60 * 60; // 90 dias — o tablet fica "lembrado" como totem autorizado

// Login do totem — uma senha só, definida pelo administrador na primeira configuração do
// tablet físico. Gera um token de longa duração pra não pedir de novo toda vez que o app abrir
// naquele dispositivo. Só isso já fecha a porta de "qualquer um na internet bate ponto".
app.post('/totem/login', async (c) => {
    const body = await c.req.json();
    const senha = exigirPin(body.senha, 'senha');

    const ok = await authService.verificarSenhaTotem(senha);
    if (!ok) {
        await registrarAuditoria('login_totem_falhou', 'totem', null, {});
        return c.json({ message: 'Senha do totem incorreta.' }, 401);
    }
    await registrarAuditoria('login_totem', 'totem', null, {});

    const exp = Math.floor(Date.now() / 1000) + SEGUNDOS_SESSAO_TOTEM;
    const token = await gerarToken({ tipo: 'totem', exp }, c.env);
    return c.json({ token });
});

// Login do administrador — conta individual (e-mail + senha), acessível de qualquer lugar.
app.post('/admin/login', async (c) => {
    const body = await c.req.json();
    const email = exigirTexto(body.email, 'email', { maxLen: 150 });
    const senha = exigirTexto(body.senha, 'senha', { maxLen: 100 });

    const admin = await authService.verificarLoginAdmin(email, senha);
    if (!admin) {
        // Tentativa falha também vira registro: é o rastro de quem tentou entrar sem conseguir.
        await registrarAuditoria('login_admin_falhou', 'admin', null, { email });
        return c.json({ message: 'E-mail ou senha incorretos.' }, 401);
    }

    definirAdminDoContexto({ id: admin.id, nome: admin.nome });
    await registrarAuditoria('login_admin', 'admin', admin.id, { email: admin.email });

    const exp = Math.floor(Date.now() / 1000) + SEGUNDOS_SESSAO_ADMIN;
    const token = await gerarToken({ tipo: 'admin', sub: String(admin.id), nome: admin.nome, exp }, c.env);
    return c.json({ token, nome: admin.nome, email: admin.email });
});

// Cadastro de novos administradores — só quem já é admin pode criar outro.
app.post('/admin/criar', exigirAutorizacaoAdmin, async (c) => {
    const body = await c.req.json();
    const nome = exigirTexto(body.nome, 'nome', { maxLen: 150 });
    const email = exigirTexto(body.email, 'email', { maxLen: 150 });
    const senha = exigirTexto(body.senha, 'senha', { minLen: 8, maxLen: 100 });

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return c.json({ message: 'Informe um e-mail válido.' }, 400);
    }
    if (senha.length < 8) {
        return c.json({ message: 'A senha deve ter pelo menos 8 caracteres.' }, 400);
    }

    const novo = await authService.criarAdmin({ nome, email, senha });
    return c.json(novo, 201);
});

app.get('/admin/listar', exigirAutorizacaoAdmin, async (c) => {
    return c.json(await authService.listarAdmins());
});

// Excluir conta de administrador — não permite apagar a própria conta nem a última do sistema.
app.delete('/admin/:id', exigirAutorizacaoAdmin, async (c) => {
    const id = exigirInteiro(c.req.param('id'), 'id');
    const solicitante = c.get('admin');
    const removido = await authService.removerAdmin(id, solicitante && solicitante.id);
    return c.json({ message: `Conta de ${removido.nome} removida do sistema.` });
});

// Trocar a senha do totem — ação administrativa (o tablet físico precisa ser reconfigurado
// manualmente com a senha nova depois disso).
app.post('/totem/trocar-senha', exigirAutorizacaoAdmin, async (c) => {
    const body = await c.req.json();
    const novaSenha = exigirPin(body.nova_senha, 'nova_senha');
    await authService.definirSenhaTotem(novaSenha);
    return c.json({ message: 'Senha do totem atualizada com sucesso!' });
});

module.exports = app;
