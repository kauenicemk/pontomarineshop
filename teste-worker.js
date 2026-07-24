const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const db = require('./src/db/db');

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(fs.readFileSync('migrations/0001_init.sql', 'utf8'));
sqlite.exec(fs.readFileSync('migrations/0002_admins.sql', 'utf8'));
sqlite.exec(fs.readFileSync('migrations/0003_ferias_simples.sql', 'utf8'));

const fakeD1 = {
    prepare(sql) {
        return {
            bind(...params) {
                return {
                    async first() { const row = sqlite.prepare(sql).get(...params); return row || null; },
                    async all() { const rows = sqlite.prepare(sql).all(...params); return { results: rows, success: true }; },
                    async run() {
                        const result = sqlite.prepare(sql).run(...params);
                        return { success: true, meta: { last_row_id: Number(result.lastInsertRowid), changes: result.changes } };
                    }
                };
            }
        };
    },
    async exec(sql) { sqlite.exec(sql); }
};

db.setD1(fakeD1);
const app = require('./src/app');
const FAKE_ENV = { JWT_SECRET: 'segredo-de-teste' };
async function request(path, opts = {}) { return app.request(path, opts, FAKE_ENV); }

async function main() {
    const hashAdmin = await bcrypt.hash('senha-admin-123', 10);
    await db.run(`INSERT INTO admins (nome, email, senha_hash) VALUES (?, ?, ?)`, ['Dono', 'dono@empresa.com', hashAdmin]);
    const hashTotem = await bcrypt.hash('000000', 10);
    await db.run(`INSERT INTO configuracoes (chave, valor) VALUES ('totem_senha_hash', ?)`, [hashTotem]);

    let ok = 0, falhou = 0;
    function checar(nome, condicao, detalhe) {
        if (condicao) { ok++; console.log('✅', nome); }
        else { falhou++; console.log('❌', nome, detalhe || ''); }
    }

    let res = await request('/api/auth/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'dono@empresa.com', senha: 'senha-admin-123' }) });
    let body = await res.json();
    const tokenAdmin = body.token;
    checar('Login admin OK', !!tokenAdmin);

    res = await request('/api/auth/totem/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha: '000000' }) });
    body = await res.json();
    const tokenTotem = body.token;
    checar('Login totem OK', !!tokenTotem);

    res = await request('/api/funcionarios', { headers: { 'x-totem-token': tokenTotem, Authorization: `Bearer ${tokenAdmin}` } });
    checar('GET /api/funcionarios com token totem -> 200', res.status === 200);

    res = await request('/api/funcionarios', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdmin}` }, body: JSON.stringify({ nome: 'Ana', emoji: '🧪', regime: 'CLT', horas_diarias: '8h', pin: '5555' }) });
    body = await res.json();
    const funcionarioId = body.id;
    checar('Cadastro de funcionário', res.status === 201);

    res = await request('/api/ponto', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-totem-token': tokenTotem }, body: JSON.stringify({ funcionario_id: funcionarioId, tipo: 'Entrada' }) });
    checar('Bater ponto (Entrada)', res.status === 200);

    // Endpoint novo do dashboard
    res = await request('/api/dashboard-resumo', { headers: { Authorization: `Bearer ${tokenAdmin}` } });
    body = await res.json();
    checar('GET /api/dashboard-resumo -> 200, com presentes=1', res.status === 200 && body.presentes === 1, JSON.stringify(body));
    checar('dashboard-resumo tem totalAtivos=1', body.totalAtivos === 1, JSON.stringify(body));
    checar('dashboard-resumo tem deFerias=0', body.deFerias === 0, JSON.stringify(body));

    // Sem token admin -> 401
    res = await request('/api/dashboard-resumo');
    checar('GET /api/dashboard-resumo sem token -> 401', res.status === 401);

    console.log('');
    console.log(`RESULTADO: ${ok} passaram, ${falhou} falharam`);
    process.exit(falhou > 0 ? 1 : 0);
}

main().catch((e) => { console.error('ERRO FATAL:', e); process.exit(1); });
