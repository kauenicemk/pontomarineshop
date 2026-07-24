// express-rate-limit é específico do Express (usa req/res do Express) e não roda no Hono.
// Mesma lógica (janela + máximo por IP), sem depender de nenhuma lib nova — os valores de
// janela/máximo são os MESMOS da versão anterior.
function criarLimitador({ janelaMs, maximo, mensagem }) {
    const acessos = new Map(); // ip -> [timestamps]

    return async function limitador(c, next) {
        const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'desconhecido';
        const agora = Date.now();
        const registros = (acessos.get(ip) || []).filter((t) => agora - t < janelaMs);

        if (registros.length >= maximo) {
            return c.json({ message: mensagem }, 429);
        }

        registros.push(agora);
        acessos.set(ip, registros);
        await next();
    };
}

// Protege contra força bruta da senha de responsável e do PIN de cada funcionário.
const limiteAutenticacao = criarLimitador({
    janelaMs: 15 * 60 * 1000, // 15 minutos
    maximo: 15,
    mensagem: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
});

// Limite geral, mais permissivo, para o resto da API.
const limiteGeral = criarLimitador({
    janelaMs: 5 * 60 * 1000,
    maximo: 300,
    mensagem: 'Muitas requisições. Tente novamente em alguns minutos.'
});

module.exports = { limiteAutenticacao, limiteGeral };
