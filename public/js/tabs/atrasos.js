import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml, primeiroNome, mesAtualISO } from '../utils.js';
import { confirmar } from '../confirmar.js';
import { mapaDeTurnos, ROTULOS_TURNO } from '../turno.js';

/**
 * ATRASOS — a lista vem do relatório calculado (não de uma tabela própria): atraso é
 * consequência do ponto batido, não um registro à parte. Aqui o gestor decide o que
 * fazer com cada um:
 *
 *   Abonar     -> combinou chegar mais tarde: o atraso sai do relatório e as horas
 *                 voltam ao saldo do dia
 *   Registrar  -> mantém o atraso, mas guarda o motivo (histórico de disciplina)
 *   Atestado   -> abona uma quantidade de minutos do dia
 *
 * Essa separação é o ponto central: justificar não é o mesmo que perdoar.
 */

const ROTULOS_REGIME = { CLT: 'CLT', ESTAGIARIO: 'Estagiário', PJ: 'PJ' };
const ROTULOS_TRATATIVA = {
    atraso_abonado: 'Abonado',
    atraso_registrado: 'Registrado (mantido)',
    atestado_horas: 'Atestado de horas'
};

let atrasosCache = [];
let turnosPorFuncionario = {};
let regimePorFuncionario = {};
let modoLote = false;
let modoAvulso = false;   // atestado lançado direto, sem partir de um atraso da lista
let alvoIndividual = null;
let cadastroAtivo = [];   // para o seletor do lançamento avulso

function primeiroEUltimoDiaDoMes(mesISO) {
    const [ano, mes] = mesISO.split('-').map(Number);
    return { inicio: `${mesISO}-01`, fim: `${mesISO}-${String(new Date(ano, mes, 0).getDate()).padStart(2, '0')}` };
}

const dataBR = (iso) => String(iso || '').split('-').reverse().join('/');

function minutosParaTexto(min) {
    if (!min) return '00:00';
    return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

async function garantirCadastro() {
    if (Object.keys(regimePorFuncionario).length > 0) return;
    try {
        const todos = await api.listarFuncionariosTodos();
        turnosPorFuncionario = mapaDeTurnos(todos);
        regimePorFuncionario = {};
        todos.forEach((f) => { regimePorFuncionario[f.id] = f.regime; });
        cadastroAtivo = todos.filter((f) => f.ativo !== 0);
    } catch (_) { /* filtros de turno/regime ficam sem efeito */ }
}

/* ===================== Carregamento ===================== */

export async function carregarAtrasos() {
    const mes = document.getElementById('atrasos-mes').value || mesAtualISO();
    const { inicio, fim } = primeiroEUltimoDiaDoMes(mes);
    const filtroRegime = document.getElementById('atrasos-regime').value;
    const filtroTurno = document.getElementById('atrasos-turno').value;
    const tbody = document.getElementById('lista-atrasos');

    tbody.innerHTML = '<tr><td colspan="8" class="texto-vazio">Buscando atrasos...</td></tr>';

    let dias, tratativas;
    try {
        [dias, tratativas] = await Promise.all([
            api.relatorioCalculado(inicio, fim),
            api.listarTratativas(inicio, fim),
            garantirCadastro()
        ]);
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="8" style="color:var(--vermelho)">${escapeHtml(e.message)}</td></tr>`;
        return;
    }

    // Só entram dias com atraso REAL (acima da tolerância) ou que já foram tratados —
    // um dia abonado precisa continuar visível para dar para desfazer a decisão.
    atrasosCache = dias
        // Qualquer atraso entra, inclusive o que nao desconta: e justamente o que o
        // gestor precisa enxergar para acompanhar pontualidade.
        .filter((d) => d.atrasoMinutos > 0 || d.tratativa)
        .filter((d) => !filtroRegime || (regimePorFuncionario[d.funcionarioId] || d.regime) === filtroRegime)
        .filter((d) => !filtroTurno || turnosPorFuncionario[d.funcionarioId] === filtroTurno)
        .sort((a, b) => b.dataISO.localeCompare(a.dataISO) || a.nome.localeCompare(b.nome));

    renderizarAtrasos();
    renderizarTratativas(tratativas, filtroRegime, filtroTurno);
}

function renderizarAtrasos() {
    const tbody = document.getElementById('lista-atrasos');
    const barra = document.getElementById('atrasos-barra-lote');
    document.getElementById('atrasos-contador-total').textContent = atrasosCache.length;

    if (atrasosCache.length === 0) {
        barra.classList.add('escondido');
        tbody.innerHTML = '<tr><td colspan="8" style="color:var(--verde)">Nenhum atraso no período — ou todos já estão dentro da tolerância.</td></tr>';
        return;
    }

    barra.classList.remove('escondido');
    tbody.innerHTML = atrasosCache.map((d, i) => {
        const tratada = d.tratativa;
        const situacao = tratada
            ? `<span style="color:${tratada.tipo === 'atraso_registrado' ? 'var(--amarelo)' : 'var(--verde)'}">
                   ${escapeHtml(ROTULOS_TRATATIVA[tratada.tipo] || tratada.tipo)}</span>
               ${tratada.motivo ? `<br><span style="color:var(--texto-mudo); font-size:11.5px;">${escapeHtml(tratada.motivo)}</span>` : ''}`
            : (d.atrasoDentroDoLimiar
                ? '<span style="color:var(--amarelo)">Registrado, sem desconto</span><br><span style="color:var(--texto-mudo); font-size:11.5px;">abaixo de 11 min no dia</span>'
                : '<span style="color:var(--vermelho)">Sem tratativa — descontando</span>');

        const atrasoMostrado = d.atraso;

        return `
            <tr data-indice="${i}">
                <td><input type="checkbox" class="check-atraso" data-indice="${i}"
                           aria-label="Selecionar atraso de ${escapeHtml(d.nome)} em ${dataBR(d.dataISO)}"></td>
                <td>${escapeHtml(d.emoji || '')} ${escapeHtml(primeiroNome(d.nome))}
                    <span class="badge-turno">${escapeHtml(ROTULOS_REGIME[regimePorFuncionario[d.funcionarioId] || d.regime] || '')}</span></td>
                <td>${dataBR(d.dataISO)}</td>
                <td>${escapeHtml(d.pontos.ENTRADA || '---')}</td>
                <td>${escapeHtml(d.horario_combinado || '---')}</td>
                <td style="color:${d.atrasoDescontavelMinutos > 0 ? 'var(--vermelho)' : (d.atrasoMinutos > 0 ? 'var(--amarelo)' : 'var(--texto-mudo)')}"><b>${escapeHtml(atrasoMostrado)}</b></td>
                <td style="white-space:normal">${situacao}</td>
                <td><button class="action-btn btn-tratar" data-indice="${i}">${tratada ? 'Alterar' : 'Justificar'}</button></td>
            </tr>`;
    }).join('');

    tbody.querySelectorAll('.btn-tratar').forEach((btn) => {
        btn.addEventListener('click', () => abrirTratativaIndividual(Number(btn.dataset.indice)));
    });
    tbody.querySelectorAll('.check-atraso').forEach((chk) => {
        chk.addEventListener('change', () => {
            chk.closest('tr').classList.toggle('selecionada', chk.checked);
            atualizarContador();
        });
    });

    document.getElementById('atrasos-selecionar-todos').checked = false;
    atualizarContador();
}

function renderizarTratativas(tratativas, filtroRegime, filtroTurno) {
    const tbody = document.getElementById('lista-tratativas');
    const lista = (tratativas || [])
        .filter((t) => !filtroRegime || t.regime === filtroRegime)
        .filter((t) => !filtroTurno || turnosPorFuncionario[t.funcionario_id] === filtroTurno);

    tbody.innerHTML = lista.length
        ? lista.map((t) => `
            <tr>
                <td>${escapeHtml(t.emoji || '')} ${escapeHtml(primeiroNome(t.nome))}</td>
                <td>${dataBR(t.data)}</td>
                <td style="color:${t.tipo === 'atraso_registrado' ? 'var(--amarelo)' : 'var(--verde)'}">${escapeHtml(ROTULOS_TRATATIVA[t.tipo] || t.tipo)}</td>
                <td>${t.minutos_abonados > 0 ? minutosParaTexto(t.minutos_abonados) : '—'}</td>
                <td style="white-space:normal; color:var(--texto-mudo)">${escapeHtml(t.motivo || '—')}</td>
                <td><button class="action-btn btn-remover-tratativa" data-id="${t.id}"
                            style="border-color:var(--borda-perigo); color:var(--vermelho);">Desfazer</button></td>
            </tr>`).join('')
        : '<tr><td colspan="6" class="texto-vazio">Nenhuma tratativa registrada no período.</td></tr>';

    tbody.querySelectorAll('.btn-remover-tratativa').forEach((btn) => {
        btn.addEventListener('click', () => desfazerTratativa(btn.dataset.id));
    });
}

async function desfazerTratativa(id) {
    const ok = await confirmar(
        'Desfazer esta tratativa?',
        'O atraso volta a contar normalmente no relatório e no saldo do dia.',
        { textoConfirmar: 'Desfazer', perigo: true }
    );
    if (!ok) return;
    try {
        const resp = await api.removerTratativa(id);
        toast(resp.message, 'sucesso');
        carregarAtrasos();
    } catch (e) {
        toast(e.message, 'erro');
    }
}

/* ===================== Seleção em massa ===================== */

function selecionados() {
    return [...document.querySelectorAll('.check-atraso:checked')]
        .map((c) => atrasosCache[Number(c.dataset.indice)]).filter(Boolean);
}

function atualizarContador() {
    const lista = selecionados();
    const contador = document.getElementById('atrasos-contador');
    const btn = document.getElementById('btn-tratar-lote');
    if (!contador || !btn) return;

    const pessoas = new Set(lista.map((d) => d.funcionarioId)).size;
    contador.textContent = lista.length === 0
        ? 'Nenhum atraso selecionado'
        : `${lista.length} atraso(s) de ${pessoas} colaborador(es)`;
    btn.disabled = lista.length === 0;
    btn.textContent = lista.length === 0 ? 'Tratar selecionados' : `Tratar ${lista.length} selecionado(s)`;
}

/* ===================== Modal de tratativa ===================== */

function abrirModal(titulo, info, revisaoHtml) {
    document.getElementById('tratar-titulo').textContent = titulo;
    document.getElementById('tratar-info').textContent = info;

    const revisao = document.getElementById('tratar-revisao');
    revisao.innerHTML = revisaoHtml || '';
    revisao.classList.toggle('escondido', !revisaoHtml);

    document.getElementById('tratar-motivo').value = '';
    document.getElementById('tratar-erro').textContent = '';
    document.getElementById('tratar-tipo').value = 'atraso_abonado';
    document.getElementById('tratar-campos-avulso').classList.add('escondido');
    document.getElementById('tratar-campo-tipo').classList.remove('escondido');
    aplicarVisibilidadeMinutos();
    document.getElementById('modalTratarAtraso').style.display = 'flex';
}

/** O campo de minutos só faz sentido no atestado de horas. */
function aplicarVisibilidadeMinutos() {
    const tipo = document.getElementById('tratar-tipo').value;
    document.getElementById('tratar-campo-minutos').classList.toggle('escondido', tipo !== 'atestado_horas');
}

/**
 * Atestado de horas sem atraso na entrada. A tabela ao lado só lista dias com atraso,
 * mas o caso mais comum de atestado de horas é sair no meio do expediente — então esse
 * dia nunca apareceria lá. Aqui o gestor escolhe a pessoa e a data na mão.
 */
async function abrirAtestadoAvulso() {
    await garantirCadastro();
    modoLote = false;
    modoAvulso = true;
    alvoIndividual = null;

    abrirModal('Lançar atestado de horas', 'Escolha o colaborador, o dia e quantos minutos o atestado abona.', null);

    const seletor = document.getElementById('tratar-funcionario');
    seletor.innerHTML = cadastroAtivo.length
        ? cadastroAtivo.map((f) => `<option value="${f.id}">${escapeHtml(f.nome)}</option>`).join('')
        : '<option value="">Nenhum colaborador ativo</option>';

    const hoje = new Date();
    document.getElementById('tratar-data').value =
        `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;

    // Tipo fixo: se houvesse atraso na entrada, o caminho certo seria a lista ao lado.
    document.getElementById('tratar-tipo').value = 'atestado_horas';
    document.getElementById('tratar-campo-tipo').classList.add('escondido');
    document.getElementById('tratar-campos-avulso').classList.remove('escondido');
    aplicarVisibilidadeMinutos();
}

function abrirTratativaIndividual(indice) {
    const d = atrasosCache[indice];
    if (!d) return;
    modoLote = false;
    modoAvulso = false;
    alvoIndividual = d;
    abrirModal(
        'Justificar atraso',
        `${d.nome} — ${dataBR(d.dataISO)} · entrou às ${d.pontos.ENTRADA || '--:--'}, previsto ${d.horario_combinado || '--:--'}`,
        null
    );
}

function abrirTratativaEmLote() {
    const lista = selecionados();
    if (lista.length === 0) return;
    modoLote = true;
    modoAvulso = false;
    alvoIndividual = null;

    const pessoas = new Set(lista.map((d) => d.funcionarioId)).size;
    abrirModal(
        'Justificar atrasos em massa',
        `${lista.length} atraso(s) de ${pessoas} colaborador(es) receberão a mesma decisão:`,
        lista.map((d) => `
            <div class="item-revisao">
                <span>${escapeHtml(d.emoji || '')} ${escapeHtml(d.nome)}</span>
                <span>${dataBR(d.dataISO)} · ${escapeHtml(d.atraso)}</span>
            </div>`).join('')
    );
}

async function confirmarTratativa() {
    const tipo = document.getElementById('tratar-tipo').value;
    const motivo = document.getElementById('tratar-motivo').value.trim();
    const minutos = Number(document.getElementById('tratar-minutos').value) || 0;
    const erro = document.getElementById('tratar-erro');
    const modal = document.getElementById('modalTratarAtraso');

    if (!motivo) {
        erro.textContent = 'Escreva o motivo — ele fica registrado no histórico.';
        return;
    }
    if (tipo === 'atestado_horas' && minutos <= 0) {
        erro.textContent = 'Informe quantos minutos o atestado abona.';
        return;
    }

    if (modoAvulso) {
        const funcionarioId = document.getElementById('tratar-funcionario').value;
        const data = document.getElementById('tratar-data').value;
        if (!funcionarioId) { erro.textContent = 'Escolha o colaborador.'; return; }
        if (!data) { erro.textContent = 'Escolha a data do atestado.'; return; }

        const btnAvulso = document.getElementById('btn-confirmar-tratativa');
        btnAvulso.disabled = true;
        try {
            await api.tratarAtraso({ funcionario_id: funcionarioId, data, tipo, minutos_abonados: minutos, motivo });
            toast('Atestado de horas lançado.', 'sucesso');
            modal.style.display = 'none';
            carregarAtrasos();
        } catch (e) {
            erro.textContent = e.message;
        } finally {
            btnAvulso.disabled = false;
        }
        return;
    }

    const btn = document.getElementById('btn-confirmar-tratativa');
    btn.disabled = true;
    try {
        if (modoLote) {
            const lista = selecionados();
            const ok = await confirmar(
                `Aplicar a ${lista.length} atraso(s)?`,
                tipo === 'atraso_registrado'
                    ? 'Os atrasos CONTINUARÃO contando no relatório — só o motivo será registrado.'
                    : 'Os atrasos sairão do relatório e as horas voltarão ao saldo dos dias.',
                { textoConfirmar: 'Aplicar a todos' }
            );
            if (!ok) { btn.disabled = false; return; }

            const itens = lista.map((d) => ({ funcionario_id: d.funcionarioId, data: d.dataISO }));
            const resp = await api.tratarAtrasosEmLote({ itens, tipo, minutos_abonados: minutos, motivo });
            toast(resp.message, 'sucesso');
        } else {
            await api.tratarAtraso({
                funcionario_id: alvoIndividual.funcionarioId,
                data: alvoIndividual.dataISO,
                tipo, minutos_abonados: minutos, motivo
            });
            toast('Atraso justificado.', 'sucesso');
        }
        modal.style.display = 'none';
        carregarAtrasos();
    } catch (e) {
        erro.textContent = e.message;
    } finally {
        btn.disabled = false;
    }
}

export function iniciarAtrasos() {
    const btn = document.getElementById('btn-filtrar-atrasos');
    if (!btn || btn.dataset.iniciado) return;
    btn.dataset.iniciado = '1';

    const mesInput = document.getElementById('atrasos-mes');
    if (!mesInput.value) mesInput.value = mesAtualISO();

    btn.addEventListener('click', carregarAtrasos);
    document.getElementById('atrasos-regime').addEventListener('change', carregarAtrasos);
    document.getElementById('atrasos-turno').addEventListener('change', carregarAtrasos);

    document.getElementById('atrasos-selecionar-todos').addEventListener('change', (ev) => {
        document.querySelectorAll('.check-atraso').forEach((chk) => {
            chk.checked = ev.target.checked;
            chk.closest('tr').classList.toggle('selecionada', chk.checked);
        });
        atualizarContador();
    });
    document.getElementById('btn-tratar-lote').addEventListener('click', abrirTratativaEmLote);
    document.getElementById('btn-atestado-avulso').addEventListener('click', abrirAtestadoAvulso);

    document.getElementById('tratar-tipo').addEventListener('change', aplicarVisibilidadeMinutos);
    document.getElementById('btn-confirmar-tratativa').addEventListener('click', confirmarTratativa);
    document.getElementById('btn-cancelar-tratativa').addEventListener('click', () => {
        document.getElementById('modalTratarAtraso').style.display = 'none';
    });
}
