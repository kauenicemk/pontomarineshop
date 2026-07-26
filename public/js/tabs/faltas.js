import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml, primeiroNome, mesAtualISO } from '../utils.js';
import { comAutorizacao } from '../adminGate.js';
import { confirmar } from '../confirmar.js';
import { mapaDeTurnos, ROTULOS_TURNO } from '../turno.js';


let funcionariosCache = [];
let faltasCache = [];        // faltas do último cálculo (já filtradas por turno)
let turnosPorFuncionario = {};
let modoLote = false;        // o modal está justificando várias faltas de uma vez?

const ROTULOS_TIPO = {
    atestado: 'Atestado médico',
    ferias: 'Férias',
    licenca: 'Licença',
    folga: 'Folga',
    sem_justificativa: 'Falta confirmada'
};

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

function formatarDataBR(dataISO) {
    return dataISO.split('-').reverse().join('/');
}

/** Turnos vêm da jornada — busca a lista completa uma vez e reaproveita. */
async function garantirTurnos() {
    if (Object.keys(turnosPorFuncionario).length > 0) return turnosPorFuncionario;
    try {
        const todos = await api.listarFuncionariosTodos();
        turnosPorFuncionario = mapaDeTurnos(todos);
    } catch (_) {
        turnosPorFuncionario = {};
    }
    return turnosPorFuncionario;
}

/* ===================== Listagem ===================== */

export async function carregarFaltas() {
    const mesInput = document.getElementById('faltas-mes').value || mesAtualISO();
    const { inicio, fim } = primeiroEUltimoDiaDoMes(mesInput);
    const turnoFiltro = document.getElementById('faltas-turno')?.value || '';
    const tbody = document.getElementById('lista-faltas');
    const tbodyJustificadas = document.getElementById('lista-ausencias-justificadas');

    tbody.innerHTML = '<tr><td colspan="5" style="color:var(--texto-mudo)">Calculando...</td></tr>';

    let resultado;
    try {
        [resultado] = await Promise.all([comAutorizacao(() => api.calcularFaltas(inicio, fim)), garantirTurnos()]);
    } catch (e) {
        tbody.innerHTML = e.message === 'cancelado' ? '' : `<tr><td colspan="5" style="color:var(--vermelho)">${escapeHtml(e.message)}</td></tr>`;
        return;
    }

    faltasCache = resultado.faltas.filter((f) => !turnoFiltro || turnosPorFuncionario[f.funcionario_id] === turnoFiltro);

    renderizarFaltas(resultado.totalDiasUteisNoPeriodo, turnoFiltro);
    renderizarJustificadas(resultado.ausenciasJustificadas || [], tbodyJustificadas, turnoFiltro);
}

function renderizarFaltas(totalDiasUteis, turnoFiltro) {
    const tbody = document.getElementById('lista-faltas');
    const barra = document.getElementById('faltas-barra-lote');

    if (faltasCache.length === 0) {
        barra.classList.add('escondido');
        const complemento = turnoFiltro ? ` no turno ${ROTULOS_TURNO[turnoFiltro]}` : '';
        tbody.innerHTML = `<tr><td colspan="5" style="color:var(--verde)">Nenhuma falta não justificada${complemento} em ${totalDiasUteis} dia(s) útil(eis) analisado(s).</td></tr>`;
        return;
    }

    barra.classList.remove('escondido');
    tbody.innerHTML = faltasCache.map((f, i) => {
        const turno = turnosPorFuncionario[f.funcionario_id];
        return `
            <tr data-indice="${i}">
                <td><input type="checkbox" class="check-falta" data-indice="${i}" aria-label="Selecionar falta de ${escapeHtml(f.nome)} em ${formatarDataBR(f.data)}"></td>
                <td>
                    ${escapeHtml(f.emoji)} ${escapeHtml(primeiroNome(f.nome))}
                    ${turno ? `<span class="badge-turno">${escapeHtml(ROTULOS_TURNO[turno])}</span>` : ''}
                </td>
                <td>${formatarDataBR(f.data)}</td>
                <td style="color:var(--vermelho)">Falta não justificada</td>
                <td><button class="action-btn btn-justificar" data-indice="${i}">Justificar</button></td>
            </tr>`;
    }).join('');

    tbody.querySelectorAll('.btn-justificar').forEach((btn) => {
        btn.addEventListener('click', () => abrirJustificativaIndividual(Number(btn.dataset.indice)));
    });
    tbody.querySelectorAll('.check-falta').forEach((chk) => {
        chk.addEventListener('change', () => {
            chk.closest('tr').classList.toggle('selecionada', chk.checked);
            atualizarContadorSelecao();
        });
    });

    document.getElementById('faltas-selecionar-todos').checked = false;
    atualizarContadorSelecao();
}

function renderizarJustificadas(justificadas, tbody, turnoFiltro) {
    if (!tbody) return;
    const lista = justificadas.filter((a) => !turnoFiltro || turnosPorFuncionario[a.funcionario_id] === turnoFiltro);

    tbody.innerHTML = lista.length
        ? lista.map((a) => `
            <tr>
                <td>${escapeHtml(a.emoji || '')} ${escapeHtml(primeiroNome(a.nome || ''))}</td>
                <td>${formatarDataBR(a.data)}</td>
                <td style="color:var(--verde)">${escapeHtml(ROTULOS_TIPO[a.tipo] || a.tipo)}</td>
                <td style="color:var(--texto-mudo)">${escapeHtml(a.justificativa || '—')}</td>
            </tr>`).join('')
        : '<tr><td colspan="4" class="texto-vazio">Nenhuma ausência justificada no período.</td></tr>';
}

/* ===================== Seleção em massa ===================== */

function faltasSelecionadas() {
    return [...document.querySelectorAll('.check-falta:checked')].map((c) => faltasCache[Number(c.dataset.indice)]).filter(Boolean);
}

function atualizarContadorSelecao() {
    const total = faltasSelecionadas().length;
    const contador = document.getElementById('faltas-contador');
    const btn = document.getElementById('btn-justificar-lote');
    if (!contador || !btn) return;

    const pessoas = new Set(faltasSelecionadas().map((f) => f.funcionario_id)).size;
    contador.textContent = total === 0
        ? 'Nenhuma falta selecionada'
        : `${total} falta(s) de ${pessoas} colaborador(es) selecionada(s)`;
    btn.disabled = total === 0;
    btn.textContent = total === 0 ? 'Justificar selecionadas' : `Justificar ${total} selecionada(s)`;
}

export function iniciarAcoesEmLote() {
    const selecionarTodos = document.getElementById('faltas-selecionar-todos');
    const btnLote = document.getElementById('btn-justificar-lote');
    if (!selecionarTodos || !btnLote || btnLote.dataset.iniciado) return;
    btnLote.dataset.iniciado = '1';

    selecionarTodos.addEventListener('change', () => {
        document.querySelectorAll('.check-falta').forEach((chk) => {
            chk.checked = selecionarTodos.checked;
            chk.closest('tr').classList.toggle('selecionada', chk.checked);
        });
        atualizarContadorSelecao();
    });

    btnLote.addEventListener('click', () => abrirJustificativaEmLote());

    document.getElementById('faltas-turno')?.addEventListener('change', () => carregarFaltas());
}

/* ===================== Modal de justificativa ===================== */

function abrirJustificativaIndividual(indice) {
    const falta = faltasCache[indice];
    if (!falta) return;

    modoLote = false;
    document.getElementById('justificar-titulo').textContent = 'Justificar ausência';
    document.getElementById('justificar-funcionario-id').value = falta.funcionario_id;
    document.getElementById('justificar-data').value = falta.data;
    document.getElementById('justificar-texto-info').textContent =
        `${falta.nome} — ${formatarDataBR(falta.data)}`;
    document.getElementById('justificar-revisao').classList.add('escondido');
    document.getElementById('justificar-observacao').value = '';
    document.getElementById('modalJustificarAusencia').style.display = 'flex';
}

function abrirJustificativaEmLote() {
    const selecionadas = faltasSelecionadas();
    if (selecionadas.length === 0) return;

    modoLote = true;
    const pessoas = new Set(selecionadas.map((f) => f.funcionario_id)).size;

    document.getElementById('justificar-titulo').textContent = 'Justificar faltas em massa';
    document.getElementById('justificar-texto-info').textContent =
        `${selecionadas.length} falta(s) de ${pessoas} colaborador(es) receberão a mesma justificativa:`;

    // Revisão: deixa explícito QUEM será afetado antes de confirmar
    const revisao = document.getElementById('justificar-revisao');
    revisao.innerHTML = selecionadas.map((f) => `
        <div class="item-revisao">
            <span>${escapeHtml(f.emoji)} ${escapeHtml(f.nome)}</span>
            <span>${formatarDataBR(f.data)}</span>
        </div>`).join('');
    revisao.classList.remove('escondido');

    document.getElementById('justificar-observacao').value = '';
    document.getElementById('modalJustificarAusencia').style.display = 'flex';
}

export async function confirmarJustificativa() {
    const tipo = document.getElementById('justificar-tipo').value;
    const justificativa = document.getElementById('justificar-observacao').value.trim();
    const modal = document.getElementById('modalJustificarAusencia');

    if (!modoLote) {
        const funcionario_id = document.getElementById('justificar-funcionario-id').value;
        const data = document.getElementById('justificar-data').value;
        try {
            await comAutorizacao(() => api.justificarAusencia({ funcionario_id, data, tipo, justificativa }));
            toast('Ausência justificada.', 'sucesso');
            modal.style.display = 'none';
            carregarFaltas();
        } catch (e) {
            if (e.message !== 'cancelado') toast(e.message, 'erro');
        }
        return;
    }

    const selecionadas = faltasSelecionadas();
    if (selecionadas.length === 0) { modal.style.display = 'none'; return; }

    const pessoas = new Set(selecionadas.map((f) => f.funcionario_id)).size;
    const ok = await confirmar(
        `Justificar ${selecionadas.length} falta(s)?`,
        `${pessoas} colaborador(es) receberão a justificativa "${ROTULOS_TIPO[tipo] || tipo}". Faltas que já tiverem justificativa nessas datas serão atualizadas, não duplicadas.`,
        { textoConfirmar: 'Aplicar a todas' }
    );
    if (!ok) return;

    const btn = document.getElementById('btn-confirmar-justificativa');
    btn.disabled = true;
    try {
        const itens = selecionadas.map((f) => ({ funcionario_id: f.funcionario_id, data: f.data }));
        const resp = await comAutorizacao(() => api.justificarAusenciasEmLote({ itens, tipo, justificativa }));
        toast(resp.message, 'sucesso');
        modal.style.display = 'none';
        carregarFaltas();
    } catch (e) {
        if (e.message !== 'cancelado') toast(e.message, 'erro');
    } finally {
        btn.disabled = false;
    }
}
