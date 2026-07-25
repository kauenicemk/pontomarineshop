import { api } from '../api.js';
import { escapeHtml } from '../utils.js';

/** Card clicável — leva direto pra aba onde o administrador vê os detalhes. */
function cartao(valor, rotulo, cor, abaDestino) {
    return `
        <button type="button" class="cartao-resumo-dia cor-${cor}" data-aba-destino="${abaDestino}" title="Ver detalhes">
            <span class="valor">${escapeHtml(String(valor))}</span>
            <span class="rotulo">${escapeHtml(rotulo)}</span>
        </button>`;
}

function formatarMinutos(min) {
    if (!min) return '0h00';
    return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

export async function carregarDashboard() {
    const container = document.getElementById('dashboard-resumo-dia');
    const dataEl = document.getElementById('dashboard-data');

    // Skeleton só na primeira carga — nas atualizações automáticas mantém o conteúdo na tela
    if (!container.querySelector('.cartao-resumo-dia')) {
        container.innerHTML = Array(8).fill('<div class="skeleton"></div>').join('');
    }

    let r;
    try {
        r = await api.resumoDoDia();
    } catch (e) {
        container.innerHTML = `<p style="color:#ef4444">${escapeHtml(e.message)}</p>`;
        return;
    }

    dataEl.textContent = r.data.split('-').reverse().join('/');

    container.innerHTML = [
        cartao(r.presentes, 'Presentes agora', 'verde', 'pendencias'),
        cartao(r.emIntervalo, 'Em intervalo', 'amarelo', 'pendencias'),
        cartao(r.encerraramExpediente, 'Encerraram expediente', 'ouro', 'pendencias'),
        cartao(r.atrasados, 'Atrasados hoje', r.atrasados > 0 ? 'vermelho' : 'verde', 'pendencias'),
        cartao(r.aindaNaoChegaram, 'Ainda não bateram ponto', r.aindaNaoChegaram > 0 ? 'amarelo' : 'verde', 'pendencias'),
        cartao(formatarMinutos(r.horasExtraHojeMinutos), 'Horas extras hoje', 'ouro', 'banco-horas'),
        cartao(r.deFerias, 'De férias', 'azul', 'ferias'),
        cartao(r.totalAtivos, 'Colaboradores ativos', 'verde', 'config')
    ].join('');

    container.querySelectorAll('[data-aba-destino]').forEach((card) => {
        card.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('navegar-admin', { detail: card.dataset.abaDestino }));
        });
    });
}
