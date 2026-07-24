import { escapeHtml } from './utils.js';

let container = null;

function garantirContainer() {
    if (container) return container;
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
    return container;
}

/** tipo: 'sucesso' | 'erro' | 'info' */
export function toast(mensagem, tipo = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast-${tipo}`;
    el.innerHTML = escapeHtml(mensagem);
    garantirContainer().appendChild(el);

    requestAnimationFrame(() => el.classList.add('visivel'));

    setTimeout(() => {
        el.classList.remove('visivel');
        setTimeout(() => el.remove(), 300);
    }, 4000);
}
