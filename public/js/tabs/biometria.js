import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml, descreverErroCamera } from '../utils.js';
import { comAutorizacao } from '../adminGate.js';
import { carregarModelos, capturarDescritor } from '../faceRecognition.js';

let streamAtivo = null;

async function iniciarCamera(videoEl) {
    streamAtivo = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
    videoEl.srcObject = streamAtivo;
    await videoEl.play();
}

function pararCamera() {
    if (streamAtivo) {
        streamAtivo.getTracks().forEach((t) => t.stop());
        streamAtivo = null;
    }
}

/** Chamado sempre que a pessoa sai da sub-aba "Biometria Facial" — libera a câmera. */
export function pararCameraAoSair() {
    pararCamera();
}

export async function renderizarAbaBiometria() {
    const container = document.getElementById('lista-biometria');
    container.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Carregando...</p>';

    let funcionarios, resumo, modelosOk;
    try {
        [funcionarios, resumo, modelosOk] = await Promise.all([
            comAutorizacao(() => api.listarFuncionariosTodos()),
            comAutorizacao(() => api.resumoBiometria()),
            carregarModelos()
        ]);
    } catch (e) {
        container.innerHTML = e.message === 'cancelado' ? '' : `<p style="color:#f87171">${escapeHtml(e.message)}</p>`;
        return;
    }

    if (!modelosOk) {
        container.innerHTML = `
            <p style="color:#f87171">
                Os arquivos do reconhecimento facial ainda não foram instalados neste servidor
                (pasta <code>public/vendor/face-api/</code> vazia ou ausente).
            </p>
            <p style="color:var(--text-muted); font-size:12.5px;">
                Rode <code>npm run setup:biometria</code> na pasta do projeto (com internet disponível)
                e recarregue esta página. Veja o README para detalhes.
            </p>`;
        return;
    }

    const totalPorFuncionario = {};
    resumo.forEach((r) => { totalPorFuncionario[r.funcionario_id] = r.total; });

    container.innerHTML = funcionarios.filter((f) => f.ativo).map((f) => `
        <div class="config-row-funcionario" data-id="${f.id}">
            <div class="config-row-cabecalho">
                <span><b>${escapeHtml(f.emoji)} ${escapeHtml(f.nome)}</b></span>
                <span class="badge-amostras">${totalPorFuncionario[f.id] || 0}/3 amostras cadastradas</span>
            </div>
            <video class="biometria-video" autoplay muted playsinline style="display:none;"></video>
            <p class="biometria-dica" style="display:none;">Centralize o rosto, boa iluminação, e clique em "Capturar amostra".</p>
            <div class="config-row-acoes">
                <button class="action-btn btn-abrir-camera" style="width:auto; padding:6px 12px; margin:0;">📷 Abrir câmera</button>
                <button class="action-btn btn-capturar-amostra" style="width:auto; padding:6px 12px; margin:0; display:none; background:var(--verde);">✅ Capturar amostra</button>
                <button class="action-btn btn-remover-biometria" style="width:auto; padding:6px 12px; margin:0; background:var(--vermelho);">🗑️ Remover amostras</button>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('.btn-abrir-camera').forEach((btn) => {
        btn.addEventListener('click', async (ev) => {
            const linha = ev.target.closest('.config-row-funcionario');
            const video = linha.querySelector('.biometria-video');
            try {
                await iniciarCamera(video);
                video.style.display = 'block';
                linha.querySelector('.biometria-dica').style.display = 'block';
                linha.querySelector('.btn-capturar-amostra').style.display = '';
                btn.style.display = 'none';
            } catch (e) {
                console.warn('Erro ao abrir câmera:', e);
                toast(descreverErroCamera(e), 'erro');
            }
        });
    });

    container.querySelectorAll('.btn-capturar-amostra').forEach((btn) => {
        btn.addEventListener('click', async (ev) => {
            const linha = ev.target.closest('.config-row-funcionario');
            const id = linha.dataset.id;
            const video = linha.querySelector('.biometria-video');

            const descritor = await capturarDescritor(video);
            if (!descritor) {
                toast('Não encontrei um rosto na imagem. Centralize o rosto e tente de novo.', 'erro');
                return;
            }

            try {
                const resp = await comAutorizacao(() => api.cadastrarBiometria(id, descritor));
                toast(resp.message, 'sucesso');
                pararCamera();
                renderizarAbaBiometria();
            } catch (e) {
                if (e.message !== 'cancelado') toast(e.message, 'erro');
            }
        });
    });

    container.querySelectorAll('.btn-remover-biometria').forEach((btn) => {
        btn.addEventListener('click', async (ev) => {
            const id = ev.target.closest('.config-row-funcionario').dataset.id;
            if (!confirm('Remover todas as amostras faciais desse funcionário? Ele vai parar de ser reconhecido pela câmera até cadastrar de novo.')) return;
            try {
                await comAutorizacao(() => api.removerBiometria(id));
                toast('Amostras removidas.', 'sucesso');
                renderizarAbaBiometria();
            } catch (e) {
                if (e.message !== 'cancelado') toast(e.message, 'erro');
            }
        });
    });
}
