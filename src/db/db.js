// Adaptado de sqlite3 (arquivo local) para Cloudflare D1. Mantém a MESMA assinatura
// (run/get/all/exec) que todos os services já usam — nenhum service precisou mudar.
//
// D1 só existe dentro do fetch(request, env, ctx) do Worker, então o binding (env.DB)
// é injetado aqui via setD1() no início de cada requisição (ver public/_worker.js).

let d1 = null;

function setD1(instance) {
    d1 = instance;
}

/** Roda um comando (INSERT/UPDATE/DELETE) e devolve {lastID, changes}. */
async function run(sql, params = []) {
    const result = await d1.prepare(sql).bind(...params).run();
    return { lastID: result.meta.last_row_id, changes: result.meta.changes };
}

/** Busca uma única linha (undefined se não achar — mesmo comportamento do sqlite3 original). */
async function get(sql, params = []) {
    const row = await d1.prepare(sql).bind(...params).first();
    return row ?? undefined;
}

/** Busca várias linhas. */
async function all(sql, params = []) {
    const result = await d1.prepare(sql).bind(...params).all();
    return result.results;
}

/** Executa múltiplos comandos SQL sem parâmetros (uso em migrações/schema). */
async function exec(sql) {
    await d1.exec(sql);
}

module.exports = { setD1, run, get, all, exec };
