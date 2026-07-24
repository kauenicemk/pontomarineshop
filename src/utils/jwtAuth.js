const { sign, verify } = require('hono/jwt');

const ALG = 'HS256';

function segredo(env) {
    const s = env && env.JWT_SECRET;
    if (!s) throw new Error('JWT_SECRET não configurado no ambiente.');
    return s;
}

/** Gera um token assinado. `payload` deve incluir `tipo` ('admin' ou 'totem') e `exp` (segundos desde epoch). */
async function gerarToken(payload, env) {
    return sign(payload, segredo(env), ALG);
}

/** Verifica um token — lança erro se inválido/expirado/assinatura errada. */
async function verificarToken(token, env) {
    return verify(token, segredo(env), ALG);
}

module.exports = { gerarToken, verificarToken };
