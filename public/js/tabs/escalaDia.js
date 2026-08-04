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
 * A escolha do dia é um CALENDÁRIO, não uma lista de datas. Escala se pensa olhando o
 * mês ("preciso de gente no fim de semana do dia 8"), e o calendário mostra de uma vez
 * quais dias são escaláveis, quais já têm gente e quantos. Dias de semana aparecem
 * apagados e não clicáveis — a regra fica visível em vez de virar mensagem de erro.
 *
 * O mês do calendário também comanda a listagem abaixo: um controle só, sem o gestor
 * precisar manter dois seletores de período em sincronia.
 *
 * A lista de quem pode ser escalado é FILTRADA: num sábado só aparece quem não tem
 * sábado na jornada. Mostrar quem já trabalha todo sábado seria oferecer uma escala
 * que não muda nada — e ainda faria o gestor duvidar se precisava escalar ou não.
 */

const ROTULOS_REGIME = { CLT: 'CLT', ESTAGIARIO: 'Estagiário', PJ: 'PJ' };
const ROTULOS_TIPO = { sabado: 'Sábado', domingo: 'Domingo' };
const NOMES_MES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const INICIAIS_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

let funcionariosCache = [];
let escalasDoMes = [];
let gavetasAbertas = new Set();
let mesVisivel = mesAtualISO();     // 'YYYY-MM' — comanda calendário e listagem
let dataSelecionada = null;         // 'YYYY-MM-DD' escolhida no calendário

const dataBR = (iso) => String(iso || '').split('-').reverse().join('/');

/** Hoje em ISO, sem deixar o fuso do navegador virar o dia. */
function hojeISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function primeiroEUltimoDiaDoMes(mesISO) {
    const [ano, mes] = mesISO.split('-').map(Number);
    return { inicio: `${mesISO}-01`, fim: `${mesISO}-${String(new Date(ano, mes, 0).getDate()).padStart(2, '0')}` };
}

function somarMeses(mesISO, delta) {
    const [ano, mes] = mesISO.split('-').map(Number);
    const d = new Date(Date.UTC(ano, mes - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 'sabado' | 'domingo' | null — o tipo sai da própria data, igual ao backend. */
function tipoDaData(dataISO) {
    if (!dataISO) return null;
    const dow = new Date(`${dataISO}T12:00:00Z`).getUTCDay();
    return dow === 6 ? 'sabado' : dow === 0 ? 'domingo' : null;
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

/* ===================== Calendário ===================== */

/** Quantas pessoas já estão escaladas em cada data do mês carregado. */
function contagemPorData() {
    const mapa = new Map();
    escalasDoMes.forEach((e) => mapa.set(e.data, (mapa.get(e.data) || 0) + 1));
    return mapa;
}

function renderizarCalendario() {
    const alvo = document.getElementById('escala-calendario');
    if (!alvo) return;

    const [ano, mes] = mesVisivel.split('-').map(Number);
    const primeiroDiaSemana = new Date(Date.UTC(ano, mes - 1, 1)).getUTCDay();
    const diasNoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    const contagem = contagemPorData();
    const hoje = hojeISO();

    const celulas = [];
    // Casas vazias até o primeiro dia cair na coluna certa da semana.
    for (let i = 0; i < primeiroDiaSemana; i += 1) celulas.push('<span class="cal-vazio"></span>');

    for (let dia = 1; dia <= diasNoMes; dia += 1) {
        const iso = `${mesVisivel}-${String(dia).padStart(2, '0')}`;
        const tipo = tipoDaData(iso);
        const escalados = contagem.get(iso) || 0;

        // Dia de semana fica visível mas desabilitado: mostra a regra em vez de
        // deixar o gestor descobrir no erro que terça não vale.
        if (!tipo) {
            celulas.push(`<span class="cal-dia cal-dia-bloqueado" aria-hidden="true">${dia}</span>`);
            continue;
        }

        const classes = ['cal-dia', `cal-dia-${tipo}`];
        if (iso === dataSelecionada) classes.push('selecionado');
        if (iso === hoje) classes.push('hoje');
        if (escalados > 0) classes.push('tem-escala');
        if (iso < hoje) classes.push('passado');

        const titulo = escalados > 0
            ? `${ROTULOS_TIPO[tipo]} ${dataBR(iso)} — ${escalados} escalado(s)`
            : `${ROTULOS_TIPO[tipo]} ${dataBR(iso)} — ninguém escalado`;

        celulas.push(`
            <button type="button" class="${classes.join(' ')}" data-dia="${iso}"
                    aria-pressed="${iso === dataSelecionada}" title="${escapeHtml(titulo)}">
                <span class="cal-dia-numero">${dia}</span>
                ${escalados > 0 ? `<span class="cal-dia-marca">${escalados}</span>` : ''}
            </button>`);
    }

    alvo.innerHTML = `
        <div class="cal-topo">
            <button type="button" class="cal-nav" id="cal-anterior" aria-label="Mês anterior">
                <svg class="icone-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span class="cal-mes">${NOMES_MES[mes - 1]} de ${ano}</span>
            <button type="button" class="cal-nav" id="cal-proximo" aria-label="Próximo mês">
                <svg class="icone-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
        </div>
        <div class="cal-semana">${INICIAIS_SEMANA.map((i) => `<span>${i}</span>`).join('')}</div>
        <div class="cal-grade">${celulas.join('')}</div>
        <p class="cal-legenda">
            <span class="cal-ponto cal-ponto-sabado"></span> sábado
            <span class="cal-ponto cal-ponto-domingo"></span> domingo
            <span class="cal-legenda-nota">o número no canto é quanta gente já está escalada</span>
        </p>`;

    document.getElementById('cal-anterior').addEventListener('click', () => irParaMes(-1));
    document.getElementById('cal-proximo').addEventListener('click', () => irParaMes(1));
    alvo.querySelectorAll('[data-dia]').forEach((btn) => {
        btn.addEventListener('click', () => selecionarDia(btn.dataset.dia));
    });

    atualizarResumoDoDia();
}

function irParaMes(delta) {
    mesVisivel = somarMeses(mesVisivel, delta);
    // A seleção não sobrevive à troca de mês: escalar num dia que saiu da tela
    // seria fácil de fazer sem perceber.
    dataSelecionada = null;
    carregarEscalaDia();
}

function selecionarDia(iso) {
    dataSelecionada = dataSelecionada === iso ? null : iso;
    renderizarCalendario();
    renderizarElegiveis();
}

/** Cabeçalho do formulário: que dia está escolhido e qual regra vale nele. */
function atualizarResumoDoDia() {
    const alvo = document.getElementById('escala-dia-escolhido');
    if (!alvo) return;

    if (!dataSelecionada) {
        alvo.innerHTML = '<span class="texto-vazio">Escolha um sábado ou domingo no calendário.</span>';
        return;
    }

    const tipo = tipoDaData(dataSelecionada);
    const jaEscalados = escalasDoMes.filter((e) => e.data === dataSelecionada);

    alvo.innerHTML = `
        <span class="badge-turno badge-${tipo}">${ROTULOS_TIPO[tipo]}</span>
        <b>${dataBR(dataSelecionada)}</b>
        ${jaEscalados.length > 0
            ? `<span class="texto-vazio">— ${jaEscalados.length} já escalado(s)</span>`
            : ''}`;
}

/* ===================== Listagem em gavetas ===================== */

export async function carregarEscalaDia() {
    const { inicio, fim } = primeiroEUltimoDiaDoMes(mesVisivel);
    const alvo = document.getElementById('lista-escala-dia');

    alvo.innerHTML = '<p class="texto-vazio">Carregando...</p>';

    try {
        escalasDoMes = await api.listarEscalaDia(inicio, fim);
    } catch (e) {
        escalasDoMes = [];
        alvo.innerHTML = `<p style="color:var(--vermelho)">${escapeHtml(e.message)}</p>`;
        renderizarCalendario();
        return;
    }

    document.getElementById('escala-contador-total').textContent = escalasDoMes.length;
    document.getElementById('escala-mes-titulo').textContent =
        `${NOMES_MES[Number(mesVisivel.split('-')[1]) - 1]} de ${mesVisivel.split('-')[0]}`;

    renderizarCalendario();
    renderizarElegiveis();

    const porData = new Map();
    escalasDoMes.forEach((e) => {
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

function renderizarElegiveis() {
    const lista = document.getElementById('escala-funcionarios');
    const aviso = document.getElementById('escala-aviso-elegiveis');
    if (!lista) return;

    const tipo = tipoDaData(dataSelecionada);

    if (!tipo) {
        aviso.textContent = '';
        lista.innerHTML = '<p class="texto-vazio">Escolha um dia no calendário para ver quem pode ser escalado.</p>';
        return;
    }

    aviso.textContent = tipo === 'sabado'
        ? 'Aparecem só os colaboradores que não trabalham naturalmente aos sábados.'
        : 'Domingo não faz parte da jornada de ninguém — todos podem ser escalados.';

    // Quem já está escalado nesse dia não pode ser escalado de novo.
    const jaEscalados = new Set(escalasDoMes.filter((e) => e.data === dataSelecionada).map((e) => e.funcionario_id));

    // Estagiários primeiro: são o caso mais frequente de escala eventual.
    const ordenados = elegiveisPara(tipo).slice().sort((a, b) => {
        const peso = (f) => (f.regime === 'ESTAGIARIO' ? 0 : 1);
        return peso(a) - peso(b) || a.nome.localeCompare(b.nome);
    });

    lista.innerHTML = ordenados.length
        ? ordenados.map((f) => {
            const escalado = jaEscalados.has(f.id);
            return `
            <label class="label-checkbox item-escala ${escalado ? 'ja-escalado' : ''}">
                <input type="checkbox" class="check-escala" value="${f.id}" ${escalado ? 'disabled' : ''}>
                <span>${escapeHtml(f.emoji || '')} ${escapeHtml(f.nome)}
                    <span class="badge-turno">${escapeHtml(ROTULOS_REGIME[f.regime] || f.regime || '')}</span>
                    ${escalado ? '<span class="texto-vazio">já escalado</span>' : ''}</span>
            </label>`;
        }).join('')
        : '<p class="texto-vazio">Todos os colaboradores ativos já trabalham neste dia da semana.</p>';
}

async function salvarEscala() {
    const observacao = document.getElementById('escala-observacao').value.trim();
    const erro = document.getElementById('escala-erro');
    const ids = [...document.querySelectorAll('.check-escala:checked')].map((c) => Number(c.value));

    erro.textContent = '';
    if (!dataSelecionada) { erro.textContent = 'Escolha um sábado ou domingo no calendário.'; return; }
    if (ids.length === 0) { erro.textContent = 'Selecione ao menos um colaborador.'; return; }

    const btn = document.getElementById('btn-salvar-escala');
    btn.disabled = true;
    try {
        const resp = await api.escalarDia({ funcionarios_ids: ids, data: dataSelecionada, observacao });
        toast(resp.message, 'sucesso');
        document.getElementById('escala-observacao').value = '';
        gavetasAbertas.add(dataSelecionada);   // a gaveta do dia montado abre sozinha
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

    btn.addEventListener('click', salvarEscala);

    // O cadastro é buscado uma vez; a partir daí só o mês muda.
    api.listarFuncionariosTodos()
        .then((todos) => {
            funcionariosCache = todos.filter((f) => f.ativo !== 0);
            renderizarElegiveis();
        })
        .catch((e) => {
            document.getElementById('escala-funcionarios').innerHTML =
                `<p style="color:var(--vermelho)">${escapeHtml(e.message)}</p>`;
        });
}
