import bcrypt from 'bcryptjs';
import db from '../src/db/db.js';
import app from '../src/app.js';

let inicializado = false;

/**
 * Bootstrap de primeiro uso: garante que exista pelo menos um admin (pra não ficar trancado
 * fora do próprio sistema) e uma senha de totem — só roda a inserção se ainda não existir nada.
 * Os valores iniciais vêm de variáveis de ambiente (ver wrangler.toml); o esperado é trocar
 * a senha do totem e criar/trocar o admin de verdade logo no primeiro acesso.
 */
async function garantirBootstrapInicial(env) {
    const existeAdmin = await db.get(`SELECT id FROM admins LIMIT 1`);
    if (!existeAdmin) {
        const hash = await bcrypt.hash(String(env.ADMIN_SENHA_INICIAL || 'troque-esta-senha'), 10);
        await db.run(
            `INSERT INTO admins (nome, email, senha_hash) VALUES (?, ?, ?)`,
            [env.ADMIN_NOME_INICIAL || 'Administrador', (env.ADMIN_EMAIL_INICIAL || 'admin@empresa.com').toLowerCase(), hash]
        );
    }

    const existeTotem = await db.get(`SELECT valor FROM configuracoes WHERE chave = 'totem_senha_hash'`);
    if (!existeTotem) {
        const hash = await bcrypt.hash(String(env.TOTEM_SENHA_INICIAL || '000000'), 10);
        await db.run(`INSERT INTO configuracoes (chave, valor) VALUES ('totem_senha_hash', ?)`, [hash]);
    }
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        if (!url.pathname.startsWith('/api/')) {
            const resposta = await env.ASSETS.fetch(request);
            // Fallback de SPA: rotas "de tela" que não são um arquivo de verdade (ex: /admin)
            // caem aqui como 404 (o not_found_handling do [assets] já deveria cobrir isso, mas
            // mantém como rede de segurança). Serve o index.html, e o main.js decide o que
            // mostrar olhando pra window.location.pathname.
            if (resposta.status === 404) {
                return env.ASSETS.fetch(new URL('/', request.url));
            }
            return resposta;
        }

        db.setD1(env.DB);
        if (!inicializado) {
            await garantirBootstrapInicial(env);
            inicializado = true;
        }

        return app.fetch(request, env, ctx);
    }
};
