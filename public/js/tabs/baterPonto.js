import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml, primeiroNome, descreverErroCamera } from '../utils.js';
import { carregarModelos, detectarRosto } from '../faceRecognition.js';

let idFuncionarioSelecionado = null; // seleção manual no mural (fallback)
let ultimoPontoBatido = null;

let streamCamera = null;
let intervaloReconhecimento = null;
let idReconhecidoNoModal = null;
let estadoModal = 'fechado'; // 'fechado' | 'carregando' | 'procurando' | 'reconhecido' | 'registrando'

// Confirmação em múltiplos frames: só aceita um reconhecimento depois de bater a MESMA pessoa
// em frames consecutivos — evita que um frame ruim (ângulo estranho, luz baixa) confunda alguém.
const FRAMES_PARA_CONFIRMAR = 2;
let candidatoAtual = null;
let candidatoContagem = 0;

/* ===================== Mural manual (fallback, sem câmera) ===================== */

export async function carregarMuralFuncionarios() {
    const funcionarios = await api.listarFuncionarios();
    const mural = document.getElementById('mural-funcionarios');
    mural.innerHTML = '';

    if (funcionarios.length === 0) {
        mural.innerHTML = '<p class="texto-vazio">Nenhum funcionário cadastrado ainda. Peça ao administrador para cadastrar.</p>';
        return funcionarios;
    }

    funcionarios.forEach((f) => {
        const card = document.createElement('div');
        card.className = 'cartao-colaborador';
        card.id = `card-f-${f.id}`;
        card.innerHTML = `
            <span class="emoji-v">${escapeHtml(f.emoji)}</span>
            <span class="nome-v">${escapeHtml(primeiroNome(f.nome))}</span>
        `;
        card.addEventListener('click', () => {
            idFuncionarioSelecionado = f.id;
            document.querySelectorAll('.cartao-colaborador').forEach((c) => c.classList.remove('selecionado'));
            card.classList.add('selecionado');
        });
        mural.appendChild(card);
    });

    return funcionarios;
}

export function iniciarBusca() {
    const campo = document.getElementById('busca-funcionario');
    if (!campo) return;
    campo.addEventListener('input', () => {
        const termo = campo.value.trim().toLowerCase();
        document.querySelectorAll('#mural-funcionarios .cartao-colaborador').forEach((card) => {
            const nome = card.querySelector('.nome-v').textContent.toLowerCase();
            card.style.display = nome.includes(termo) ? '' : 'none';
        });
    });
}

export function iniciarBotoesDePonto() {
    document.querySelectorAll('.btn-ponto').forEach((btn) => {
        btn.addEventListener('click', () => baterPontoManual(btn.dataset.tipo));
    });
}

// O totem já é um dispositivo autenticado (token), presencial e fixo na empresa — não precisa
// mais de um PIN pessoal extra pra marcação manual (isso só fazia sentido quando existia a
// possibilidade de acesso remoto por celular pessoal, que não existe mais nesse desenho).
async function baterPontoManual(tipo) {
    if (!idFuncionarioSelecionado) {
        toast('Selecione seu nome no mural antes de marcar o ponto.', 'erro');
        return;
    }

    const registro = await baterPonto(tipo, idFuncionarioSelecionado);
    if (!registro) return;

    abrirModalConfirmacao(registro, tipo);
    idFuncionarioSelecionado = null;
    document.querySelectorAll('.cartao-colaborador').forEach((c) => c.classList.remove('selecionado'));
}

async function baterPonto(tipo, funcionarioId) {
    if (!funcionarioId) {
        toast('Selecione um funcionário antes de marcar o ponto.', 'erro');
        return null;
    }
    try {
        const { registro } = await api.baterPonto(funcionarioId, tipo);
        ultimoPontoBatido = registro;
        return registro;
    } catch (e) {
        toast(e.message, 'erro');
        return null;
    }
}

function abrirModalConfirmacao(registro, tipo) {
    document.getElementById('modal-texto').innerHTML =
        `<b>${escapeHtml(registro.nome)}</b><br>${escapeHtml(tipo)} registrado às ${escapeHtml(registro.hora)} (${escapeHtml(registro.data)})`;
    document.getElementById('modalPonto').style.display = 'flex';
}

export function getUltimoPontoBatido() {
    return ultimoPontoBatido;
}

/* ===================== Reconhecimento facial (identificação principal no totem) ===================== */

export function iniciarReconhecimentoFacial() {
    document.getElementById('btn-toggle-reconhecimento')?.addEventListener('click', () => {
        if (estadoModal === 'fechado') abrirModalCamera(); else fecharModalCamera();
    });
    document.getElementById('btn-fechar-camera-ponto')?.addEventListener('click', fecharModalCamera);
    document.getElementById('btn-selecionar-manualmente')?.addEventListener('click', fecharModalCamera);

    document.querySelectorAll('.btn-ponto-modal').forEach((btn) => {
        btn.addEventListener('click', () => registrarPontoNoModal(btn.dataset.tipo));
    });
}

/** No totem, a câmera é a forma principal de identificação — abre sozinha ao entrar na tela. */
export function autoAbrirCamera() {
    if (estadoModal === 'fechado') abrirModalCamera();
}

async function abrirModalCamera() {
    const modal = document.getElementById('modalCameraPonto');
    const video = document.getElementById('video-reconhecimento');
    const status = document.getElementById('status-reconhecimento');

    modal.style.display = 'flex';
    document.getElementById('reconhecimento-resultado').style.display = 'none';
    estadoModal = 'carregando';
    status.style.display = 'block';
    status.textContent = 'Carregando reconhecimento facial...';
    candidatoAtual = null;
    candidatoContagem = 0;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        status.textContent = 'A câmera precisa de conexão segura (HTTPS) — no Cloudflare Pages isso já vem automático. Use a seleção manual abaixo por enquanto.';
        return;
    }

    const modelosOk = await carregarModelos();
    if (!modelosOk) {
        status.textContent = 'Reconhecimento facial indisponível neste tablet. Use a seleção manual abaixo (veja o README para instalar).';
        return;
    }

    try {
        streamCamera = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 360 } }
        });
    } catch (e) {
        console.warn('Erro ao abrir câmera:', e);
        status.textContent = descreverErroCamera(e);
        return;
    }

    video.srcObject = streamCamera;
    await video.play();

    voltarParaBusca();
}

/** Volta o modal pro estado "procurando rosto" — usado ao abrir e depois de cada ponto registrado. */
function voltarParaBusca() {
    estadoModal = 'procurando';
    idReconhecidoNoModal = null;
    candidatoAtual = null;
    candidatoContagem = 0;
    document.getElementById('reconhecimento-resultado').style.display = 'none';
    document.getElementById('status-reconhecimento').textContent = 'Procurando um rosto conhecido...';
    limparContorno();

    clearInterval(intervaloReconhecimento);
    const video = document.getElementById('video-reconhecimento');
    intervaloReconhecimento = setInterval(() => tentarReconhecer(video), 1200);
}

function limparContorno() {
    const overlay = document.getElementById('overlay-reconhecimento');
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
}

/** Desenha o retângulo ao redor do rosto detectado, escalado do tamanho natural do vídeo pro tamanho exibido na tela. */
function desenharContorno(video, box, cor) {
    const overlay = document.getElementById('overlay-reconhecimento');
    if (!overlay || !video.videoWidth) return;

    overlay.width = video.clientWidth;
    overlay.height = video.clientHeight;
    const escalaX = video.clientWidth / video.videoWidth;
    const escalaY = video.clientHeight / video.videoHeight;

    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.strokeStyle = cor;
    ctx.lineWidth = 3;
    ctx.strokeRect(box.x * escalaX, box.y * escalaY, box.width * escalaX, box.height * escalaY);
}

async function tentarReconhecer(video) {
    if (estadoModal !== 'procurando') return;

    const deteccao = await detectarRosto(video);
    if (!deteccao) { limparContorno(); return; }

    desenharContorno(video, deteccao.box, '#d4af37');

    try {
        const resultado = await api.reconhecerRosto(deteccao.descriptor);

        if (candidatoAtual === resultado.funcionario_id) {
            candidatoContagem += 1;
        } else {
            candidatoAtual = resultado.funcionario_id;
            candidatoContagem = 1;
        }

        if (candidatoContagem >= FRAMES_PARA_CONFIRMAR) {
            desenharContorno(video, deteccao.box, '#22c55e');
            mostrarReconhecido(resultado);
        }
    } catch (e) {
        candidatoAtual = null;
        candidatoContagem = 0;
    }
}

function mostrarReconhecido(resultado) {
    estadoModal = 'reconhecido';
    idReconhecidoNoModal = resultado.funcionario_id;
    clearInterval(intervaloReconhecimento);

    document.getElementById('status-reconhecimento').style.display = 'none';
    document.getElementById('reconhecido-emoji').textContent = resultado.emoji;
    document.getElementById('reconhecido-nome').textContent = resultado.nome;
    document.getElementById('reconhecimento-resultado').style.display = 'block';
}

async function registrarPontoNoModal(tipo) {
    if (estadoModal !== 'reconhecido' || !idReconhecidoNoModal) return;
    estadoModal = 'registrando';

    const registro = await baterPonto(tipo, idReconhecidoNoModal);
    if (!registro) {
        estadoModal = 'reconhecido';
        return;
    }

    document.getElementById('reconhecimento-resultado').style.display = 'none';
    limparContorno();
    const status = document.getElementById('status-reconhecimento');
    status.style.display = 'block';
    status.textContent = `✅ ${tipo} registrado para ${registro.nome} às ${registro.hora}!`;

    setTimeout(() => {
        if (estadoModal === 'registrando') voltarParaBusca();
    }, 2000);
}

/** Libera a câmera — chamado ao fechar o popup, ou sempre que a pessoa sai da aba "Bater Ponto". */
export function pararReconhecimentoFacial() {
    clearInterval(intervaloReconhecimento);
    intervaloReconhecimento = null;

    if (streamCamera) {
        streamCamera.getTracks().forEach((t) => t.stop());
        streamCamera = null;
    }
    estadoModal = 'fechado';
    idReconhecidoNoModal = null;
    candidatoAtual = null;
    candidatoContagem = 0;
}

function fecharModalCamera() {
    pararReconhecimentoFacial();
    document.getElementById('modalCameraPonto').style.display = 'none';
}
