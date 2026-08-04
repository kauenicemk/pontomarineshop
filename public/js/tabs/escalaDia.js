import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml, primeiroNome, mesAtualISO } from '../utils.js';
import { confirmar } from '../confirmar.js';

/**
 * ESCALA DE DIA EXTRA — sábado e domingo.
 *
 * Sábado e domingo não fazem parte da jornada de todo mundo. Quem é escalado passa a
 * ter aquele dia como dia de trabalho, só ele e só naquela data.
 *
 * A lista de quem pode ser escalado é FILTRADA: num sábado só aparece quem não tem
 * sábado na jornada. Mostrar quem já trabalha todo sábado seria oferecer uma escala
 * que não muda nada — e ainda faria o gestor duvidar se precisava escalar ou não.
 *
 * As escalas ficam em gavetas por data. Ao longo dos meses a lista cresce muito, e uma
 * tabela corrida de 60 linhas não responde a pergunta que se faz aqui: "quem trabalha
 * no dia 8?".
 */

const ROTULOS_REGIME = { CLT: 'CLT', ESTAGIARIO: 'Estagiário', PJ: 'PJ' };
const ROTULOS_TIPO = { sabado: 'Sábado', domingo: 'Domingo' };

let funcionariosCache = [];
let diasDisponiveis = [];
let gavetasAbertas = new Set();

const dataBR = (iso) => String(iso || '').split('-').reverse().join('/');

function primeiroEUltimoDiaDoMes(mesISO) {
    const [ano, mes] = mesISO.split('-').map(Number);
    return { inicio: `${mesISO}-01`, fim: `${mesISO}-${String(new Date(ano, mes, 0).getDate()).padStart(2, '0')}` };
}

/**
 * Quem pode ser escalado nesta data.
 *   sábado  -> só quem NÃO tem sábado na jornada
 *   domingo -> todo mundo (domingo nunca faz parte da jornada de ninguém)
 */
function elegiveisPara(tipo) {
    if (tipo === 'domingo') return funcionariosCache;
    return funcionariosCache.filter((f) => !(f.jornada && f.jornada.sabado && f.jornada.sabado.trabalha));
}

function tipoDaData(dataISO) {
    const encontrado = diasDisponiveis.find((d) => d.data === dataISO);
    if (encontrado) return encontrado.tipo;
    const dow = new Date(`${dataISO}T12:00:00Z`).getUTCDay();
    return dow === 6 ? 'sabado' : dow === 0 ? 'domingo' : null;
}

/* ===================== Listagem em gavetas ===================== */

export async function carregarEscalaDia() {
    const mes = document.getElementById('escala-mes').value || mesAtualISO();
    const { inicio, fim } = primeiroEUltimoDiaDoMes(mes);
    const alvo = document.getElementById('lista-escala-dia');

    alvo.innerHTML = '<p class="texto-vazio">Carregando...</p>';

    let escalas;
    try {
        escalas = await api.listarEscalaDia(inicio, fim);
    } catch (e) {
        alvo.innerHTML = `<p style="color:var(--vermelho)">${escapeHtml(e.message)}</p>`;
        return;
    }

    document.getElementById('escala-contador-total').textContent = escalas.length;

    const porData = new Map();
    escalas.forEach((e) => {
        if (!porData.has(e.data)) porData.set(e.data, []);
        porData.get(e.data).push(e);
    });

    if (porData.size === 0) {
        alvo.innerHTML = '<p class="texto-vazio">Nenhum dia escalado neste mês.</p>';
        return;
    }

    alvo.innerHTML = [...porData.entries()].map(([data, pessoas]) => {
        const tipo = pessoas[0].tipo || tipoDaData(data);
        // Sem estado salvo, a primeira gaveta abre e as demais ficam fechadas: dá para
        // ver o conteúdo sem precisar clicar, e o mês inteiro cabe na tela.
        const aberta = gavetasAbertas.has(data) || (gavetasAbertas.size === 0 && data === [...porData.keys()][0]);

        return `
        <div class="gaveta-escala ${aberta ? 'aberta' : ''}" data-data="${data}">
            <button type="button" class="gaveta-escala-topo" data-toggle="${data}"
                    aria-expanded="${aberta}" aria-controls="gaveta-corpo-${data}">
                <span class="gaveta-escala-titulo">
                    <span class="badge-turno badge-${tipo}">${escapeHtml(ROTULOS_TIPO[tipo] || '')}</span>
                    ${dataBR(data)}
                </span>
                <span class="gaveta-escala-contagem">${pessoas.length} escalado(s)</span>
                <svg class="icone-svg gaveta-escala-seta" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="gaveta-escala-corpo" id="gaveta-corpo-${data}">
                <table>
                    <thead><tr><th>Colaborador</th><th>Regime</th><th>Observação</th><th></th></tr></thead>
                    <tbody>
                        ${pessoas.map((e) => `
                            <tr>
                                <td>${escapeHtml(e.emoji || '')} ${escapeHtml(primeiroNome(e.nome))}</td>
                                <td><span class="badge-turno">${escapeHtml(ROTULOS_REGIME[e.regime] || e.regime || '')}</span></td>
                                <td style="white-space:normal; color:var(--texto-mudo)">${escapeHtml(e.observacao || '—')}</td>
                                <td><button class="action-btn btn-remover-escala" data-id="${e.id}"
                                            style="border-color:var(--borda-perigo); color:var(--vermelho);">Remover</button></td>
                            </tr>`).join('')}
                    </tbody>
                </table>
                ${tipo === 'domingo'
                    ? '<p class="nota-gaveta">Domingo: não há atraso e o dia inteiro conta como hora extra de 100%. Faltar é registrado, mas não desconta.</p>'
                    : '<p class="nota-gaveta">Sábado: atraso e falta são registrados. Descontam para CLT; para estagiário ficam só no registro e as horas somam ao banco.</p>'}
            </div>
        </div>`;
    }).join('');

    alvo.querySelectorAll('[data-toggle]').forEach((btn) => {
        btn.addEventListener('click', () => alternarGaveta(btn.dataset.toggle));
    });
    alvo.querySelectorAll('.btn-remover-escala').forEach((btn) => {
        btn.addEventListener('click', () => removerEscala(btn.dataset.id));
    });
}

function alternarGaveta(data) {
    const gaveta = document.querySelector(`.gaveta-escala[data-data="${data}"]`);
    if (!gaveta) return;
    const abrindo = !gaveta.classList.contains('aberta');
    gaveta.classList.toggle('aberta', abrindo);
    gaveta.querySelector('[data-toggle]').setAttribute('aria-expanded', String(abrindo));
    if (abrindo) gavetasAbertas.add(data);
    else gavetasAbertas.delete(data);
}

async function removerEscala(id) {
    const ok = await confirmar(
        'Remover esta escala?',
        'Este dia deixa de ser dia de trabalho para o colaborador — nenhuma falta será gerada nele.',
        { textoConfirmar: 'Remover', perigo: true }
    );
    if (!ok) return;
    try {
        const resp = await api.removerEscalaDia(id);
        toast(resp.message, 'sucesso');
        carregarEscalaDia();
    } catch (e) {
        toast(e.message, 'erro');
    }
}

/* ===================== Formulário ===================== */

async function montarFormulario() {
    const seletorData = document.getElementById('escala-data');
    try {
        const [todos, resp] = await Promise.all([api.listarFuncionariosTodos(), api.proximosDiasEscalaveis()]);
        funcionariosCache = todos.filter((f) => f.ativo !== 0);
        diasDisponiveis = resp.dias || [];
    } catch (e) {
        document.getElementById('escala-funcionarios').innerHTML =
            `<p style="color:var(--vermelho)">${escapeHtml(e.message)}</p>`;
        return;
    }

    // Só sábados e domingos no seletor. O backend também recusa dia de semana, mas
    // oferecer apenas datas válidas evita o erro em vez de explicá-lo depois.
    seletorData.innerHTML = diasDisponiveis
        .map((d) => `<option value="${d.data}">${ROTULOS_TIPO[d.tipo]} — ${dataBR(d.data)}</option>`).join('');

    renderizarElegiveis();
}

function renderizarElegiveis() {
    const lista = document.getElementById('escala-funcionarios');
    const aviso = document.getElementById('escala-aviso-elegiveis');
    const tipo = tipoDaData(document.getElementById('escala-data').value);
    const elegiveis = elegiveisPara(tipo);

    aviso.textContent = tipo === 'sabado'
        ? 'Aparecem só os colaboradores que não trabalham naturalmente aos sábados.'
        : 'Domingo não faz parte da jornada de ninguém — todos podem ser escalados.';

    // Estagiários primeiro: são o caso mais frequente de escala eventual.
    const ordenados = elegiveis.slice().sort((a, b) => {
        const peso = (f) => (f.regime === 'ESTAGIARIO' ? 0 : 1);
        return peso(a) - peso(b) || a.nome.localeCompare(b.nome);
    });

    lista.innerHTML = ordenados.length
        ? ordenados.map((f) => `
            <label class="label-checkbox item-escala">
                <input type="checkbox" class="check-escala" value="${f.id}">
                <span>${escapeHtml(f.emoji || '')} ${escapeHtml(f.nome)}
                    <span class="badge-turno">${escapeHtml(ROTULOS_REGIME[f.regime] || f.regime || '')}</span></span>
            </label>`).join('')
        : '<p class="texto-vazio">Todos os colaboradores ativos já trabalham neste dia da semana.</p>';
}

async function salvarEscala() {
    const data = document.getElementById('escala-data').value;
    const observacao = document.getElementById('escala-observacao').value.trim();
    const erro = document.getElementById('escala-erro');
    const ids = [...document.querySelectorAll('.check-escala:checked')].map((c) => Number(c.value));

    erro.textContent = '';
    if (!data) { erro.textContent = 'Escolha o dia.'; return; }
    if (ids.length === 0) { erro.textContent = 'Selecione ao menos um colaborador.'; return; }

    const btn = document.getElementById('btn-salvar-escala');
    btn.disabled = true;
    try {
        const resp = await api.escalarDia({ funcionarios_ids: ids, data, observacao });
        toast(resp.message, 'sucesso');
        document.querySelectorAll('.check-escala').forEach((c) => { c.checked = false; });
        document.getElementById('escala-observacao').value = '';
        gavetasAbertas.add(data);   // a gaveta do dia que acabou de ser montado abre sozinha
        carregarEscalaDia();
    } catch (e) {
        erro.textContent = e.message;
    } finally {
        btn.disabled = false;
    }
}

export function iniciarEscalaDia() {
    const btn = document.getElementById('btn-salvar-escala');
    if (!btn || btn.dataset.iniciado) return;
    btn.dataset.iniciado = '1';

    const mesInput = document.getElementById('escala-mes');
    if (!mesInput.value) mesInput.value = mesAtualISO();

    btn.addEventListener('click', salvarEscala);
    document.getElementById('escala-data').addEventListener('change', renderizarElegiveis);
    document.getElementById('escala-mes').addEventListener('change', carregarEscalaDia);
    document.getElementById('btn-filtrar-escala').addEventListener('click', carregarEscalaDia);

    montarFormulario();
}
