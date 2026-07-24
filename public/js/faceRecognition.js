/**
 * Envolve a lib face-api.js (carregada de public/vendor/face-api/, NUNCA de CDN — mesmo motivo
 * do Banco de Horas: se a rede do local bloquear um CDN externo, a função para de funcionar
 * silenciosamente). Se os arquivos não tiverem sido instalados (ver README, seção Reconhecimento
 * Facial), este módulo simplesmente reporta "indisponível" e quem usa cai de volta pro fluxo
 * manual — o reconhecimento facial é sempre um atalho opcional, nunca um bloqueio.
 */

const CAMINHO_MODELOS = 'vendor/face-api/models';

let modelosCarregados = false;
let promessaCarregamento = null;

export function carregarModelos() {
    if (modelosCarregados) return Promise.resolve(true);
    if (promessaCarregamento) return promessaCarregamento;

    if (typeof window.faceapi === 'undefined') {
        console.warn('face-api.js não encontrado (public/vendor/face-api/face-api.min.js ausente). Reconhecimento facial desativado.');
        return Promise.resolve(false);
    }

    const faceapi = window.faceapi;
    promessaCarregamento = Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(CAMINHO_MODELOS),
        faceapi.nets.faceLandmark68Net.loadFromUri(CAMINHO_MODELOS),
        faceapi.nets.faceRecognitionNet.loadFromUri(CAMINHO_MODELOS)
    ]).then(() => {
        modelosCarregados = true;
        return true;
    }).catch((erro) => {
        console.warn('Não foi possível carregar os modelos de reconhecimento facial:', erro);
        return false;
    });

    return promessaCarregamento;
}

export function modelosProntos() {
    return modelosCarregados;
}

/**
 * Detecta um rosto no elemento de vídeo e devolve { descriptor, box }, ou null se não achou
 * nenhum rosto no frame atual. `box` vem nas dimensões NATURAIS do vídeo (videoWidth/videoHeight)
 * — quem desenha por cima precisa converter pra escala do elemento exibido na tela.
 */
export async function detectarRosto(videoEl) {
    if (!modelosCarregados || !videoEl || videoEl.readyState < 2) return null;

    const faceapi = window.faceapi;
    const deteccao = await faceapi
        .detectSingleFace(videoEl, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();

    if (!deteccao) return null;
    const { x, y, width, height } = deteccao.detection.box;
    return { descriptor: Array.from(deteccao.descriptor), box: { x, y, width, height } };
}

/**
 * Detecta um rosto no elemento de vídeo e devolve o descritor (array de 128 números),
 * ou null se não achou nenhum rosto no frame atual.
 */
export async function capturarDescritor(videoEl) {
    const resultado = await detectarRosto(videoEl);
    return resultado ? resultado.descriptor : null;
}
