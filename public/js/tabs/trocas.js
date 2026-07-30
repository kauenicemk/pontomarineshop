import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml, mesAtualISO, hojeISO } from '../utils.js';
import { confirmar } from '../confirmar.js';

/**
 * TROCAS DE DIA — folga num dia compensada com trabalho em outro.
 * O efeito no cálculo está no backend (a jornada é movida de um dia para o outro);
 * aqui é só o cadastro e a consulta.
 */

const ROTULOS_REGIME = { CLT: 'CLT', ESTAGIARIO: 'Estagiário', PJ: 'PJ' };
const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

const dataBR = (iso) => String(iso || '').split('-').reverse().join('/');

/** "08/08/2026 (sábado)" — o dia da semana é o que dá sentido à troca. */
function dataComDiaSemana(iso) {
    if (!iso) return '---';
    const d = new Date(`${iso}T12:00:00Z`);
    return `${dataBR(iso)} (${DIAS_SEMANA[d.getUTCDay()]})`;
}

export function popularSeletorTrocas(funcionarios) {
    const sel = document.getElementById('troca-funcionario');
    if (!sel) return;
    const atual = sel.value;
    sel.innerHTML = '<option value="">Selecione...</option>' +
        funcionarios.map((f) => `<option value="${f.id}">${escapeHtml(f.nome)} · ${escapeHtml(ROTULOS_REGIME[f.regime] || f.regime)}</option>`).join('');
    if (atual) sel.value = atual;

    const mes = document.getElementById('trocas-mes');
    if (mes && !mes.value) mes.value = mesAtualISO();
    const folga = document.getElementById('troca-data-folga');
    if (folga && !folga.value) folga.value = hojeISO();
}

export async function carregarTrocas() {
    const tbody = document.getElementById('lista-trocas');
    const mes = document.getElementById('trocas-mes').value || mesAtualISO();
    const [ano, m] = mes.split('-').map(Number);
    const inicio = `${mes}-01`;
    const fim = `${mes}-${String(new Date(ano, m, 0).getDate()).padStart(2, '0')}`;

    tbody.innerHTML = '<tr><td colspan="6" class="texto-vazio">Carregando...</td></tr>';

    let lista;
    try {
        lista = await api.listarTrocas(inicio, fim);
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" style="color:var(--vermelho)">${escapeHtml(e.message)}</td></tr>`;
        return;
    }

    document.getElementById('trocas-contador').textContent = lista.length;

    tbody.innerHTML = lista.length
        ? lista.map((t) => `
            <tr>
                <td>${escapeHtml(t.emoji || '')} ${escapeHtml(t.nome)}</td>
                <td><span class="badge-turno">${escapeHtml(ROTULOS_REGIME[t.regime] || t.regime)}</span></td>
                <td style="color:var(--amarelo)">${escapeHtml(dataComDiaSemana(t.data_folga))}</td>
                <td style="color:var(--verde)">${escapeHtml(dataComDiaSemana(t.data_trabalho))}</td>
                <td style="white-space:normal; color:var(--texto-mudo)">${escapeHtml(t.observacao || '—')}</td>
                <td><button class="action-btn btn-remover-troca" data-id="${t.id}" data-nome="${escapeHtml(t.nome)}"
                            style="border-color:var(--borda-perigo); color:var(--vermelho);">Remover</button></td>
            </tr>`).join('')
        : '<tr><td colspan="6" class="texto-vazio">Nenhuma troca registrada neste mês.</td></tr>';

    tbody.querySelectorAll('.btn-remover-troca').forEach((btn) => {
        btn.addEventListener('click', () => removerTroca(btn.dataset.id, btn.dataset.nome));
    });
}

async function removerTroca(id, nome) {
    const ok = await confirmar(
        `Remover a troca de ${nome}?`,
        'A folga volta a contar como falta e o dia trabalhado volta a contar como hora extra.',
        { textoConfirmar: 'Remover', perigo: true }
    );
    if (!ok) return;
    try {
        const resp = await api.removerTroca(id);
        toast(resp.message, 'sucesso');
        carregarTrocas();
    } catch (e) {
        toast(e.message, 'erro');
    }
}

async function registrarTroca() {
    const funcionario_id = document.getElementById('troca-funcionario').value;
    const data_folga = document.getElementById('troca-data-folga').value;
    const data_trabalho = document.getElementById('troca-data-trabalho').value;
    const observacao = document.getElementById('troca-observacao').value.trim();

    if (!funcionario_id || !data_folga || !data_trabalho) {
        toast('Escolha o colaborador e as duas datas.', 'erro');
        return;
    }

    try {
        await api.criarTroca({ funcionario_id, data_folga, data_trabalho, observacao });
        toast('Troca registrada.', 'sucesso');
        document.getElementById('troca-observacao').value = '';
        document.getElementById('troca-data-trabalho').value = '';
        carregarTrocas();
    } catch (e) {
        toast(e.message, 'erro');
    }
}

export function iniciarTrocas() {
    const btn = document.getElementById('btn-registrar-troca');
    if (!btn || btn.dataset.iniciado) return;
    btn.dataset.iniciado = '1';
    btn.addEventListener('click', registrarTroca);
    document.getElementById('trocas-mes').addEventListener('change', carregarTrocas);
}
