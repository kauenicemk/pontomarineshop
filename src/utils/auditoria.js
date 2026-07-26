const db = require('../db/db');
const { contextoAtual } = require('./contextoRequisicao');

/**
 * O SQLite usa DUAS mensagens diferentes para "essa coluna não existe":
 *   SELECT/UPDATE → "no such column: turno"
 *   INSERT        → "table log_auditoria has no column named admin_id"
 * Detectar só a primeira faria o fallback nunca disparar num INSERT.
 */
function ehColunaInexistente(erro) {
    const texto = String((erro && erro.message) || '');
    return /no such column/i.test(texto) || /has no column named/i.test(texto);
}

/**
 * Registra uma ação administrativa (ajuste de ponto, mudança de configuração, cadastro...).
 *
 * O AUTOR vem do contexto da requisição (ver contextoRequisicao.js): quem estava logado,
 * de qual IP e em qual rota. Assim toda alteração fica rastreável até uma conta de
 * administrador, sem precisar passar o admin manualmente em cada service.
 */
async function registrarAuditoria(acao, entidade, entidadeId, detalhes) {
    const ctx = contextoAtual();
    const admin = ctx && ctx.admin;
    const detalhesTexto = typeof detalhes === 'string' ? detalhes : JSON.stringify(detalhes ?? {});

    try {
        await db.run(
            `INSERT INTO log_auditoria (acao, entidade, entidade_id, detalhes, admin_id, admin_nome, ip, rota)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                acao,
                entidade,
                entidadeId ?? null,
                detalhesTexto,
                admin ? Number(admin.id) || null : null,
                admin ? admin.nome : null,
                ctx ? ctx.ip || null : null,
                ctx ? ctx.rota || null : null
            ]
        );
        return;
    } catch (erro) {
        // Banco ainda sem as colunas de autor (migração 0004 não aplicada): grava no
        // formato antigo em vez de derrubar a ação do usuário.
        if (ehColunaInexistente(erro)) {
            console.warn('Log de auditoria sem as colunas de autor — rode: wrangler d1 migrations apply');
            try {
                await db.run(
                    `INSERT INTO log_auditoria (acao, entidade, entidade_id, detalhes) VALUES (?, ?, ?, ?)`,
                    [acao, entidade, entidadeId ?? null, detalhesTexto]
                );
                return;
            } catch (erroFallback) {
                console.error('Falha ao gravar auditoria (formato antigo):', erroFallback);
                return;
            }
        }

        // Auditoria é registro, não regra de negócio: se falhar, a ação do usuário
        // (bater ponto, salvar jornada...) não pode ser perdida por causa do log.
        console.error('Falha ao gravar auditoria:', erro);
    }
}

/** Lista o log, do mais recente para o mais antigo, com filtros opcionais. */
async function listarAuditoria({ dataInicio, dataFim, adminId, acao, limite = 200, offset = 0 } = {}) {
    try {
        return await consultarAuditoria({ dataInicio, dataFim, adminId, acao, limite, offset });
    } catch (erro) {
        if (!ehColunaInexistente(erro)) throw erro;
        const e = new Error('O log de auditoria ainda não foi migrado. Rode: wrangler d1 migrations apply');
        e.status = 409;
        throw e;
    }
}

async function consultarAuditoria({ dataInicio, dataFim, adminId, acao, limite = 200, offset = 0 } = {}) {
    const condicoes = [];
    const params = [];
    if (dataInicio) { condicoes.push('date(criado_em) >= ?'); params.push(dataInicio); }
    if (dataFim) { condicoes.push('date(criado_em) <= ?'); params.push(dataFim); }
    if (adminId) { condicoes.push('admin_id = ?'); params.push(adminId); }
    if (acao) { condicoes.push('acao = ?'); params.push(acao); }
    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

    const registros = await db.all(
        `SELECT id, acao, entidade, entidade_id, detalhes, admin_id, admin_nome, ip, rota, criado_em
         FROM log_auditoria ${where}
         ORDER BY id DESC LIMIT ? OFFSET ?`,
        [...params, Math.min(Number(limite) || 200, 500), Number(offset) || 0]
    );
    const total = await db.get(`SELECT COUNT(*) as total FROM log_auditoria ${where}`, params);

    return { registros, total: total.total };
}

/** Lista distinta de ações já registradas — alimenta o filtro da tela. */
async function listarAcoesDisponiveis() {
    const linhas = await db.all(`SELECT DISTINCT acao FROM log_auditoria ORDER BY acao ASC`);
    return linhas.map((l) => l.acao);
}

module.exports = { registrarAuditoria, listarAuditoria, listarAcoesDisponiveis };
