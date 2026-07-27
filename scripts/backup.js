#!/usr/bin/env node
/**
 * Backup do banco de produção (Cloudflare D1).
 *
 *   npm run backup
 *
 * Gera um arquivo .sql em backups/ com a data e a hora no nome. É um dump completo
 * (schema + dados) que pode ser restaurado com:
 *
 *   npx wrangler d1 execute <NOME_DO_BANCO> --remote --file=backups/<arquivo>.sql
 *
 * Recomendação: rodar antes de qualquer migração, antes de usar a "Zona de perigo"
 * e uma vez por semana. Guarde as cópias fora da máquina (drive, e-mail, pendrive).
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const PASTA_BACKUP = path.join(RAIZ, 'backups');

/** Lê o nome do banco direto do wrangler.toml para não duplicar essa informação. */
function nomeDoBanco() {
    const toml = fs.readFileSync(path.join(RAIZ, 'wrangler.toml'), 'utf8');
    const achado = toml.match(/database_name\s*=\s*"([^"]+)"/);
    if (!achado) {
        throw new Error('Não encontrei "database_name" no wrangler.toml.');
    }
    return achado[1];
}

function carimboDeTempo() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}h${p(d.getMinutes())}`;
}

/**
 * Caminho do wrangler instalado no projeto. Executamos o .js com o próprio Node em
 * vez de chamar `npx` — no Windows, o Node se recusa a executar arquivos .cmd/.bat
 * diretamente (proteção contra injeção de comando, CVE-2024-27980) e o spawn falha
 * com "EINVAL". Rodando o .js some o problema e ainda evita uma resolução via npx.
 */
function caminhoDoWrangler() {
    // Resolvemos pelo package.json porque o campo "exports" do wrangler impede
    // require.resolve('wrangler/bin/wrangler.js') diretamente.
    let raizDoPacote;
    try {
        raizDoPacote = path.dirname(require.resolve('wrangler/package.json', { paths: [RAIZ] }));
    } catch (_) {
        throw new Error('Wrangler não encontrado. Rode "npm install" primeiro.');
    }

    const binario = path.join(raizDoPacote, 'bin', 'wrangler.js');
    if (!fs.existsSync(binario)) {
        throw new Error(`Wrangler encontrado, mas sem o executável esperado em ${binario}.`);
    }
    return binario;
}

function principal() {
    const banco = nomeDoBanco();
    fs.mkdirSync(PASTA_BACKUP, { recursive: true });

    const destino = path.join(PASTA_BACKUP, `ponto-marine-shop_${carimboDeTempo()}.sql`);
    console.log(`Exportando o banco "${banco}"...`);

    execFileSync(
        process.execPath,
        [caminhoDoWrangler(), 'd1', 'export', banco, '--remote', `--output=${destino}`],
        { stdio: 'inherit', cwd: RAIZ }
    );

    const tamanhoKb = (fs.statSync(destino).size / 1024).toFixed(1);
    console.log(`\nBackup salvo em: ${path.relative(RAIZ, destino)} (${tamanhoKb} KB)`);
    console.log('Guarde uma cópia fora deste computador.');
}

try {
    principal();
} catch (erro) {
    console.error('\nFalha ao gerar o backup:', erro.message);
    console.error('Se for erro de autenticação, rode: npx wrangler login');
    process.exit(1);
}
