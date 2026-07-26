/**
 * Contexto por requisição — carrega QUEM está fazendo a ação até o log de auditoria,
 * sem precisar passar o admin como parâmetro em todos os services.
 *
 * Usa AsyncLocalStorage (disponível no Workers com nodejs_compat). Cada requisição
 * roda dentro do seu próprio store, então NÃO existe risco de uma requisição enxergar
 * o admin de outra — o que aconteceria com uma variável global compartilhada.
 *
 * Se o AsyncLocalStorage não estiver disponível no ambiente, tudo continua funcionando:
 * `contextoAtual()` devolve null e a auditoria grava a ação sem o autor.
 */
let armazenamento = null;
try {
    const { AsyncLocalStorage } = require('node:async_hooks');
    armazenamento = new AsyncLocalStorage();
} catch (_) {
    armazenamento = null; // ambiente sem async_hooks — degrada sem quebrar
}

/** Roda `fn` dentro de um contexto novo. `dados` é mutável (o adminAuth preenche o admin depois). */
function comContexto(dados, fn) {
    if (!armazenamento) return fn();
    return armazenamento.run(dados, fn);
}

/** Dados da requisição atual, ou null se não houver contexto. */
function contextoAtual() {
    if (!armazenamento) return null;
    return armazenamento.getStore() || null;
}

/** Marca quem é o administrador autenticado da requisição atual. */
function definirAdminDoContexto(admin) {
    const ctx = contextoAtual();
    if (ctx) ctx.admin = admin;
}

module.exports = { comContexto, contextoAtual, definirAdminDoContexto };
