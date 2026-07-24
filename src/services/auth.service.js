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

/** Confere e-mail/senha; devolve os dados do admin (sem o hash) se corretos, ou null. */
async function verificarLoginAdmin(email, senha) {
    const admin = await db.get(
        `SELECT id, nome, email, senha_hash FROM admins WHERE email = ? AND ativo = 1`,
        [String(email).toLowerCase().trim()]
    );
    if (!admin) return null;

    const confere = await bcrypt.compare(senha, admin.senha_hash);
    if (!confere) return null;

    return { id: admin.id, nome: admin.nome, email: admin.email };
}

async function listarAdmins() {
    return db.all(`SELECT id, nome, email, ativo, criado_em FROM admins ORDER BY nome ASC`);
}

async function existeAlgumAdmin() {
    const row = await db.get(`SELECT COUNT(*) as total FROM admins`);
    return row.total > 0;
}

/* ===================== Senha do totem (compartilhada, define o dispositivo autorizado) ===================== */

async function verificarSenhaTotem(senha) {
    const config = await db.get(`SELECT valor FROM configuracoes WHERE chave = 'totem_senha_hash'`);
    if (!config) return false;
    return bcrypt.compare(String(senha), config.valor);
}

async function definirSenhaTotem(novaSenha) {
    const hash = await bcrypt.hash(String(novaSenha), 10);
    await db.run(
        `INSERT INTO configuracoes (chave, valor) VALUES ('totem_senha_hash', ?)
         ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`,
        [hash]
    );
    await registrarAuditoria('trocar_senha_totem', 'configuracao', null, {});
}

module.exports = {
    criarAdmin,
    verificarLoginAdmin,
    listarAdmins,
    existeAlgumAdmin,
    verificarSenhaTotem,
    definirSenhaTotem
};
