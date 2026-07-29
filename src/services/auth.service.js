const bcrypt = require('bcryptjs');
const db = require('../db/db');
const { registrarAuditoria } = require('../utils/auditoria');

/* ===================== Administradores (contas individuais) ===================== */

async function criarAdmin({ nome, email, senha }) {
    const hash = await bcrypt.hash(senha, 10);
    const { lastID } = await db.run(
        `INSERT INTO admins (nome, email, senha_hash) VALUES (?, ?, ?)`,
        [nome, email.toLowerCase().trim(), hash]
    );
    await registrarAuditoria('criar_admin', 'admin', lastID, { nome, email });
    return { id: lastID, nome, email };
}

// Hash descartável de uma senha aleatória. Serve só para gastar o mesmo tempo de CPU
// quando o e-mail não existe — ver o comentário em verificarLoginAdmin.
const HASH_FALSO = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

/** Confere e-mail/senha; devolve os dados do admin (sem o hash) se corretos, ou null. */
async function verificarLoginAdmin(email, senha) {
    const admin = await db.get(
        `SELECT id, nome, email, senha_hash FROM admins WHERE email = ? AND ativo = 1`,
        [String(email).toLowerCase().trim()]
    );

    /**
     * Se o e-mail não existe, ainda assim rodamos um bcrypt.compare contra um hash
     * descartável. Sem isso, a resposta para um e-mail inexistente volta em poucos
     * milissegundos e a de um e-mail válido demora ~100ms — a diferença é medível e
     * permite descobrir quais e-mails têm conta no sistema (enumeração de usuários).
     */
    if (!admin) {
        await bcrypt.compare(String(senha), HASH_FALSO);
        return null;
    }

    const confere = await bcrypt.compare(senha, admin.senha_hash);
    if (!confere) return null;

    return { id: admin.id, nome: admin.nome, email: admin.email };
}

async function listarAdmins() {
    return db.all(`SELECT id, nome, email, ativo, criado_em FROM admins ORDER BY nome ASC`);
}

/**
 * Remove uma conta de administrador. Duas travas de segurança:
 *  - ninguém apaga a própria conta (evita se trancar fora do sistema por engano);
 *  - não é possível apagar o último administrador que restou.
 * `idSolicitante` é o admin logado que está pedindo a exclusão.
 */
async function removerAdmin(id, idSolicitante) {
    if (Number(id) === Number(idSolicitante)) {
        const erro = new Error('Você não pode apagar a sua própria conta. Peça a outro administrador.');
        erro.status = 400;
        throw erro;
    }

    const alvo = await db.get(`SELECT id, nome, email FROM admins WHERE id = ?`, [id]);
    if (!alvo) {
        const erro = new Error('Conta de administrador não encontrada.');
        erro.status = 404;
        throw erro;
    }

    const { total } = await db.get(`SELECT COUNT(*) as total FROM admins`);
    if (total <= 1) {
        const erro = new Error('Esta é a única conta de administrador do sistema e não pode ser apagada.');
        erro.status = 400;
        throw erro;
    }

    await db.run(`DELETE FROM admins WHERE id = ?`, [id]);
    await registrarAuditoria('remover_admin', 'admin', id, { nome: alvo.nome, email: alvo.email });
    return alvo;
}

/* ===================== Senha do totem (compartilhada, define o dispositivo autorizado) ===================== */

async function verificarSenhaTotem(senha) {
    const config = await db.get(`SELECT valor FROM configuracoes WHERE chave = 'totem_senha_hash'`);
    if (!config) return false;
    return bcrypt.compare(String(senha), config.valor);
}

/**
 * Versão dos tokens do totem. Todo token emitido carrega a versão vigente; ao trocar a
 * senha, a versão sobe e os tokens antigos deixam de valer na hora.
 *
 * Sem isso, o token do tablet dura 90 dias e não havia como cancelá-lo: um tablet
 * perdido ou roubado continuaria batendo ponto por meses, mesmo depois de a senha
 * ser trocada. Agora trocar a senha desconecta todos os dispositivos.
 */
async function versaoTokenTotem() {
    const linha = await db.get(`SELECT valor FROM configuracoes WHERE chave = 'totem_token_versao'`);
    return Number(linha && linha.valor) || 1;
}

async function definirSenhaTotem(novaSenha) {
    const hash = await bcrypt.hash(String(novaSenha), 10);
    await db.run(
        `INSERT INTO configuracoes (chave, valor) VALUES ('totem_senha_hash', ?)
         ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`,
        [hash]
    );

    const novaVersao = (await versaoTokenTotem()) + 1;
    await db.run(
        `INSERT INTO configuracoes (chave, valor) VALUES ('totem_token_versao', ?)
         ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`,
        [String(novaVersao)]
    );

    await registrarAuditoria('trocar_senha_totem', 'configuracao', null, {
        tokens_invalidados: true, nova_versao: novaVersao
    });
    return { versao: novaVersao };
}

module.exports = {
    criarAdmin,
    verificarLoginAdmin,
    listarAdmins,
    removerAdmin,
    verificarSenhaTotem,
    definirSenhaTotem,
    versaoTokenTotem
};
