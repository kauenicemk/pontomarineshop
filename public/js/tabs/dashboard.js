import { api } from '../api.js';
import { escapeHtml } from '../utils.js';

function cartao(valor, rotulo, icone, cor) {
    return `
        <div class="cartao-resumo-dia cor-${cor}">
            <span class="icone-resumo">${icone}</span>
            <span class="valor">${escapeHtml(String(valor))}</span>
            <span class="rotulo">${escapeHtml(rotulo)}</span>
        </div>`;
}

function formatarMinutos(min) {
    if (!min) return '0h00';
    return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

export async function carregarDashboard() {
    const container = document.getElementById('dashboard-resumo-dia');
    const dataEl = document.getElementById('dashboard-data');
    container.innerHTML = '<p class="texto-vazio">Carregando...</p>';

    let r;
    try {
        r = await api.resumoDoDia();
    } catch (e) {
        container.innerHTML = `<p style="color:#ef4444">${escapeHtml(e.message)}</p>`;
        return;
    }

    dataEl.textContent = r.data.split('-').reverse().join('/');

    container.innerHTML = [
        cartao(r.presentes, 'Presentes agora', '💼', 'verde'),
        cartao(r.emIntervalo, 'Em intervalo', '🥪', 'amarelo'),
        cartao(r.encerraramExpediente, 'Encerraram expediente', '🏁', 'ouro'),
        cartao(r.atrasados, 'Atrasados hoje', '⏰', r.atrasados > 0 ? 'vermelho' : 'verde'),
        cartao(r.aindaNaoChegaram, 'Ainda não bateram ponto', '❓', r.aindaNaoChegaram > 0 ? 'amarelo' : 'verde'),
        cartao(formatarMinutos(r.horasExtraHojeMinutos), 'Horas extras hoje', '📈', 'ouro'),
        cartao(r.deFerias, 'De férias', '🏖️', 'azul'),
        cartao(r.totalAtivos, 'Colaboradores ativos', '👥', 'verde')
    ].join('');
}
