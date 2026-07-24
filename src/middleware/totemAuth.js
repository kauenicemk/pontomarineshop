const { verificarToken } = require('../utils/jwtAuth');

/**
 * Protege as rotas usadas pelo totem físico (bater ponto, reconhecimento facial, etc).
 * O tablet só tem esse token depois de alguém digitar a senha do totem uma vez nele
 * (ver POST /api/auth/totem/login) — sem isso, ninguém na internet consegue chamar essas
 * rotas diretamente, mesmo sabendo a URL.
 */
async function exigirTotem(c, next) {
    const header = c.req.header('x-totem-token') || '';

    if (!header) {
        return c.json({ message: 'Dispositivo não autorizado. Configure a senha do totem.' }, 401);
    }

    let payload;
    try {
        payload = await verificarToken(header, c.env);
    } catch (err) {
        return c.json({ message: 'Sessão do totem inválida ou expirada. Configure a senha novamente.' }, 401);
    }

    if (payload.tipo !== 'totem') {
        return c.json({ message: 'Token inválido para este dispositivo.' }, 403);
    }

    await next();
}

module.exports = { exigirTotem };
