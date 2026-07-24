#!/usr/bin/env node
/**
 * Gera um certificado HTTPS autoassinado, válido para "localhost" e para o(s) IP(s) da rede
 * local do computador (o endereço que o celular usa pra acessar o servidor).
 *
 * Por que isso é necessário: navegadores só liberam a câmera (getUserMedia) em "contexto
 * seguro" — HTTPS, ou o endereço especial "localhost". Acessar pelo IP da rede (o jeito que o
 * celular acessa) por HTTP simples NÃO conta como seguro, então a câmera fica bloqueada. Um
 * certificado autoassinado resolve isso sem precisar comprar um certificado de verdade — o
 * navegador vai mostrar um aviso de "conexão não segura" na primeira vez (normal, é só clicar
 * em "Avançado > Continuar"), mas depois disso o site passa a contar como contexto seguro.
 *
 * Rodar (com internet disponível, só na primeira vez): npm run setup:https
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const DESTINO = path.join(RAIZ, 'ssl');

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

function main() {
    fs.mkdirSync(DESTINO, { recursive: true });

    console.log('Instalando gerador de certificado (pacote "selfsigned") temporariamente...');
    execSync('npm install selfsigned@1.10.14 --no-save', { stdio: 'inherit', cwd: RAIZ });

    // eslint-disable-next-line import/no-dynamic-require, global-require
    const selfsigned = require(path.join(RAIZ, 'node_modules', 'selfsigned'));

    const ips = listarIPsLocais();
    console.log('IPs da rede local encontrados:', ips.length ? ips.join(', ') : '(nenhum — só localhost vai funcionar)');

    const altNames = [
        { type: 2, value: 'localhost' }, // DNS
        { type: 7, ip: '127.0.0.1' },
        ...ips.map((ip) => ({ type: 7, ip }))
    ];

    const attrs = [{ name: 'commonName', value: 'localhost' }];
    const pems = selfsigned.generate(attrs, {
        days: 3650,
        keySize: 2048,
        extensions: [{ name: 'subjectAltName', altNames }]
    });

    fs.writeFileSync(path.join(DESTINO, 'cert.pem'), pems.cert);
    fs.writeFileSync(path.join(DESTINO, 'key.pem'), pems.private);

    console.log('');
    console.log('✅ Certificado gerado em ssl/cert.pem e ssl/key.pem');
    console.log('   Reinicie o servidor (npm start) — ele já sobe em HTTPS automaticamente.');
    console.log('   Endereços disponíveis:');
    console.log(`     - https://localhost:${process.env.PORT || 3000} (neste computador)`);
    ips.forEach((ip) => console.log(`     - https://${ip}:${process.env.PORT || 3000} (celular, mesma rede Wi-Fi)`));
}

try {
    main();
} catch (err) {
    console.error('❌ Não consegui gerar o certificado automaticamente:', err.message);
    console.error('   Alternativa manual: instale o mkcert (https://github.com/FiloSottile/mkcert)');
    console.error('   e rode: mkcert -key-file ssl/key.pem -cert-file ssl/cert.pem localhost 127.0.0.1 SEU_IP_LOCAL');
    process.exit(1);
}
