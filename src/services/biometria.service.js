const db = require('../db/db');
const config = require('../config');
const { registrarAuditoria } = require('../utils/auditoria');

/** Distância euclidiana entre dois descritores (vetores de mesmo tamanho). Quanto menor, mais parecidos. */
function distanciaEuclidiana(a, b) {
    let soma = 0;
    for (let i = 0; i < a.length; i++) {
        const diff = a[i] - b[i];
        soma += diff * diff;
    }
    return Math.sqrt(soma);
}

const MAXIMO_AMOSTRAS_POR_FUNCIONARIO = 3;

async function contarAmostras(funcionarioId) {
    const row = await db.get(`SELECT COUNT(*) as total FROM biometria_facial WHERE funcionario_id = ?`, [funcionarioId]);
    return row.total;
}

async function salvarAmostra(funcionarioId, descritor) {
    const totalAtual = await contarAmostras(funcionarioId);
    if (totalAtual >= MAXIMO_AMOSTRAS_POR_FUNCIONARIO) {
        const erro = new Error(`Esse funcionário já tem ${MAXIMO_AMOSTRAS_POR_FUNCIONARIO} amostras (o máximo). Remova as antigas antes de cadastrar novas.`);
        erro.status = 400;
        throw erro;
    }

    const { lastID } = await db.run(
        `INSERT INTO biometria_facial (funcionario_id, descritor) VALUES (?, ?)`,
        [funcionarioId, JSON.stringify(descritor)]
    );
    await registrarAuditoria('cadastrar_biometria', 'funcionario', funcionarioId, { amostra_id: lastID });
    return { id: lastID, total: totalAtual + 1 };
}

/** Resumo de quantas amostras cada funcionário tem — usado na tela de Administração pra não fazer N+1 chamadas. */
async function listarAmostrasPorFuncionario() {
    return db.all(`SELECT funcionario_id, COUNT(*) as total FROM biometria_facial GROUP BY funcionario_id`);
}

async function removerAmostras(funcionarioId) {
    await db.run(`DELETE FROM biometria_facial WHERE funcionario_id = ?`, [funcionarioId]);
    await registrarAuditoria('remover_biometria', 'funcionario', funcionarioId, {});
}

/**
 * Compara um descritor recém-capturado contra TODAS as amostras cadastradas de funcionários
 * ativos, e devolve o funcionário mais próximo, se a distância estiver dentro do limiar aceito.
 *
 * A comparação roda aqui no servidor DE PROPÓSITO: o navegador nunca baixa os descritores de
 * outras pessoas (isso seria expor dado biométrico de todo o time pra quem só precisava bater
 * o próprio ponto) — ele só envia o vetor que acabou de capturar, e o servidor decide quem é.
 */
async function reconhecer(descritorCapturado) {
    const amostras = await db.all(
        `SELECT b.funcionario_id, b.descritor, f.nome, f.emoji
         FROM biometria_facial b
         JOIN funcionarios f ON f.id = b.funcionario_id
         WHERE f.ativo = 1`
    );

    let melhor = null;
    for (const amostra of amostras) {
        const descritorSalvo = JSON.parse(amostra.descritor);
        const distancia = distanciaEuclidiana(descritorCapturado, descritorSalvo);
        if (!melhor || distancia < melhor.distancia) {
            melhor = { funcionario_id: amostra.funcionario_id, nome: amostra.nome, emoji: amostra.emoji, distancia };
        }
    }

    if (!melhor || melhor.distancia > config.biometria.limiarDistancia) {
        return null; // ninguém bateu com confiança suficiente
    }
    return melhor;
}

module.exports = {
    MAXIMO_AMOSTRAS_POR_FUNCIONARIO,
    contarAmostras,
    salvarAmostra,
    listarAmostrasPorFuncionario,
    removerAmostras,
    reconhecer
};
