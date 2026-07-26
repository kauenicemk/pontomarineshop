const { verificarToken } = require('../utils/jwtAuth');
const { definirAdminDoContexto } = require('../utils/contextoRequisicao');

/**
 * Antes, uma única senha de responsável compartilhada. Agora que o sistema fica acessível
 * pela internet, o painel administrativo passa a exigir login individual (e-mail + senha,
 * ver src/routes/auth.routes.js) — o token JWT gerado ali é o que essa função confere aqui.
 * Mantém o mesmo NOME (`exigirAutorizacaoAdmin`) e a mesma forma de uso nas rotas de antes,
 * só a validação por trás mudou.
 */
async function exigirAutorizacaoAdmin(c, next) {
    const header = c.req.header('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
        return c.json({ message: 'Ação restrita. Faça login como administrador.' }, 401);
    }

    let payload;
    try {
        payload = await verificarToken(token, c.env);
    } catch (err) {
        return c.json({ message: 'Sessão inválida ou expirada. Faça login novamente.' }, 401);
    }

    if (payload.tipo !== 'admin') {
        return c.json({ message: 'Essa ação exige uma conta de administrador.' }, 403);
    }

    const admin = { id: payload.sub, nome: payload.nome };
    c.set('admin', admin);
    definirAdminDoContexto(admin); // leva o autor até o log de auditoria
    await next();
}

module.exports = { exigirAutorizacaoAdmin };
