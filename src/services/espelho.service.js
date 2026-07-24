const db = require('../db/db');
const { registrarAuditoria } = require('../utils/auditoria');

/**
 * Registra que o funcionário revisou e concordou com o espelho de ponto de um mês —
 * a versão digital de "assinar o espelho". Guarda o timestamp exato; não é uma assinatura
 * criptográfica, mas dá uma trilha auditável de que a pessoa viu e confirmou.
 */
async function confirmarLeitura(funcionarioId, mesReferencia) {
    await db.run(
        `INSERT INTO espelho_confirmacoes (funcionario_id, mes_referencia) VALUES (?, ?)
         ON CONFLICT(funcionario_id, mes_referencia) DO NOTHING`,
        [funcionarioId, mesReferencia]
    );
    await registrarAuditoria('confirmar_espelho', 'funcionario', funcionarioId, { mes_referencia: mesReferencia });
    return buscarConfirmacao(funcionarioId, mesReferencia);
}

async function buscarConfirmacao(funcionarioId, mesReferencia) {
    const row = await db.get(
        `SELECT confirmado_em FROM espelho_confirmacoes WHERE funcionario_id = ? AND mes_referencia = ?`,
        [funcionarioId, mesReferencia]
    );
    return { confirmado: !!row, confirmado_em: row ? row.confirmado_em : null };
}

module.exports = { confirmarLeitura, buscarConfirmacao };
