const db = require('../db/db');
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

    /**
     * O JWT sozinho não basta: ele vale 12h e não tem como ser "cancelado". Sem esta
     * conferência, uma conta excluída ou desativada continuaria com acesso total até o
     * token expirar naturalmente — inclusive alguém demitido no meio do expediente.
     * Uma consulta por requisição é barata perto do risco.
     */
    const conta = await db.get(
        `SELECT id, nome, ativo FROM admins WHERE id = ?`,
        [Number(payload.sub)]
    );
    if (!conta || !conta.ativo) {
        return c.json({ message: 'Esta conta não tem mais acesso ao sistema.' }, 401);
    }

    const admin = { id: conta.id, nome: conta.nome };
    c.set('admin', admin);
    definirAdminDoContexto(admin); // leva o autor até o log de auditoria
    await next();
}

module.exports = { exigirAutorizacaoAdmin };
