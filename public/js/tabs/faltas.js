import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml, primeiroNome, mesAtualISO } from '../utils.js';
import { comAutorizacao } from '../adminGate.js';

let funcionariosCache = [];

export function setFuncionarios(funcionarios) {
    funcionariosCache = funcionarios;
    const mesInput = document.getElementById('faltas-mes');
    if (mesInput && !mesInput.value) mesInput.value = mesAtualISO();
}

function primeiroEUltimoDiaDoMes(mesISO) {
    const [ano, mes] = mesISO.split('-').map(Number);
    const inicio = `${mesISO}-01`;
    const ultimoDia = new Date(ano, mes, 0).getDate();
    const fim = `${mesISO}-${String(ultimoDia).padStart(2, '0')}`;
    return { inicio, fim };
}

export async function carregarFaltas() {
    const mesInput = document.getElementById('faltas-mes').value || mesAtualISO();
    const { inicio, fim } = primeiroEUltimoDiaDoMes(mesInput);
    const tbody = document.getElementById('lista-faltas');
    tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text-muted)">Calculando...</td></tr>';

    let resultado;
    try {
        resultado = await comAutorizacao(() => api.calcularFaltas(inicio, fim));
    } catch (e) {
        tbody.innerHTML = e.message === 'cancelado' ? '' : `<tr><td colspan="4" style="color:#f87171">${escapeHtml(e.message)}</td></tr>`;
        return;
    }

    tbody.innerHTML = resultado.faltas.length
        ? resultado.faltas.map((f) => `
            <tr>
                <td>${escapeHtml(f.emoji)} ${escapeHtml(primeiroNome(f.nome))}</td>
                <td>${escapeHtml(f.data.split('-').reverse().join('/'))}</td>
                <td style="color:#f87171">Falta não justificada</td>
                <td><button class="action-btn btn-justificar" data-fid="${f.funcionario_id}" data-data="${f.data}" style="width:auto; padding:4px 10px; margin:0;">Justificar</button></td>
            </tr>`).join('')
        : `<tr><td colspan="4" style="color:#4ade80">Nenhuma falta não justificada em ${resultado.totalDiasUteisNoPeriodo} dias úteis analisados. ✅</td></tr>`;

    tbody.querySelectorAll('.btn-justificar').forEach((btn) => {
        btn.addEventListener('click', () => abrirJustificativa(btn.dataset.fid, btn.dataset.data));
    });
}

function abrirJustificativa(funcionarioId, data) {
    const modal = document.getElementById('modalJustificarAusencia');
    document.getElementById('justificar-funcionario-id').value = funcionarioId;
    document.getElementById('justificar-data').value = data;
    document.getElementById('justificar-texto-info').textContent = `Data: ${data.split('-').reverse().join('/')}`;
    modal.style.display = 'flex';
}

export async function confirmarJustificativa() {
    const funcionario_id = document.getElementById('justificar-funcionario-id').value;
    const data = document.getElementById('justificar-data').value;
    const tipo = document.getElementById('justificar-tipo').value;
    const justificativa = document.getElementById('justificar-observacao').value;

    try {
        await comAutorizacao(() => api.justificarAusencia({ funcionario_id, data, tipo, justificativa }));
        toast('Ausência justificada com sucesso!', 'sucesso');
        document.getElementById('modalJustificarAusencia').style.display = 'none';
        carregarFaltas();
    } catch (e) {
        if (e.message !== 'cancelado') toast(e.message, 'erro');
    }
}
