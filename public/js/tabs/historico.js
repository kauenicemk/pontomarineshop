import { api } from '../api.js';
import { escapeHtml } from '../utils.js';
import { abrirEspelho } from './espelho.js';
import { pedirPin } from '../pin.js';

/**
 * "Meu Histórico" no totem. Como o tablet é compartilhado, só selecionar o nome não
 * pode liberar o histórico de ninguém — o PIN pessoal é pedido antes de mostrar
 * qualquer dado. A liberação vale só para a sessão atual da tela.
 */
let idLiberado = null;

export function popularSeletor(funcionarios) {
    const sel = document.getElementById('select-f-hist');
    sel.innerHTML = '<option value="">Selecione seu perfil...</option>' +
        funcionarios.map((f) => `<option value="${f.id}">${escapeHtml(f.emoji)} ${escapeHtml(f.nome)} (${escapeHtml(f.regime)})</option>`).join('');
    sel.addEventListener('change', carregarHistoricoIndividual);
}

function limparTela() {
    document.getElementById('dados-individuais').innerHTML = '';
    document.getElementById('lista-historico-ind').innerHTML = '';
}

export async function carregarHistoricoIndividual() {
    const sel = document.getElementById('select-f-hist');
    const id = sel.value;
    const dadosDiv = document.getElementById('dados-individuais');
    const tbody = document.getElementById('lista-historico-ind');

    if (!id) {
        idLiberado = null;
        limparTela();
        return;
    }

    // Pede o PIN uma vez por pessoa selecionada.
    if (idLiberado !== id) {
        const nome = sel.selectedOptions[0]?.textContent || 'este colaborador';
        const liberado = await pedirPin(id, nome);
        if (!liberado) {
            sel.value = '';
            idLiberado = null;
            limparTela();
            return;
        }
        idLiberado = id;
    }

    dadosDiv.innerHTML = '<p class="texto-vazio">Carregando...</p>';

    let data;
    try {
        data = await api.meuHistorico(id);
    } catch (e) {
        dadosDiv.innerHTML = `<p style="color:var(--vermelho)">${escapeHtml(e.message)}</p>`;
        return;
    }

    dadosDiv.innerHTML = `
        <h3>${escapeHtml(data.funcionario.emoji)} ${escapeHtml(data.funcionario.nome)}</h3>
        <p style="color:var(--texto-mudo)">Regime: <b>${escapeHtml(data.funcionario.regime)}</b> | Carga: <b>${escapeHtml(data.funcionario.horas_diarias)}</b></p>
        <button class="action-btn" id="btn-ver-meu-espelho">Ver / Imprimir meu espelho de ponto</button>`;

    document.getElementById('btn-ver-meu-espelho').addEventListener('click', () => {
        abrirEspelho(id, data.funcionario.nome, (funcionarioId, inicio, fim) => api.meuRelatorioIndividual(funcionarioId, inicio, fim));
    });

    tbody.innerHTML = data.registros.length
        ? data.registros.map((r) => `<tr>
            <td>${escapeHtml(r.data)} ${escapeHtml(r.hora)}</td>
            <td><b>${escapeHtml(r.tipo)}</b></td>
            <td style="color:var(--texto-mudo)">${escapeHtml(r.justificativa || '---')}</td>
          </tr>`).join('')
        : '<tr><td colspan="3" class="texto-vazio">Nenhum registro ainda.</td></tr>';
}

/** Chamado ao sair da aba — a próxima consulta exige o PIN de novo. */
export function bloquearHistorico() {
    idLiberado = null;
    const sel = document.getElementById('select-f-hist');
    if (sel) sel.value = '';
    limparTela();
}
