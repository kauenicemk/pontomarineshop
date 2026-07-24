#!/usr/bin/env node
/**
 * Instala a lib face-api.js e os modelos de reconhecimento facial em public/vendor/face-api/.
 *
 * Por que este script é Node puro, e não bash/PowerShell:
 * - Precisa rodar igual em Windows, Mac e Linux, e vocês já têm Node instalado (é o motor do
 *   projeto inteiro) — não faz sentido depender de mais nada.
 *
 * Por que baixa direto do GitHub, e não só via "npm install face-api.js":
 * - O pacote publicado no npm só inclui a pasta dist/ (a biblioteca em si). Os modelos treinados
 *   (pasta weights/) só existem no repositório do GitHub, então eles são baixados de lá.
 *
 * Rodar (com internet disponível): npm run setup:biometria
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const DESTINO = path.join(__dirname, '..', 'public', 'vendor', 'face-api');
const DESTINO_MODELOS = path.join(DESTINO, 'models');

const REPO_BASE = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master';

const ARQUIVOS_MODELOS = [
    'tiny_face_detector_model-weights_manifest.json',
    'tiny_face_detector_model-shard1',
    'face_landmark_68_model-weights_manifest.json',
    'face_landmark_68_model-shard1',
    'face_recognition_model-weights_manifest.json',
    'face_recognition_model-shard1',
    'face_recognition_model-shard2'
];

/** Baixa uma URL para um arquivo local, seguindo redirecionamentos se precisar. */
function baixar(url, destino, tentativasRestantes = 5) {
    return new Promise((resolve, reject) => {
        const arquivo = fs.createWriteStream(destino);

        https.get(url, (resposta) => {
            // Segue redirecionamento (ex: 301/302), comum em CDNs.
            if ([301, 302, 307, 308].includes(resposta.statusCode) && resposta.headers.location) {
                arquivo.close();
                fs.unlink(destino, () => {});
                if (tentativasRestantes <= 0) return reject(new Error(`Muitos redirecionamentos ao baixar ${url}`));
                return baixar(resposta.headers.location, destino, tentativasRestantes - 1).then(resolve, reject);
            }

            if (resposta.statusCode !== 200) {
                arquivo.close();
                fs.unlink(destino, () => {});
                return reject(new Error(`HTTP ${resposta.statusCode} ao baixar ${url}`));
            }

            resposta.pipe(arquivo);
            arquivo.on('finish', () => arquivo.close(() => resolve()));
        }).on('error', (err) => {
            fs.unlink(destino, () => {});
            reject(err);
        });
    });
}

async function main() {
    fs.mkdirSync(DESTINO_MODELOS, { recursive: true });

    console.log('Baixando a biblioteca face-api.js...');
    await baixar(`${REPO_BASE}/dist/face-api.min.js`, path.join(DESTINO, 'face-api.min.js'));

    for (const nome of ARQUIVOS_MODELOS) {
        console.log(`Baixando modelo: ${nome}`);
        await baixar(`${REPO_BASE}/weights/${nome}`, path.join(DESTINO_MODELOS, nome));
    }

    console.log('');
    console.log('✅ Pronto! Arquivos instalados em public/vendor/face-api/');
    console.log('   Reinicie o servidor (npm start) e recarregue a página. Ative o reconhecimento');
    console.log('   facial na aba Bater Ponto, ou cadastre amostras em Administração > Biometria Facial.');
}

main().catch((err) => {
    console.error('❌ Erro ao instalar os arquivos de reconhecimento facial:', err.message);
    console.error('   Verifique sua conexão com a internet (ou um firewall bloqueando o GitHub) e tente de novo.');
    process.exit(1);
});
