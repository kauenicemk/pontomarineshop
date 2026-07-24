const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const os = require('os');

const config = require('./src/config');
const { migrar } = require('./src/db/migrate');
const app = require('./src/app');

const CAMINHO_CERT = path.join(__dirname, 'ssl', 'cert.pem');
const CAMINHO_KEY = path.join(__dirname, 'ssl', 'key.pem');

/** Lista os IPs da rede local do computador — é o endereço que o celular usa pra acessar o servidor. */
function listarIPsLocais() {
    const ips = [];
    const interfaces = os.networkInterfaces();
    for (const nome of Object.keys(interfaces)) {
        for (const info of interfaces[nome] || []) {
            if (info.family === 'IPv4' && !info.internal) ips.push(info.address);
        }
    }
    return ips;
}

async function iniciar() {
    await migrar();

    const temCertificado = fs.existsSync(CAMINHO_CERT) && fs.existsSync(CAMINHO_KEY);
    const ips = listarIPsLocais();

    if (temCertificado) {
        const opcoes = { cert: fs.readFileSync(CAMINHO_CERT), key: fs.readFileSync(CAMINHO_KEY) };
        https.createServer(opcoes, app).listen(config.port, () => {
            console.log(`✅ Servidor HTTPS rodando em https://localhost:${config.port}`);
            if (ips.length) {
                console.log(`   Pelo celular (mesma rede Wi-Fi): ${ips.map((ip) => `https://${ip}:${config.port}`).join(' ou ')}`);
                console.log('   Na primeira vez, o navegador vai avisar que o certificado não é confiável');
                console.log('   (normal para certificado auto-assinado) — toque em "Avançado" > "Continuar".');
            }
            console.log(`   Banco de dados: ${config.dbPath}`);
            console.log(`   Ambiente: ${config.nodeEnv}`);
        });
    } else {
        http.createServer(app).listen(config.port, () => {
            console.log(`✅ Servidor HTTP rodando em http://localhost:${config.port}`);
            console.log(`   Banco de dados: ${config.dbPath}`);
            console.log(`   Ambiente: ${config.nodeEnv}`);
            console.log('');
            console.log('   ⚠️  Reconhecimento facial pelo CELULAR precisa de HTTPS (câmera só é liberada');
            console.log('       em conexão segura). Rode "npm run setup:https" para gerar um certificado');
            console.log('       local e habilitar isso automaticamente. Veja o README para detalhes.');
        });
    }
}

iniciar().catch((err) => {
    console.error('❌ Falha ao iniciar o servidor:', err);
    process.exit(1);
});

// Handlers globais — nunca deixar o processo cair silenciosamente sem log.
process.on('uncaughtException', (err) => console.error('❌ Erro não tratado:', err));
process.on('unhandledRejection', (err) => console.error('❌ Promise rejeitada sem tratamento:', err));
