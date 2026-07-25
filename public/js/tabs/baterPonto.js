import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml, primeiroNome, hojeISO, descreverErroCamera } from '../utils.js';
import { carregarModelos, detectarRosto } from '../faceRecognition.js';

let idFuncionarioSelecionado = null; // seleção manual no mural (fallback)
let ultimoPontoBatido = null;
let registrandoPonto = false;        // trava anti duplo-toque
let timerFecharSucesso = null;

let streamCamera = null;
let intervaloReconhecimento = null;
let idReconhecidoNoModal = null;
let estadoModal = 'fechado'; // 'fechado' | 'carregando' | 'procurando' | 'reconhecido' | 'registrando'

// Confirmação em múltiplos frames: só aceita um reconhecimento depois de bater a MESMA pessoa
// em frames consecutivos — evita que um frame ruim (ângulo estranho, luz baixa) confunda alguém.
const FRAMES_PARA_CONFIRMAR = 2;
let candidatoAtual = null;
let candidatoContagem = 0;

const ORDEM_PONTOS = ['Entrada', 'Saída Almoço', 'Retorno Almoço', 'Saída Final'];

/* ===================== Seleção manual + status do funcionário ===================== */

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
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.innerHTML = `
            <span class="emoji-v" aria-hidden="true">${escapeHtml(f.emoji)}</span>
            <span class="nome-v">${escapeHtml(primeiroNome(f.nome))}</span>
        `;
        const selecionar = () => selecionarFuncionario(f, card);
        card.addEventListener('click', selecionar);
        card.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selecionar(); } });
        mural.appendChild(card);
    });

    return funcionarios;
}

async function selecionarFuncionario(f, card) {
    idFuncionarioSelecionado = f.id;
    document.querySelectorAll('.cartao-colaborador').forEach((c) => c.classList.remove('selecionado'));
    card.classList.add('selecionado');

    // Banner com quem vai registrar
    document.getElementById('banner-selecionado-emoji').textContent = f.emoji;
    document.getElementById('banner-selecionado-nome').textContent = f.nome;
    document.getElementById('banner-selecionado-status').textContent = 'Consultando situação de hoje...';
    document.getElementById('banner-selecionado').classList.remove('escondido');
    document.getElementById('dica-registro').classList.add('escondido');

    // Libera os botões de registro
    document.querySelectorAll('#totem-bater-ponto .btn-ponto').forEach((b) => { b.disabled = false; });

    // Situação de hoje + sugestão do próximo registro (usa endpoint já existente)
    try {
        const dados = await api.meuHistorico(f.id);
        const { statusTexto, proximoTipo } = analisarSituacaoDeHoje(dados.registros || []);
        if (idFuncionarioSelecionado !== f.id) return; // trocou de pessoa nesse meio tempo
        document.getElementById('banner-selecionado-status').textContent = statusTexto;
        marcarSugestao(proximoTipo);
    } catch (_) {
        document.getElementById('banner-selecionado-status').textContent = 'Pronto para registrar';
        marcarSugestao(null);
    }
}

/** Interpreta os registros e devolve o status atual + o tipo de ponto esperado em seguida. */
function analisarSituacaoDeHoje(registros) {
    const hoje = hojeISO();
    const hojeBR = hoje.split('-').reverse().join('/');
    const deHoje = registros.filter((r) => r.data === hoje || r.data === hojeBR);

    // O último registro de hoje define o estado (a lista pode vir em qualquer ordem)
    let ultimo = null;
    deHoje.forEach((r) => {
        const idx = ORDEM_PONTOS.indexOf(r.tipo);
        if (idx >= 0 && (!ultimo || idx > ORDEM_PONTOS.indexOf(ultimo.tipo))) ultimo = r;
    });

    if (!ultimo) return { statusTexto: 'Nenhum registro hoje', proximoTipo: 'Entrada' };

    const hora = (ultimo.hora || '').substring(0, 5);
    switch (ultimo.tipo) {
        case 'Entrada': return { statusTexto: `Em expediente desde ${hora}`, proximoTipo: 'Saída Almoço' };
        case 'Saída Almoço': return { statusTexto: `Em intervalo desde ${hora}`, proximoTipo: 'Retorno Almoço' };
        case 'Retorno Almoço': return { statusTexto: `Em expediente — voltou do intervalo às ${hora}`, proximoTipo: 'Saída Final' };
        case 'Saída Final': return { statusTexto: `Expediente encerrado às ${hora}`, proximoTipo: null };
        default: return { statusTexto: 'Pronto para registrar', proximoTipo: null };
    }
}

function marcarSugestao(tipo) {
    document.querySelectorAll('#totem-bater-ponto .btn-ponto').forEach((b) => {
        b.classList.toggle('sugerido', !!tipo && b.dataset.tipo === tipo);
    });
}

function limparSelecao() {
    idFuncionarioSelecionado = null;
    document.querySelectorAll('.cartao-colaborador').forEach((c) => c.classList.remove('selecionado'));
    document.getElementById('banner-selecionado').classList.add('escondido');
    document.getElementById('dica-registro').classList.remove('escondido');
    document.querySelectorAll('#totem-bater-ponto .btn-ponto').forEach((b) => { b.disabled = true; b.classList.remove('sugerido'); });
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
    document.getElementById('btn-trocar-funcionario')?.addEventListener('click', limparSelecao);
}

// O totem já é um dispositivo autenticado (token), presencial e fixo na empresa — não precisa
// mais de um PIN pessoal extra pra marcação manual.
async function baterPontoManual(tipo) {
    if (!idFuncionarioSelecionado) {
        toast('Selecione seu nome no mural antes de marcar o ponto.', 'erro');
        return;
    }
    if (registrandoPonto) return; // já tem um registro em andamento

    registrandoPonto = true;
    const botoes = document.querySelectorAll('#totem-bater-ponto .btn-ponto');
    botoes.forEach((b) => { b.disabled = true; });

    const registro = await baterPonto(tipo, idFuncionarioSelecionado);
    registrandoPonto = false;

    if (!registro) {
        botoes.forEach((b) => { b.disabled = false; });
        return;
    }

    abrirModalConfirmacao(registro, tipo);
    limparSelecao();
    document.getElementById('busca-funcionario').value = '';
    document.querySelectorAll('#mural-funcionarios .cartao-colaborador').forEach((c) => { c.style.display = ''; });
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

/** Confirmação de sucesso — fecha sozinha depois de alguns segundos (totem compartilhado). */
function abrirModalConfirmacao(registro, tipo) {
    document.getElementById('modal-texto').innerHTML =
        `<b>${escapeHtml(registro.nome)}</b><br>${escapeHtml(tipo)} registrado às <b>${escapeHtml(registro.hora)}</b> (${escapeHtml(registro.data)})`;
    document.getElementById('modalPonto').style.display = 'flex';

    const contagem = document.getElementById('sucesso-contagem');
    let restante = 5;
    contagem.textContent = `Fechando em ${restante}s...`;

    clearInterval(timerFecharSucesso);
    timerFecharSucesso = setInterval(() => {
        restante -= 1;
        if (restante <= 0) {
            fecharModalSucesso();
        } else {
            contagem.textContent = `Fechando em ${restante}s...`;
        }
    }, 1000);
}

export function fecharModalSucesso() {
    clearInterval(timerFecharSucesso);
    timerFecharSucesso = null;
    document.getElementById('modalPonto').style.display = 'none';
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

/**
 * No totem, a câmera é a forma principal de identificação — mas o modal só abre sozinho
 * se o reconhecimento facial estiver realmente instalado. Sem os modelos, abrir um modal
 * só pra pessoa ler um aviso e fechar era uma etapa inútil a cada registro.
 */
export async function autoAbrirCamera() {
    if (estadoModal !== 'fechado') return;
    const modelosOk = await carregarModelos();
    if (!modelosOk) return; // fica direto na seleção manual, sem modal no caminho
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

/** Libera a câmera — chamado ao fechar o popup, ou sempre que a pessoa sai da aba "Registrar ponto". */
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
