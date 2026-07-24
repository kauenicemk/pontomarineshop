const db = require('../db/db');

/**
 * Registra uma ação administrativa (ajuste de ponto, mudança de configuração, cadastro, etc.)
 * Antes disso não havia NENHUM jeito de saber quem alterou o quê — o ajuste manual virava só
 * mais uma linha na tabela de pontos, sem rastro de auditoria separado.
 */
async function registrarAuditoria(acao, entidade, entidadeId, detalhes) {
    await db.run(
        `INSERT INTO log_auditoria (acao, entidade, entidade_id, detalhes) VALUES (?, ?, ?, ?)`,
        [acao, entidade, entidadeId ?? null, typeof detalhes === 'string' ? detalhes : JSON.stringify(detalhes ?? {})]
    );
}

module.exports = { registrarAuditoria };
