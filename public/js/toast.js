import { escapeHtml } from './utils.js';

let container = null;

function garantirContainer() {
    if (container) return container;
    container = document.getElementById('toast-container') || document.createElement('div');
    container.id = 'toast-container';
    if (!container.parentElement) document.body.appendChild(container);
    return container;
}

const ICONES = { sucesso: '✓', erro: '✕', info: 'ℹ' };

/** tipo: 'sucesso' | 'erro' | 'info' */
export function toast(mensagem, tipo = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast-${tipo}`;
    el.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
    el.innerHTML = `<span class="toast-icone" aria-hidden="true">${ICONES[tipo] || ICONES.info}</span><span>${escapeHtml(mensagem)}</span>`;
    garantirContainer().appendChild(el);

    requestAnimationFrame(() => el.classList.add('visivel'));

    // Erros ficam um pouco mais na tela — a pessoa precisa de tempo pra ler o motivo
    const duracao = tipo === 'erro' ? 6000 : 4000;
    setTimeout(() => {
        el.classList.remove('visivel');
        setTimeout(() => el.remove(), 300);
    }, duracao);
}
