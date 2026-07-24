import { api } from '../api.js';
import { escapeHtml } from '../utils.js';
import { abrirEspelho } from './espelho.js';

export function popularSeletor(funcionarios) {
    const sel = document.getElementById('select-f-hist');
    sel.innerHTML = '<option value="">Selecione seu perfil...</option>' +
        funcionarios.map((f) => `<option value="${f.id}">${escapeHtml(f.emoji)} ${escapeHtml(f.nome)} (${escapeHtml(f.regime)})</option>`).join('');
    sel.addEventListener('change', carregarHistoricoIndividual);
}

export async function carregarHistoricoIndividual() {
    const id = document.getElementById('select-f-hist').value;
    const dadosDiv = document.getElementById('dados-individuais');
    const tbody = document.getElementById('lista-historico-ind');

    if (!id) {
        dadosDiv.innerHTML = '';
        tbody.innerHTML = '';
        return;
    }

    const data = await api.meuHistorico(id);
    dadosDiv.innerHTML = `<h3>${escapeHtml(data.funcionario.emoji)} ${escapeHtml(data.funcionario.nome)}</h3>
        <p style="color:var(--text-muted)">Regime: <b>${escapeHtml(data.funcionario.regime)}</b> | Carga: <b>${escapeHtml(data.funcionario.horas_diarias)}</b></p>
        <button class="action-btn" id="btn-ver-meu-espelho" style="width:auto; padding:8px 16px;">📄 Ver / Imprimir Meu Espelho de Ponto</button>`;

    document.getElementById('btn-ver-meu-espelho').addEventListener('click', () => {
        abrirEspelho(id, data.funcionario.nome, (funcionarioId, inicio, fim) => api.meuRelatorioIndividual(funcionarioId, inicio, fim));
    });

    tbody.innerHTML = data.registros.length
        ? data.registros.map((r) => `<tr>
            <td>${escapeHtml(r.data)} ${escapeHtml(r.hora)}</td>
            <td><b>${escapeHtml(r.tipo)}</b></td>
            <td style="color:#f87171">${escapeHtml(r.justificativa || '---')}</td>
          </tr>`).join('')
        : '<tr><td colspan="3" style="color:var(--text-muted)">Nenhum registro ainda.</td></tr>';
}
