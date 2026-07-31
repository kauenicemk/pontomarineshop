import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml, primeiroNome, mesAtualISO } from '../utils.js';
import { confirmar } from '../confirmar.js';

/**
 * ESCALA DE SÁBADO.
 *
 * Estagiário não tem sábado na jornada contratual — vem quando é escalado, seja por
 * necessidade da loja, seja porque ele quer acumular banco de horas. Por isso a escala
 * é por data, e não uma chave "trabalha aos sábados": cada sábado é uma decisão.
 *
 * Escalado e não veio: gera falta no relatório (compromisso é compromisso), mas essa
 * falta não desconta na folha. Sábado sem escala não gera falta nenhuma.
 */

const ROTULOS_REGIME = { CLT: 'CLT', ESTAGIARIO: 'Estagiário', PJ: 'PJ' };

let funcionariosCache = [];
let sabadosDisponiveis = [];

const dataBR = (iso) => String(iso || '').split('-').reverse().join('/');

function primeiroEUltimoDiaDoMes(mesISO) {
    const [ano, mes] = mesISO.split('-').map(Number);
    return { inicio: `${mesISO}-01`, fim: `${mesISO}-${String(new Date(ano, mes, 0).getDate()).padStart(2, '0')}` };
}

/* ===================== Carregamento ===================== */

export async function carregarEscalaSabado() {
    const mes = document.getElementById('escala-mes').value || mesAtualISO();
    const { inicio, fim } = primeiroEUltimoDiaDoMes(mes);
    const tbody = document.getElementById('lista-escala-sabado');

    tbody.innerHTML = '<tr><td colspan="5" class="texto-vazio">Carregando...</td></tr>';

    let escalas;
    try {
        escalas = await api.listarEscalaSabado(inicio, fim);
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="5" style="color:var(--vermelho)">${escapeHtml(e.message)}</td></tr>`;
        return;
    }

    document.getElementById('escala-contador-total').textContent = escalas.length;

    // Agrupa por sábado: é assim que a escala é lida na prática ("quem trabalha dia 8?"),
    // não como uma lista solta de pessoas e datas.
    const porSabado = new Map();
    escalas.forEach((e) => {
        if (!porSabado.has(e.data)) porSabado.set(e.data, []);
        porSabado.get(e.data).push(e);
    });

    if (porSabado.size === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="texto-vazio">Nenhum sábado escalado neste mês.</td></tr>';
        return;
    }

    tbody.innerHTML = [...porSabado.entries()].map(([data, pessoas]) => `
        <tr class="linha-grupo"><td colspan="5"><b>Sábado, ${dataBR(data)}</b> — ${pessoas.length} escalado(s)</td></tr>
        ${pessoas.map((e) => `
            <tr>
                <td></td>
                <td>${escapeHtml(e.emoji || '')} ${escapeHtml(primeiroNome(e.nome))}
                    <span class="badge-turno">${escapeHtml(ROTULOS_REGIME[e.regime] || e.regime || '')}</span></td>
                <td>${dataBR(e.data)}</td>
                <td style="white-space:normal; color:var(--texto-mudo)">${escapeHtml(e.observacao || '—')}</td>
                <td><button class="action-btn btn-remover-escala" data-id="${e.id}"
                            style="border-color:var(--borda-perigo); color:var(--vermelho);">Remover</button></td>
            </tr>`).join('')}
    `).join('');

    tbody.querySelectorAll('.btn-remover-escala').forEach((btn) => {
        btn.addEventListener('click', () => removerEscala(btn.dataset.id));
    });
}

async function removerEscala(id) {
    const ok = await confirmar(
        'Remover esta escala?',
        'Este sábado deixa de ser dia de trabalho para o colaborador — nenhuma falta será gerada nele.',
        { textoConfirmar: 'Remover', perigo: true }
    );
    if (!ok) return;
    try {
        const resp = await api.removerEscalaSabado(id);
        toast(resp.message, 'sucesso');
        carregarEscalaSabado();
    } catch (e) {
        toast(e.message, 'erro');
    }
}

/* ===================== Formulário de escala ===================== */

async function montarFormulario() {
    const seletorData = document.getElementById('escala-data');
    const lista = document.getElementById('escala-funcionarios');

    try {
        const [todos, resp] = await Promise.all([api.listarFuncionariosTodos(), api.proximosSabados()]);
        funcionariosCache = todos.filter((f) => f.ativo !== 0);
        sabadosDisponiveis = resp.sabados || [];
    } catch (e) {
        lista.innerHTML = `<p style="color:var(--vermelho)">${escapeHtml(e.message)}</p>`;
        return;
    }

    // Só sábados no seletor: escalar alguém numa terça criaria um dia com regra de falta
    // não descontável no meio da jornada normal. O backend também recusa, mas oferecer
    // apenas datas válidas evita o erro em vez de explicá-lo depois.
    seletorData.innerHTML = sabadosDisponiveis
        .map((d) => `<option value="${d}">${dataBR(d)}</option>`).join('');

    // Estagiários primeiro: são o caso de uso, mas qualquer um pode ser escalado.
    const ordenados = funcionariosCache.slice().sort((a, b) => {
        const pesoA = a.regime === 'ESTAGIARIO' ? 0 : 1;
        const pesoB = b.regime === 'ESTAGIARIO' ? 0 : 1;
        return pesoA - pesoB || a.nome.localeCompare(b.nome);
    });

    lista.innerHTML = ordenados.length
        ? ordenados.map((f) => `
            <label class="label-checkbox item-escala">
                <input type="checkbox" class="check-escala" value="${f.id}">
                <span>${escapeHtml(f.emoji || '')} ${escapeHtml(f.nome)}
                    <span class="badge-turno">${escapeHtml(ROTULOS_REGIME[f.regime] || f.regime || '')}</span></span>
            </label>`).join('')
        : '<p class="texto-vazio">Nenhum colaborador ativo.</p>';
}

async function salvarEscala() {
    const data = document.getElementById('escala-data').value;
    const observacao = document.getElementById('escala-observacao').value.trim();
    const erro = document.getElementById('escala-erro');
    const ids = [...document.querySelectorAll('.check-escala:checked')].map((c) => Number(c.value));

    erro.textContent = '';
    if (!data) { erro.textContent = 'Escolha o sábado.'; return; }
    if (ids.length === 0) { erro.textContent = 'Selecione ao menos um colaborador.'; return; }

    const btn = document.getElementById('btn-salvar-escala');
    btn.disabled = true;
    try {
        const resp = await api.escalarSabado({ funcionarios_ids: ids, data, observacao });
        toast(resp.message, 'sucesso');
        document.querySelectorAll('.check-escala').forEach((c) => { c.checked = false; });
        document.getElementById('escala-observacao').value = '';
        carregarEscalaSabado();
    } catch (e) {
        erro.textContent = e.message;
    } finally {
        btn.disabled = false;
    }
}

export function iniciarEscalaSabado() {
    const btn = document.getElementById('btn-salvar-escala');
    if (!btn || btn.dataset.iniciado) return;
    btn.dataset.iniciado = '1';

    const mesInput = document.getElementById('escala-mes');
    if (!mesInput.value) mesInput.value = mesAtualISO();

    btn.addEventListener('click', salvarEscala);
    document.getElementById('escala-mes').addEventListener('change', carregarEscalaSabado);
    document.getElementById('btn-filtrar-escala').addEventListener('click', carregarEscalaSabado);

    montarFormulario();
}
